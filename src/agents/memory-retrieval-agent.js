require('dotenv').config();

const { MongoClient } = require('mongodb');
const config = require('../../config/atlas-config');

async function buildPrecedentBrief(transaction_id) {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) throw new Error(`Transaction not found: ${transaction_id}`);

    const indicators = txn.fraud_indicators ?? [];
    const queryText = [
      `Fraud case with indicators: ${indicators.join(', ')}`,
      `Amount: ${txn.amount} ${txn.currency}`,
      `Location: ${txn.location?.country}, ${txn.location?.city}`,
      `Device: ${txn.device?.device_type}, ${txn.device?.os}`,
      `Merchant: ${txn.merchant?.merchant_name}`,
    ].join('. ');

    let verified = [];
    let allMemory = [];

    try {
      [verified, allMemory] = await Promise.all([
        db.collection('agent_memory').aggregate([
          {
            $vectorSearch: {
              index: 'agent_memory_text_index',
              path: 'summary',
              query: queryText,
              numCandidates: 50,
              limit: 10,
              model: 'voyage-4',
            },
          },
          { $match: { source: 'human_confirmed' } },
          { $limit: 6 },
          {
            $project: {
              _id: 0, transaction_id: 1, user_id: 1, summary: 1,
              outcome: 1, tags: 1, created_at: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ]).toArray(),
        db.collection('agent_memory').aggregate([
          {
            $vectorSearch: {
              index: 'agent_memory_text_index',
              path: 'summary',
              query: queryText,
              numCandidates: 50,
              limit: 10,
              model: 'voyage-4',
            },
          },
          { $limit: 6 },
          {
            $project: {
              _id: 0, transaction_id: 1, user_id: 1, summary: 1,
              outcome: 1, source: 1, tags: 1, created_at: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ]).toArray(),
      ]);
    } catch (e) {
      // Vector search failed (index might not exist) — use fallback below
    }

    // Fallback: if vector search returned nothing, use $match on indicators
    if (verified.length === 0 && allMemory.length === 0 && indicators.length > 0) {
      [verified, allMemory] = await Promise.all([
        db.collection('agent_memory').aggregate([
          { $match: { source: 'human_confirmed', transaction_id: { $ne: transaction_id } } },
          { $match: { $or: [{ indicators: { $all: indicators } }, { tags: { $all: indicators } }] } },
          { $sort: { created_at: -1 } },
          { $limit: 6 },
          { $project: { _id: 0, transaction_id: 1, user_id: 1, summary: 1, outcome: 1, tags: 1, indicators: 1, created_at: 1, score: null } },
        ]).toArray(),
        db.collection('agent_memory').aggregate([
          { $match: { source: 'agent', transaction_id: { $ne: transaction_id } } },
          { $match: { $or: [{ indicators: { $all: indicators } }, { tags: { $all: indicators } }] } },
          { $sort: { created_at: -1 } },
          { $limit: 6 },
          { $project: { _id: 0, transaction_id: 1, user_id: 1, summary: 1, outcome: 1, source: 1, tags: 1, created_at: 1, score: null } },
        ]).toArray(),
      ]);
    }

    const confirmedFraud = verified.filter((m) => m.outcome === 'confirmed_fraud');
    const confirmedFalsePositive = verified.filter((m) => m.outcome === 'false_positive');
    const unverified = allMemory.filter((m) => m.source === 'agent');

    const accuracyStats = await computeAccuracyStat(db, indicators);

    const brief = formatBrief({
      transaction_id, indicators, txn,
      confirmedFraud, confirmedFalsePositive, unverified, accuracyStats,
    });

    return { brief, indicators, queryText };
  } finally {
    await client.close();
  }
}
