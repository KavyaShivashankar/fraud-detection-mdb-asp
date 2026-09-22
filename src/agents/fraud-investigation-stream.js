require('dotenv').config();

const { ChatAnthropic } = require('@langchain/anthropic');
const { tool } = require('@langchain/core/tools');
const { HumanMessage, SystemMessage, ToolMessage } = require('@langchain/core/messages');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
const config = require('../../config/atlas-config');

// ---------------------------------------------------------------------------
// Tools — investigation-only tools. Memory retrieval and decision/write-back
// are handled by separate graph nodes (memory-retrieval-agent, decision-agent).
// ---------------------------------------------------------------------------

const fetchFraudTransactionTool = tool(
  async ({ transaction_id }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const txn = await client
        .db(config.atlas.database)
        .collection('fraud_transactions')
        .findOne({ transaction_id });
      if (!txn) return JSON.stringify({ error: `Not found: ${transaction_id}` });
      return JSON.stringify({ fraud_transaction: txn });
    } finally {
      await client.close();
    }
  },
  {
    name: 'fetch_fraud_transaction',
    description: 'Fetches the flagged fraud transaction. Call this first.',
    schema: z.object({ transaction_id: z.string() }),
  }
);

const fetchUserHistoryTool = tool(
  async ({ user_id, limit = 20 }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const db = client.db(config.atlas.database);
      const [profile, transactions] = await Promise.all([
        db.collection('user_profiles').findOne({ user_id }),
        db.collection('transactions').find({ user_id }).sort({ timestamp: -1 }).limit(limit).toArray(),
      ]);
      return JSON.stringify({ profile: profile ?? null, recent_transactions: transactions, transaction_count: transactions.length });
    } finally {
      await client.close();
    }
  },
  {
    name: 'fetch_user_history',
    description: "Retrieves the user's transaction history and behavioral profile.",
    schema: z.object({
      user_id: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  }
);

const searchSimilarFraudTool = tool(
  async ({ query_text, k = 5 }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const results = await client
        .db(config.atlas.database)
        .collection('fraud_transactions')
        .aggregate([
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
          {
            $project: {
              _id: 0, transaction_id: 1, user_id: 1, amount: 1, currency: 1,
              location: 1, merchant: 1, device: 1, fraud_indicators: 1,
              fraud_score: 1, timestamp: 1, score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .toArray();
      return JSON.stringify({ count: results.length, results });
    } finally {
      await client.close();
    }
  },
  {
    name: 'search_similar_fraud_cases',
    description: 'Semantic vector search over fraud_transactions for similar past cases.',
    schema: z.object({
      query_text: z.string(),
      k: z.number().int().min(1).max(10).optional(),
    }),
  }
);

const submitFindingsTool = tool(
  async ({ findings, confidence, recommendation }) => {
    return JSON.stringify({ findings, confidence, recommendation });
  },
  {
    name: 'submit_investigation_findings',
    description:
      'Submit your investigation findings, confidence level, and recommendation. This is your final step — do not write to the database yourself.',
    schema: z.object({
      findings: z.string().describe('Detailed investigation summary covering what happened, how it deviates from normal behavior, what precedents suggest, and risk assessment'),
      confidence: z.enum(['high', 'medium', 'low']).describe('Your confidence in the conclusion'),
      recommendation: z.enum(['escalate', 'auto_close']).describe('Whether to escalate to human review or auto-close'),
    }),
  }
);

const TOOLS = [
  fetchFraudTransactionTool,
  fetchUserHistoryTool,
  searchSimilarFraudTool,
  submitFindingsTool,
];

// ---------------------------------------------------------------------------
// System prompt — includes precedent brief context
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior fraud investigation specialist. You have been provided with a PRECEDENT BRIEF containing similar past cases — both confirmed fraud and confirmed false positives — and the agent's historical accuracy for this case type. Use this context to guide your investigation.

Follow this protocol:
1. fetch_fraud_transaction — get the flagged transaction details
2. fetch_user_history — get behavioral baseline and recent transactions
3. search_similar_fraud_cases — find similar historical cases
4. Submit your findings using submit_investigation_findings — include:
   - What happened and which indicators fired
   - How this deviates from normal behavior
   - What the precedent brief and similar cases suggest
   - Risk assessment: likely fraud or possible false positive?
   - Your confidence level (high/medium/low)
   - Recommended action: auto-close or escalate to human

Be precise, evidence-based, and concise. Flag any ambiguities that a human analyst should resolve.`;

// ---------------------------------------------------------------------------
// Streaming generator
// Yields:
//   { type: 'step_start', tool: string, args: object }
//   { type: 'step_done',  tool: string, result: object }
//   { type: 'findings_submitted', findings: string, confidence: string, recommendation: string }
//   { type: 'token',      text: string }
//   { type: 'done' }
//   { type: 'error',      text: string }
// ---------------------------------------------------------------------------

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return '';
}

async function* runInvestigationAgent(transaction_id, precedentBrief) {
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    thinking: { type: 'adaptive' },
  }).bindTools(TOOLS);

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(
      `Investigate transaction_id: "${transaction_id}". Complete the full investigation protocol and submit your findings.\n\n${precedentBrief ?? ''}`
    ),
  ];

  for (let turn = 1; turn <= 8; turn++) {
    const response = await model.invoke(messages);
    messages.push(response);

    const toolCalls = response.tool_calls ?? [];

    if (toolCalls.length === 0) {
      yield { type: 'token', text: extractText(response.content) };
      yield { type: 'done' };
      return;
    }

    for (const tc of toolCalls) {
      yield { type: 'step_start', tool: tc.name, args: tc.args };
      const match = TOOLS.find((t) => t.name === tc.name);
      const resultStr = await match.invoke(tc.args);
      messages.push(new ToolMessage({ content: resultStr, tool_call_id: tc.id }));

      if (tc.name === 'submit_investigation_findings') {
        const parsed = JSON.parse(resultStr);
        yield { type: 'findings_submitted', ...parsed };
      }

      yield { type: 'step_done', tool: tc.name, result: JSON.parse(resultStr) };
    }
  }

  yield { type: 'error', text: 'Agent exceeded 8 turns without completing.' };
  yield { type: 'done' };
}

module.exports = { runInvestigationAgent };
