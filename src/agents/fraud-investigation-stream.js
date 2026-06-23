require('dotenv').config();

const { ChatAnthropic } = require('@langchain/anthropic');
const { tool } = require('@langchain/core/tools');
const { HumanMessage, SystemMessage, ToolMessage } = require('@langchain/core/messages');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
const config = require('../../config/atlas-config');

// ---------------------------------------------------------------------------
// Tools (same logic as fraud-investigation-agent.js, scoped to this agent)
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

const writeInvestigationFindingsTool = tool(
  async ({ transaction_id, notes, route_to_human }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const result = await client
        .db(config.atlas.database)
        .collection('fraud_transactions')
        .updateOne(
          { transaction_id },
          {
            $set: {
              'investigation.notes': Array.isArray(notes) ? notes : [notes],
              'investigation.routed_to_human': route_to_human,
              'investigation.investigated_at': new Date(),
              'investigation.assigned_to': route_to_human ? 'human_review_queue' : 'automated',
            },
          }
        );
      return JSON.stringify({ transaction_id, modified: result.modifiedCount, route_to_human });
    } finally {
      await client.close();
    }
  },
  {
    name: 'write_investigation_findings',
    description: 'Writes the investigation summary back to the fraud_transactions document. Always call this last.',
    schema: z.object({
      transaction_id: z.string(),
      notes: z.union([z.string(), z.array(z.string())]),
      route_to_human: z.boolean(),
    }),
  }
);

const TOOLS = [fetchFraudTransactionTool, fetchUserHistoryTool, searchSimilarFraudTool, writeInvestigationFindingsTool];

const SYSTEM_PROMPT = `You are a senior fraud investigation specialist. Investigate the given transaction by following this protocol exactly:
1. fetch_fraud_transaction — get fraud score, indicators, amount, location, device, merchant
2. fetch_user_history — get behavioral baseline and recent transactions
3. search_similar_fraud_cases — find past cases matching this pattern
4. Synthesize findings: what happened, how it deviates from normal behavior, what similar cases suggest, risk assessment
5. write_investigation_findings — write your case summary and set route_to_human

Be precise and evidence-based.`;

// ---------------------------------------------------------------------------
// Streaming generator
// Yields:
//   { type: 'step_start', tool: string, args: object }
//   { type: 'step_done',  tool: string, result: object }
//   { type: 'token',      text: string }
//   { type: 'done' }
//   { type: 'error',      text: string }
// ---------------------------------------------------------------------------

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return '';
}

async function* runFraudInvestigationStream(transactionId) {
  const model = new ChatAnthropic({
    model: 'claude-opus-4-8',
    thinking: { type: 'adaptive' },
  }).bindTools(TOOLS);

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(
      `Investigate transaction_id: "${transactionId}". Follow the full protocol and write your findings back.`
    ),
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
      yield { type: 'step_start', tool: tc.name, args: tc.args };
      const match = TOOLS.find((t) => t.name === tc.name);
      const resultStr = await match.invoke(tc.args);
      messages.push(new ToolMessage({ content: resultStr, tool_call_id: tc.id }));
      yield { type: 'step_done', tool: tc.name, result: JSON.parse(resultStr) };
    }
  }

  yield { type: 'error', text: 'Agent exceeded 10 turns without completing.' };
  yield { type: 'done' };
}

module.exports = { runFraudInvestigationStream };
