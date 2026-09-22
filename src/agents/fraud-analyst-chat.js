require('dotenv').config();

const { ChatAnthropic } = require('@langchain/anthropic');
const { tool } = require('@langchain/core/tools');
const { HumanMessage, SystemMessage, ToolMessage, AIMessage } = require('@langchain/core/messages');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
const config = require('../../config/atlas-config');
const { searchAgentMemoryTool } = require('./agent-memory-tool');

const ALLOWED_COLLECTIONS = ['fraud_transactions', 'transactions', 'user_profiles'];
const FORBIDDEN_STAGES = ['$out', '$merge', '$indexStats', '$currentOp', '$listLocalSessions'];
const MAX_RESULTS = 50;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const LEXICAL_PATHS = [
  'text', 'fraud_indicators',
  'merchant.merchant_name', 'merchant.merchant_category', 'merchant.merchant_country',
  'location.country', 'location.city',
  'device.device_type', 'device.os',
];

const RESULT_PROJECTION = {
  _id: 0, transaction_id: 1, user_id: 1, amount: 1, currency: 1,
  location: 1, merchant: 1, device: 1, fraud_indicators: 1, fraud_score: 1, timestamp: 1,
};

const searchFraudCasesTool = tool(
  async ({ query_text, k = 5, mode = 'hybrid' }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();

      let pipeline;

      if (mode === 'lexical') {
        pipeline = [
          {
            $search: {
              index: 'fraud_transactions_lexical',
              text: { query: query_text, path: LEXICAL_PATHS },
            },
          },
          { $limit: k },
          { $project: { ...RESULT_PROJECTION, score: { $meta: 'searchScore' } } },
        ];
      } else if (mode === 'hybrid') {
        pipeline = [
          {
            $rankFusion: {
              input: {
                pipelines: {
                  vectorPipeline: [
                    {
                      $vectorSearch: {
                        index: 'fraud_transactions_text_index',
                        path: 'text',
                        query: query_text,
                        numCandidates: k * 10,
                        limit: k * 4,
                        model: 'voyage-4',
                      },
                    },
                  ],
                  lexicalPipeline: [
                    {
                      $search: {
                        index: 'fraud_transactions_lexical',
                        text: { query: query_text, path: LEXICAL_PATHS },
                      },
                    },
                    { $limit: k * 4 },
                  ],
                },
              },
              combination: {
                weights: { vectorPipeline: 0.6, lexicalPipeline: 0.4 },
              },
            },
          },
          { $limit: k },
          { $project: RESULT_PROJECTION },
        ];
      } else {
        // vector
        pipeline = [
          {
            $vectorSearch: {
              index: 'fraud_transactions_text_index',
              path: 'text',
              query: query_text,
              numCandidates: k * 10,
              limit: k,
              model: 'voyage-4',
            },
          },
          { $project: { ...RESULT_PROJECTION, score: { $meta: 'vectorSearchScore' } } },
        ];
      }

      const results = await client
        .db(config.atlas.database)
        .collection('fraud_transactions')
        .aggregate(pipeline)
        .toArray();

      return JSON.stringify({ mode, count: results.length, results });
    } finally {
      await client.close();
    }
  },
  {
    name: 'search_fraud_cases',
    description:
      'Search fraud_transactions using vector (semantic), lexical (BM25 keyword), or hybrid (RRF combination) search. ' +
      'Use lexical when the query contains specific terms like merchant names, countries, or device types. ' +
      'Use vector for pattern or concept queries. Use hybrid for best overall recall.',
    schema: z.object({
      query_text: z.string().describe('Natural language description of the fraud pattern to search for'),
      k: z.number().int().min(1).max(20).optional().describe('Number of results (default 5)'),
      mode: z.enum(['vector', 'lexical', 'hybrid']).optional().describe(
        'Search mode: vector (semantic similarity), lexical (BM25 keyword match), or hybrid (both via RRF). Uses the user-selected mode by default.'
      ),
    }),
  }
);

const runAggregationTool = tool(
  async ({ collection, pipeline_json }) => {
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      return JSON.stringify({ error: `Collection must be one of: ${ALLOWED_COLLECTIONS.join(', ')}` });
    }

    let pipeline;
    try {
      pipeline = JSON.parse(pipeline_json);
    } catch (e) {
      return JSON.stringify({ error: `Invalid pipeline JSON: ${e.message}` });
    }

    if (!Array.isArray(pipeline)) {
      return JSON.stringify({ error: 'Pipeline must be a JSON array' });
    }

    for (const stage of pipeline) {
      const key = Object.keys(stage)[0];
      if (FORBIDDEN_STAGES.includes(key)) {
        return JSON.stringify({ error: `Stage ${key} is not permitted` });
      }
    }

    // Safety cap — append only if no $limit already present
    if (!pipeline.some((s) => '$limit' in s)) {
      pipeline.push({ $limit: MAX_RESULTS });
    }

    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const results = await client
        .db(config.atlas.database)
        .collection(collection)
        .aggregate(pipeline)
        .toArray();
      return JSON.stringify({ count: results.length, results });
    } finally {
      await client.close();
    }
  },
  {
    name: 'run_aggregation',
    description: `Generates and executes a MongoDB aggregation pipeline. Use for analytics, counts, groupings, facets, and time-range queries.

Available collections and fields:
• fraud_transactions — transaction_id, user_id, amount (number), currency, transaction_type ("purchase"|"withdrawal"|"transfer"|"deposit"), merchant.merchant_name, merchant.merchant_category (MCC), merchant.merchant_country, location.country, location.city, device.device_type ("mobile"|"desktop"|"tablet"), device.os, device.device_id, fraud_indicators (array: "high_amount"|"unusual_location"|"new_device"), fraud_score (0-100), is_fraudulent (bool), status, timestamp (Date)
• transactions — same schema as fraud_transactions, includes all transactions
• user_profiles — user_id, patterns.avg_transaction_amount, patterns.avg_daily_transactions, patterns.frequent_locations (array {city,country}), patterns.known_devices (array), patterns.frequent_merchants (array {merchant_name}), patterns.transaction_type_distribution ({purchase,withdrawal,transfer} as decimals)`,
    schema: z.object({
      collection: z.enum(['fraud_transactions', 'transactions', 'user_profiles']),
      pipeline_json: z.string().describe('Valid MongoDB aggregation pipeline as a JSON array string'),
    }),
  }
);

const getUserRiskProfileTool = tool(
  async ({ user_id }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const db = client.db(config.atlas.database);

      const [profile, fraudHistory, recentTxns] = await Promise.all([
        db.collection('user_profiles').findOne({ user_id }),
        db.collection('fraud_transactions').find({ user_id }).sort({ timestamp: -1 }).limit(10).toArray(),
        db.collection('transactions').find({ user_id }).sort({ timestamp: -1 }).limit(20).toArray(),
      ]);

      return JSON.stringify({
        user_id,
        profile: profile ?? null,
        fraud_transaction_count: fraudHistory.length,
        fraud_history: fraudHistory,
        recent_transactions: recentTxns,
      });
    } finally {
      await client.close();
    }
  },
  {
    name: 'get_user_risk_profile',
    description:
      "Retrieves a user's full risk profile: behavioral patterns, recent transactions, and fraud history. Use for questions like 'Is user_00042 a fraud risk?' or 'Show me everything about user X'.",
    schema: z.object({
      user_id: z.string().describe('The user_id to look up'),
    }),
  }
);

const TOOLS = [searchFraudCasesTool, runAggregationTool, getUserRiskProfileTool, searchAgentMemoryTool];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert fraud analyst assistant with direct access to a real-time fraud detection database. You help fraud investigators, risk teams, and compliance analysts understand fraud patterns and investigate cases.

You have four tools:
- search_fraud_cases: semantic search over fraud history using natural language
- run_aggregation: generate and run any MongoDB aggregation pipeline for analytics
- get_user_risk_profile: full risk profile, transaction history, and fraud history for a specific user
- search_agent_memory: search distilled conclusions from past investigations and analyst reviews — what was decided and why, not raw transactions. Results marked source: "human_confirmed" are analyst-verified ground truth; source: "agent" results are a prior agent's unverified conclusion, worth citing as precedent but not as fact

When answering:
- Run the appropriate tool(s) first, then explain findings in plain language
- For questions about whether a pattern is actually fraud, or what past cases concluded, check search_agent_memory alongside search_fraud_cases
- Highlight key numbers and patterns — do not dump raw data
- For time-based queries ("last week", "past 30 days"), translate to ISO date ranges in the pipeline using $gte/$lte
- For facet/breakdown questions, use $facet in the aggregation
- Keep responses concise and actionable`;

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

function statusLabel(toolName, args) {
  if (toolName === 'search_fraud_cases') {
    const modeLabel = { vector: 'Vector', lexical: 'Lexical', hybrid: 'Hybrid' }[args.mode ?? 'hybrid'];
    return `${modeLabel} search: "${args.query_text}"`;
  }
  if (toolName === 'run_aggregation') return `Aggregating ${args.collection}`;
  if (toolName === 'get_user_risk_profile') return `Looking up ${args.user_id}`;
  if (toolName === 'search_agent_memory') return `Recalling past findings: "${args.query_text}"`;
  return `Running ${toolName}`;
}

async function* runFraudAnalyst(userMessage, conversationHistory = [], searchMode = 'hybrid') {
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    thinking: { type: 'adaptive' },
  }).bindTools(TOOLS);

  const modeInstruction = `\n\nSearch mode preference: when calling search_fraud_cases, use mode: "${searchMode}" unless the user explicitly requests a different mode.`;

  const messages = [
    new SystemMessage(SYSTEM_PROMPT + modeInstruction),
    ...conversationHistory.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
    ),
    new HumanMessage(userMessage),
  ];

  for (let turn = 1; turn <= 10; turn++) {
    const response = await model.invoke(messages);
    messages.push(response);

    const toolCalls = response.tool_calls ?? [];

    if (toolCalls.length === 0) {
      yield { type: 'token', text: extractText(response.content) };
      yield { type: 'done' };
      return;
    }

    for (const tc of toolCalls) {
      yield { type: 'status', text: statusLabel(tc.name, tc.args) };
      const match = TOOLS.find((t) => t.name === tc.name);
      const result = await match.invoke(tc.args);
      messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
    }
  }

  yield { type: 'error', text: 'Agent exceeded maximum turns without a final answer.' };
  yield { type: 'done' };
}

// ---------------------------------------------------------------------------
// Session memory: compress the oldest chunk of a session's buffer into a
// short rolling summary so long conversations don't grow the context window
// without bound. Called by the server when a session's message buffer
// exceeds its window.
// ---------------------------------------------------------------------------

async function summarizeConversation(messages, priorSummary) {
  const model = new ChatAnthropic({ model: 'claude-sonnet-4-6' });

  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  const prompt = `Summarize the key facts, entities (user_ids, transaction_ids, merchants), and conclusions from this fraud-analysis conversation excerpt in 2-4 sentences, written so it can be used as background context for continuing the conversation.${
    priorSummary ? ` Merge it with this existing summary rather than replacing it:\n\n${priorSummary}` : ''
  }\n\nExcerpt:\n${transcript}`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  return extractText(response.content);
}

module.exports = { runFraudAnalyst, summarizeConversation };
// Search modes: 'vector' | 'lexical' | 'hybrid'
