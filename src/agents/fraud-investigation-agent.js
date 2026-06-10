require('dotenv').config();

const { ChatAnthropic } = require('@langchain/anthropic');
const { tool } = require('@langchain/core/tools');
const { HumanMessage, SystemMessage, ToolMessage } = require('@langchain/core/messages');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
const config = require('../../config/atlas-config');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const fetchFraudTransactionTool = tool(
  async ({ transaction_id }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const db = client.db(config.atlas.database);

      const fraudTxn = await db
        .collection('fraud_transactions')
        .findOne({ transaction_id });

      if (!fraudTxn)
        return JSON.stringify({ error: `No fraud transaction found for transaction_id: ${transaction_id}` });

      return JSON.stringify({ fraud_transaction: fraudTxn });
    } finally {
      await client.close();
    }
  },
  {
    name: 'fetch_fraud_transaction',
    description:
      'Fetches the flagged fraud transaction by transaction_id from the fraud_transactions collection. Call this first — it contains the fraud score, indicators, amount, location, device, and merchant.',
    schema: z.object({
      transaction_id: z.string().describe('The transaction_id of the flagged transaction to retrieve'),
    }),
  }
);

const fetchUserHistoryTool = tool(
  async ({ user_id, limit = 20 }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const db = client.db(config.atlas.database);

      const transactions = await db
        .collection('transactions')
        .find({ user_id })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      const userProfile = await db
        .collection('user_profiles')
        .findOne({ user_id });

      return JSON.stringify({
        user_id,
        profile: userProfile ?? null,
        recent_transactions: transactions,
        transaction_count: transactions.length,
      });
    } finally {
      await client.close();
    }
  },
  {
    name: 'fetch_user_history',
    description:
      "Retrieves a user's recent transaction history and behavioral profile so you can identify deviations from normal patterns. Returns up to `limit` transactions sorted newest-first.",
    schema: z.object({
      user_id: z.string().describe('The user_id whose history to fetch'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Number of recent transactions to return (default 20, max 50)'),
    }),
  }
);

const searchSimilarFraudTool = tool(
  async ({ query_text, k = 5 }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const db = client.db(config.atlas.database);

      // autoEmbed index: pass `query` as plain text — Atlas embeds it
      // server-side using the same voyage-4 model as the index.
      const results = await db
        .collection('fraud_transactions')
        .aggregate([
          {
            $vectorSearch: {
              index: 'fraud_transactions_text_index',
              path: 'text',
              query: query_text,
              numCandidates: k * 10,
              limit: k,
              model: "voyage-4",
            },
          },
          {
            $project: {
              _id: 0,
              transaction_id: 1,
              user_id: 1,
              amount: 1,
              currency: 1,
              location: 1,
              merchant: 1,
              device: 1,
              fraud_indicators: 1,
              fraud_score: 1,
              timestamp: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .toArray();

      return JSON.stringify({ query: query_text, similar_cases: results });
    } finally {
      await client.close();
    }
  },
  {
    name: 'search_similar_fraud_cases',
    description:
      'Runs a semantic vector search against fraud_transactions to find the most similar past fraud cases. Describe the pattern you are looking for in plain text (e.g. "high-amount mobile purchase in West Africa from unknown device").',
    schema: z.object({
      query_text: z
        .string()
        .describe('Natural-language description of the fraud pattern to search for'),
      k: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Number of similar cases to return (default 5)'),
    }),
  }
);

const writeInvestigationFindingsTool = tool(
  async ({ transaction_id, notes, route_to_human }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();
      const db = client.db(config.atlas.database);

      const updateDoc = {
        $set: {
          'investigation.notes': Array.isArray(notes) ? notes : [notes],
          'investigation.routed_to_human': route_to_human,
          'investigation.investigated_at': new Date(),
          'investigation.assigned_to': route_to_human ? 'human_review_queue' : 'automated',
        },
      };

      const result = await db
        .collection('fraud_transactions')
        .updateOne({ transaction_id }, updateDoc);

      return JSON.stringify({
        transaction_id,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        routed_to_human: route_to_human,
      });
    } finally {
      await client.close();
    }
  },
  {
    name: 'write_investigation_findings',
    description:
      'Writes your investigation summary back to the fraud_transactions document under the `investigation` field. Always call this as your final action.',
    schema: z.object({
      transaction_id: z.string().describe('The transaction_id of the fraud transaction to update'),
      notes: z
        .union([z.string(), z.array(z.string())])
        .describe('Investigation summary string or array of note strings to write'),
      route_to_human: z
        .boolean()
        .describe(
          'true → flag for human analyst review; false → mark as handled automatically'
        ),
    }),
  }
);

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

const TOOLS = [
  fetchFraudTransactionTool,
  fetchUserHistoryTool,
  searchSimilarFraudTool,
  writeInvestigationFindingsTool,
];

const SYSTEM_PROMPT = `You are a senior fraud investigation specialist at a financial institution.
Your job is to investigate flagged transactions from the real-time stream processing pipeline.

When given a transaction_id, follow this investigation protocol in order:
1. Fetch the flagged transaction using fetch_fraud_transaction — this gives you the fraud score, indicators, amount, location, device, and merchant
2. Retrieve the user's recent transaction history and profile using fetch_user_history
3. Search for similar historical fraud cases using search_similar_fraud_cases — craft your query from the pattern of indicators (location, amount, device, merchant category)
4. Synthesize all evidence into a detailed case summary covering:
   - What happened and which indicators fired
   - How this transaction deviates from the user's normal behavior
   - What similar historical fraud cases were found and what they suggest
   - Risk assessment: is this likely genuine fraud or a possible false positive?
   - Recommended action: handle automatically or escalate to human review
5. Write your findings using write_investigation_findings — always call this last

Be precise, evidence-based, and concise. Flag any ambiguities that a human analyst should resolve.`;

async function executeTool(toolCall) {
  const match = TOOLS.find((t) => t.name === toolCall.name);
  if (!match) throw new Error(`Unknown tool: ${toolCall.name}`);

  console.log(`  [tool] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
  const result = await match.invoke(toolCall.args);
  console.log(`  [tool] ${toolCall.name} → done`);
  return result;
}

async function runFraudInvestigationAgent(transactionId) {
  const model = new ChatAnthropic({
    model: 'claude-opus-4-8',
    thinking: { type: 'adaptive' },
  }).bindTools(TOOLS);

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(
      `Investigate the flagged transaction with transaction_id: "${transactionId}". Complete the full investigation protocol and write your findings back to the transaction.`
    ),
  ];

  console.log(`\n[FraudAgent] Starting investigation for transaction: ${transactionId}\n`);

  for (let turn = 1; turn <= 10; turn++) {
    const response = await model.invoke(messages);
    messages.push(response);

    const toolCalls = response.tool_calls ?? [];

    if (toolCalls.length === 0) {
      console.log('\n[FraudAgent] Investigation complete.\n');
      console.log('Output:', response.content);
      return response.content;
    }

    console.log(`\n[FraudAgent] Turn ${turn} — executing ${toolCalls.length} tool call(s)`);

    for (const tc of toolCalls) {
      const result = await executeTool(tc);
      messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
    }
  }

  throw new Error('Agent did not complete within 10 turns');
}

// Run directly: node src/agents/fraud-investigation-agent.js <transaction_id>
if (require.main === module) {
  const transactionId = process.argv[2];
  if (!transactionId) {
    console.error('Usage: node src/agents/fraud-investigation-agent.js <transaction_id>');
    process.exit(1);
  }

  runFraudInvestigationAgent(transactionId).catch((err) => {
    console.error('[FraudAgent] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runFraudInvestigationAgent };
