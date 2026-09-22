require('dotenv').config();

const { ChatAnthropic } = require('@langchain/anthropic');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { MongoClient } = require('mongodb');
const config = require('../../config/atlas-config');
const { buildInvestigationMemory } = require('./agent-memory-tool');

const DECISION_PROMPT = `You are a fraud investigation decision agent.
You receive investigation findings, a confidence level, and a recommendation
from the investigation agent, along with a precedent brief containing
historical accuracy data.

Apply this decision policy:
- If confidence is "high" AND recommendation is "auto_close" AND the
  accuracy stat for these indicators is >= 75%: auto-close the case.
- If confidence is "high" AND recommendation is "escalate": escalate
  to human review.
- If confidence is "medium" or "low": always escalate to human review.
- If the accuracy stat is < 60% (agent is often wrong for this pattern):
  always escalate, regardless of confidence.
- If no accuracy stat exists (insufficient history): follow the
  recommendation but lean toward escalation.

Return ONLY a JSON object with this exact shape:
{
  "route_to_human": true,
  "decision_rationale": "why this decision was made",
  "final_notes": ["note1", "note2"]
}`;

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  return '';
}

async function makeDecision({ findings, confidence, recommendation, precedentBrief, indicators }) {
  const model = new ChatAnthropic({ model: 'claude-sonnet-4-6' });

  const userMessage = [
    `Investigation findings:\n${findings}`,
    `\nConfidence: ${confidence}`,
    `Recommendation: ${recommendation}`,
    `\nIndicators: [${(indicators ?? []).join(', ')}]`,
    `\nPrecedent brief:\n${precedentBrief ?? 'No precedent brief available.'}`,
  ].join('\n');

  const response = await model.invoke([
    new SystemMessage(DECISION_PROMPT),
    new HumanMessage(userMessage),
  ]);

  const text = extractText(response.content);

  let decision;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    decision = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    decision = {
      route_to_human: true,
      decision_rationale: `Failed to parse decision from LLM. Defaulting to human review. Raw: ${text}`,
      final_notes: [findings],
    };
  }

  if (!Array.isArray(decision.final_notes)) {
    decision.final_notes = decision.final_notes ? [decision.final_notes] : [findings];
  }

  return decision;
}

async function writeDecision({ transaction_id, route_to_human, decision_rationale,
  final_notes, investigation_findings, confidence, recommendation }) {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const updated = await db.collection('fraud_transactions').findOneAndUpdate(
      { transaction_id },
      {
        $set: {
          'investigation.notes': final_notes,
          'investigation.routed_to_human': route_to_human,
          'investigation.investigated_at': new Date(),
          'investigation.assigned_to': route_to_human ? 'human_review_queue' : 'automated',
          'investigation.confidence': confidence,
          'investigation.recommendation': recommendation,
          'investigation.decision_rationale': decision_rationale,
        },
      },
      { returnDocument: 'after' }
    );

    if (updated) {
      await db.collection('agent_memory').insertOne(
        buildInvestigationMemory({
          transaction_id,
          user_id: updated.user_id,
          notes: final_notes,
          tags: updated.fraud_indicators,
          route_to_human,
        })
      );
    }

    return { transaction_id, route_to_human, decision_rationale };
  } finally {
    await client.close();
  }
}

module.exports = { makeDecision, writeDecision };
