require('dotenv').config();

const { MongoClient } = require('mongodb');
const config = require('../../../config/atlas-config');

async function ingestOutcome(transaction_id, human_outcome, human_notes) {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) throw new Error(`Transaction not found: ${transaction_id}`);

    const agentConfidence = txn.investigation?.confidence ?? 'unknown';
    const agentRecommendation = txn.investigation?.recommendation ?? 'unknown';
    const agentRoutedToHuman = txn.investigation?.routed_to_human ?? false;
    const agentNotes = txn.investigation?.notes ?? [];
    const agentRationale = txn.investigation?.decision_rationale ?? '';

    const agentSaidFraud =
      agentRoutedToHuman === true || agentRecommendation === 'escalate';
    const humanSaidFraud = human_outcome === 'confirmed_fraud';
    const agreement = agentSaidFraud === humanSaidFraud;

    return {
      transaction_id,
      user_id: txn.user_id,
      indicators: txn.fraud_indicators ?? [],
      merchant_id: txn.merchant?.merchant_id ?? null,
      amount: txn.amount,
      location: txn.location,
      device: txn.device,
      agent_conclusion: agentSaidFraud ? 'flagged_as_fraud' : 'marked_as_clean',
      human_conclusion: human_outcome,
      agreement,
      agent_confidence: agentConfidence,
      agent_notes: agentNotes,
      agent_rationale: agentRationale,
      human_notes: human_notes ?? '',
    };
  } finally {
    await client.close();
  }
}

module.exports = { ingestOutcome };
