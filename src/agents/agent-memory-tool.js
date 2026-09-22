require('dotenv').config();

const { tool } = require('@langchain/core/tools');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
const config = require('../../config/atlas-config');

// Shared by fraud-investigation-agent.js, fraud-investigation-stream.js, and
// fraud-analyst-chat.js — long-term memory of distilled findings, as opposed
// to search_similar_fraud_cases which searches raw transaction records.
const searchAgentMemoryTool = tool(
  async ({ query_text, k = 5, verified_only = false }) => {
    const client = new MongoClient(config.atlas.connectionString);
    try {
      await client.connect();

      const pipeline = [
        {
          $vectorSearch: {
            index: 'agent_memory_text_index',
            path: 'summary',
            query: query_text,
            numCandidates: k * 10,
            limit: k * 4,
            model: 'voyage-4',
          },
        },
        ...(verified_only ? [{ $match: { source: 'human_confirmed' } }] : []),
        { $limit: k },
        {
          $project: {
            _id: 0,
            type: 1,
            transaction_id: 1,
            user_id: 1,
            summary: 1,
            tags: 1,
            outcome: 1,
            source: 1,
            created_at: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const memories = await client
        .db(config.atlas.database)
        .collection('agent_memory')
        .aggregate(pipeline)
        .toArray();

      return JSON.stringify({ query: query_text, memories });
    } finally {
      await client.close();
    }
  },
  {
    name: 'search_agent_memory',
    description:
      'Searches distilled findings from past investigations and analyst reviews — not raw transactions, but what was concluded and why. ' +
      "Each result carries a `source`: 'human_confirmed' means an analyst verified that outcome and it can be trusted as ground truth; " +
      "'agent' means a prior agent reached that conclusion on its own and it was never checked by a human — treat it as prior reasoning to " +
      'weigh, not as fact. Set verified_only: true when you specifically need confirmed ground truth rather than precedent.',
    schema: z.object({
      query_text: z.string().describe('Natural-language description of the pattern, case, or question to search for'),
      k: z.number().int().min(1).max(10).optional().describe('Number of memories to return (default 5)'),
      verified_only: z.boolean().optional().describe('If true, only return human-confirmed memories (default false)'),
    }),
  }
);

// Builds the memory document an investigation agent writes for its own
// conclusion. source is always 'agent' here — only the human-feedback
// endpoint (server.js) writes source: 'human_confirmed'.
function buildInvestigationMemory({ transaction_id, user_id, notes, tags, route_to_human }) {
  return {
    type: 'investigation_summary',
    transaction_id,
    user_id: user_id ?? null,
    summary: Array.isArray(notes) ? notes.join(' ') : notes,
    tags: tags ?? [],
    outcome: route_to_human ? 'escalated' : 'automated',
    source: 'agent',
    created_at: new Date(),
  };
}

// Builds a lesson-learned memory document from a human-reviewed case.
// Written by the learning cycle after a human analyst submits feedback.
// source is always 'human_confirmed' — this is verified ground truth.
function buildLessonMemory({ transaction_id, user_id, lesson_summary, tags,
  outcome, agent_conclusion, human_conclusion, agreement, indicators, merchant_id }) {
  return {
    type: 'lesson_learned',
    transaction_id,
    user_id: user_id ?? null,
    summary: lesson_summary,
    tags: tags ?? [],
    outcome,
    source: 'human_confirmed',
    lesson_type: agreement ? 'confirmed_fraud_lesson' : 'false_positive_lesson',
    agent_conclusion,
    human_conclusion,
    agreement,
    indicators: indicators ?? [],
    merchant_id: merchant_id ?? null,
    created_at: new Date(),
  };
}

module.exports = { searchAgentMemoryTool, buildInvestigationMemory, buildLessonMemory };
