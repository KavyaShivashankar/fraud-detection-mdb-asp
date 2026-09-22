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

    const [verified, allMemory] = await Promise.all([
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

async function computeAccuracyStat(db, indicators) {
  if (!indicators.length) return null;

  const pipeline = [
    { $match: { type: 'lesson_learned', source: 'human_confirmed' } },
    { $match: { indicators: { $all: indicators } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        agreed: { $sum: { $cond: ['$agreement', 1, 0] } },
      },
    },
  ];
  const result = await db.collection('agent_memory').aggregate(pipeline).toArray();
  if (!result.length) return null;
  const { total, agreed } = result[0];
  return { total, agreed, rate: Math.round((agreed / total) * 100) };
}

function formatBrief({ transaction_id, indicators,
  confirmedFraud, confirmedFalsePositive, unverified, accuracyStats }) {
  const sections = [];
  sections.push(`PRECEDENT BRIEF for ${transaction_id}`);
  sections.push(`Indicators: [${indicators.join(', ')}]`);
  sections.push('');

  if (confirmedFraud.length) {
    sections.push('CONFIRMED FRAUD PRECEDENTS (human-verified):');
    confirmedFraud.forEach((m, i) => {
      sections.push(`${i + 1}. ${m.transaction_id} — ${m.summary}`);
    });
    sections.push('');
  }

  if (confirmedFalsePositive.length) {
    sections.push('CONFIRMED FALSE-POSITIVE PRECEDENTS (human-verified):');
    confirmedFalsePositive.forEach((m, i) => {
      sections.push(`${i + 1}. ${m.transaction_id} — ${m.summary}`);
    });
    sections.push('');
  }

  if (unverified.length) {
    sections.push('UNVERIFIED AGENT PRECEDENTS (prior reasoning, not human-checked):');
    unverified.forEach((m, i) => {
      sections.push(`${i + 1}. ${m.transaction_id} — ${m.summary}`);
    });
    sections.push('');
  }

  if (accuracyStats) {
    sections.push(`ACCURACY STAT: For cases with indicators [${indicators.join(', ')}],`);
    sections.push(`the agent has been right ${accuracyStats.rate}% of the time`);
    sections.push(`(${accuracyStats.agreed} of ${accuracyStats.total} human-reviewed cases agreed with agent).`);
  }

  return sections.join('\n');
}

module.exports = { buildPrecedentBrief, computeAccuracyStat };
