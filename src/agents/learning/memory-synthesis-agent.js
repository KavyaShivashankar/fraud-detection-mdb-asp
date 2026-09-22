require('dotenv').config();

const { ChatAnthropic } = require('@langchain/anthropic');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');

const SYNTHESIS_PROMPT = `You are a fraud analysis learning agent. Your job is
to generate a concise, reusable lesson from a case where a human analyst
reviewed an AI agent's investigation.

If the agent and human AGREED (both said fraud or both said not fraud):
- Write a "confirmed pattern" lesson: what signals correctly identified this
  case type, so future investigations can recognize it faster.

If the agent and human DISAGREED:
- Write a "correction" lesson: what the agent got wrong, what signal it
  missed or over-weighted, and what the human analyst noticed instead.
- This lesson should help future agents avoid the same mistake.

Format: 2-4 sentences, written so a future agent can use it as guidance.
Start with the case context, then the key insight.

Example (agreement):
"For transactions with indicators [high_amount, new_device] from Nigeria
with no prior international activity, this pattern was confirmed as
account takeover fraud. The combination of new device + unusual location
within 2 hours of a high-value purchase is a strong signal."

Example (disagreement):
"For transactions with indicators [new_device] where the user has 3+ years
of clean history and the device is the same OS as their previous device
(just a newer model), the agent flagged this but it was a false positive.
Key insight: check if the new device is an upgrade of the same type/OS
before flagging — legitimate device upgrades are common."`;

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  return '';
}

async function synthesizeLesson(ingestedOutcome) {
  const model = new ChatAnthropic({ model: 'claude-sonnet-4-6' });

  const caseDescription = [
    `Transaction: ${ingestedOutcome.transaction_id}`,
    `Indicators: [${ingestedOutcome.indicators.join(', ')}]`,
    `Amount: ${ingestedOutcome.amount}`,
    `Location: ${ingestedOutcome.location?.country}, ${ingestedOutcome.location?.city}`,
    `Device: ${ingestedOutcome.device?.device_type}, ${ingestedOutcome.device?.os}`,
    `Agent conclusion: ${ingestedOutcome.agent_conclusion}`,
    `Human conclusion: ${ingestedOutcome.human_conclusion}`,
    `Agreement: ${ingestedOutcome.agreement}`,
    `Agent notes: ${
      Array.isArray(ingestedOutcome.agent_notes)
        ? ingestedOutcome.agent_notes.join(' ')
        : ingestedOutcome.agent_notes
    }`,
    `Agent rationale: ${ingestedOutcome.agent_rationale}`,
    `Human notes: ${ingestedOutcome.human_notes}`,
  ].join('\n');

  const response = await model.invoke([
    new SystemMessage(SYNTHESIS_PROMPT),
    new HumanMessage(caseDescription),
  ]);

  return extractText(response.content);
}

module.exports = { synthesizeLesson };
