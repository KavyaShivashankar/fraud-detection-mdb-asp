require('dotenv').config();

const { compiledInvestigationGraph } = require('./learning/memory-graph');

async function runFraudInvestigationAgent(transactionId) {
  const result = await compiledInvestigationGraph.invoke({ transaction_id: transactionId });
  return result;
}

if (require.main === module) {
  const transactionId = process.argv[2];
  if (!transactionId) {
    console.error('Usage: node src/agents/fraud-investigation-agent.js <transaction_id>');
    process.exit(1);
  }

  console.log(`\n[FraudAgent] Starting investigation for transaction: ${transactionId}\n`);

  runFraudInvestigationAgent(transactionId)
    .then((result) => {
      console.log('\n[FraudAgent] Investigation complete.\n');
      console.log('Findings:', result.findings);
      console.log('Confidence:', result.confidence);
      console.log('Routed to human:', result.route_to_human);
      console.log('Rationale:', result.decision_rationale);
    })
    .catch((err) => {
      console.error('[FraudAgent] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runFraudInvestigationAgent };
