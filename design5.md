# Design 5: Memory-Curated Learning Loop — Implementation Plan

## What You're Building

A two-cycle multi-agent system that wraps around the existing investigation workflow:

```
INVESTIGATION CYCLE (replaces current single-agent investigation)
  Memory Retrieval Agent  ->  Investigation Agent  ->  Decision Agent

LEARNING CYCLE (triggered by human feedback)
  Outcome Ingest Agent  ->  Memory Synthesis Agent  ->  Memory Index Update
```

The investigation cycle pre-fetches structured precedent before the investigator starts. The learning cycle turns every human review into a searchable lesson that improves future investigations.

---

## What Already Exists (Don't Rebuild)

| Existing piece | Location | Role in new design |
|---|---|---|
| `search_agent_memory` tool | `agent-memory-tool.js:11` | Reused by Memory Retrieval Agent |
| `buildInvestigationMemory()` | `agent-memory-tool.js:75` | Reused by Decision Agent's write-back |
| Human feedback endpoint | `server.js:264-323` | Modified to trigger learning cycle |
| `agent_memory` collection + autoEmbed index | `indexes/agent_memory_text_index.json` | Reused, extended with new fields |
| `fraud_transactions.investigation` subdoc | `fraud-investigation-stream.js:112` | Extended with new sub-fields |
| All 5 existing investigation tools | `fraud-investigation-stream.js:15-151` | Reused by Investigation Agent |

---

## What's New

| New file | Purpose |
|---|---|
| `src/agents/memory-retrieval-agent.js` | Pre-fetches structured precedent brief |
| `src/agents/decision-agent.js` | Makes routing decision, writes findings + memory |
| `src/agents/learning/outcome-ingest-agent.js` | Extracts case facts after human review |
| `src/agents/learning/memory-synthesis-agent.js` | Compares agent vs human, generates lesson |
| `src/agents/learning/memory-graph.js` | LangGraph state graph wiring both cycles |
| `src/agents/learning/precedent-brief-helpers.js` | MongoDB queries for precedent assembly |

| Modified file | Change |
|---|---|
| `src/agents/fraud-investigation-stream.js` | Accepts precedent brief as input; loses memory search + decision logic |
| `src/agents/agent-memory-tool.js` | Add `buildLessonMemory()` alongside existing `buildInvestigationMemory()` |
| `src/server.js` | Feedback endpoint triggers learning cycle; investigate endpoint triggers graph |
| `src/agents/fraud-investigation-agent.js` | CLI version updated to call graph instead of direct agent loop |

---

## Phase 1: New `agent_memory` Schema Fields

**Goal:** Extend the memory schema to support lesson types without breaking existing documents.

The current `agent_memory` document shape:

```json
{
  "type": "investigation_summary" | "analyst_feedback",
  "transaction_id": "...",
  "user_id": "...",
  "summary": "...",
  "tags": [...],
  "outcome": "escalated" | "automated" | "confirmed_fraud" | "false_positive",
  "source": "agent" | "human_confirmed",
  "created_at": "..."
}
```

New documents the learning cycle will write:

```json
{
  "type": "lesson_learned",
  "transaction_id": "...",
  "user_id": "...",
  "summary": "In cases with indicators [high_amount, new_device] and a user
              with 2+ years of history, the agent flagged this as fraud but
              the human confirmed it was a false positive — the user had
              recently purchased a new phone and made a legitimate large
              purchase. Key signal: check device purchase history before
              flagging new_device.",
  "tags": ["high_amount", "new_device"],
  "outcome": "false_positive",
  "source": "human_confirmed",
  "lesson_type": "false_positive_lesson",
  "agent_conclusion": "flagged_as_fraud",
  "human_conclusion": "false_positive",
  "agreement": false,
  "indicators": ["high_amount", "new_device"],
  "merchant_id": "...",
  "created_at": "..."
}
```

**Action:** No schema migration needed — MongoDB is schemaless. New fields appear only on new documents. The autoEmbed index on `summary` works unchanged because the `summary` field still contains natural-language text.

**File:** `src/agents/agent-memory-tool.js` — add `buildLessonMemory()`

```javascript
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
```

---

## Phase 2: Memory Retrieval Agent

**Goal:** Before the investigation agent runs, fetch a structured precedent brief so the investigator starts with context instead of discovering it during the investigation.

### New file: `src/agents/memory-retrieval-agent.js`

**What it does:** Given a `transaction_id`, fetches the flagged transaction, constructs a pattern description from its indicators, and runs two parallel `search_agent_memory` queries:

1. `verified_only: true` — confirmed-fraud and confirmed-false-positive cases
2. `verified_only: false` — all prior agent conclusions

Then it produces a structured **precedent brief**:

```
PRECEDENT BRIEF for txn_demo_1234
Indicators: [high_amount, unusual_location, new_device]

CONFIRMED FRAUD PRECEDENTS (human-verified):
1. txn_5678 — user_00015, $2,340, Nigeria, new device
   Outcome: confirmed_fraud. "Pattern matches card-not-present fraud..."
2. txn_9012 — user_00033, $1,890, Ghana, new device
   Outcome: confirmed_fraud. "Account takeover via credential stuffing..."

CONFIRMED FALSE-POSITIVE PRECEDENTS (human-verified):
1. txn_3456 — user_00042, $1,200, UK, new device
   Outcome: false_positive. "User was traveling, notified bank in advance..."

UNVERIFIED AGENT PRECEDENTS (prior reasoning, not human-checked):
1. txn_7890 — Similar indicators, agent escalated to human.

ACCURACY STAT:
For cases with indicators [high_amount, new_device], the agent has been
right 73% of the time (8 of 11 human-reviewed cases agreed with agent).
```

**Implementation approach:** This agent doesn't need tool-calling — it's a deterministic data-gathering step, not an LLM reasoning step. It's a plain async function that queries MongoDB and formats the brief. Using an LLM here would add latency and cost without value.

```javascript
// src/agents/memory-retrieval-agent.js

const { MongoClient } = require('mongodb');
const config = require('../../config/atlas-config');

async function buildPrecedentBrief(transaction_id) {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    // 1. Fetch the flagged transaction to get indicators + pattern description
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

    // 2. Two parallel memory searches: verified + all
    const [verified, allMemory] = await Promise.all([
      db.collection('agent_memory').aggregate([
        { $vectorSearch: {
          index: 'agent_memory_text_index', path: 'summary',
          query: queryText, numCandidates: 50, limit: 10, model: 'voyage-4',
        }},
        { $match: { source: 'human_confirmed' } },
        { $limit: 6 },
        { $project: { _id: 0, transaction_id: 1, user_id: 1, summary: 1,
          outcome: 1, tags: 1, created_at: 1,
          score: { $meta: 'vectorSearchScore' } } },
      ]).toArray(),
      db.collection('agent_memory').aggregate([
        { $vectorSearch: {
          index: 'agent_memory_text_index', path: 'summary',
          query: queryText, numCandidates: 50, limit: 10, model: 'voyage-4',
        }},
        { $limit: 6 },
        { $project: { _id: 0, transaction_id: 1, user_id: 1, summary: 1,
          outcome: 1, source: 1, tags: 1, created_at: 1,
          score: { $meta: 'vectorSearchScore' } } },
      ]).toArray(),
    ]);

    // 3. Split verified into fraud vs false-positive
    const confirmedFraud = verified.filter(m => m.outcome === 'confirmed_fraud');
    const confirmedFalsePositive = verified.filter(m => m.outcome === 'false_positive');
    const unverified = allMemory.filter(m => m.source === 'agent');

    // 4. Compute accuracy stat for these indicators
    const accuracyStats = await computeAccuracyStat(db, indicators);

    // 5. Assemble the brief as a string the investigation agent can read
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
    { $group: {
      _id: null,
      total: { $sum: 1 },
      agreed: { $sum: { $cond: ['$agreement', 1, 0] } },
    }},
  ];
  const result = await db.collection('agent_memory').aggregate(pipeline).toArray();
  if (!result.length) return null;
  const { total, agreed } = result[0];
  return { total, agreed, rate: Math.round((agreed / total) * 100) };
}

function formatBrief({ transaction_id, indicators, txn,
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

module.exports = { buildPrecedentBrief };
```

**Key design decisions:**

- **Not an LLM agent** — it's a deterministic data-gathering function. No token cost, no latency, no hallucination risk. The value is in the structured retrieval, not reasoning.
- **Two parallel vector searches** — one filtered to `human_confirmed`, one unfiltered. This separates ground truth from unverified precedent.
- **Accuracy stat** — aggregates `lesson_learned` documents to compute historical agent accuracy for these specific indicators. This is the "meta-learning" signal: the investigation agent knows its own track record on this case type.
- **The accuracy stat starts empty** — before any human feedback exists, it returns `null`. The brief still works, just without the accuracy section. The system bootstraps naturally.

---

## Phase 3: Refactor the Investigation Agent

**Goal:** The current investigation agent does everything: fetch, search, investigate, decide, write. Split it so it receives the precedent brief as input and focuses on investigation only. Move the memory search and decision logic out.

### Modify: `src/agents/fraud-investigation-stream.js`

**Changes:**

1. **Remove `searchAgentMemoryTool` from TOOLS** — the Memory Retrieval Agent already does this. The investigation agent doesn't need to repeat it.

2. **Remove `writeInvestigationFindingsTool` from TOOLS** — the Decision Agent handles write-back. The investigation agent produces findings but doesn't write them.

3. **Add a new tool: `submit_investigation_findings`** — replaces `write_investigation_findings`. Returns findings to the graph state instead of writing to MongoDB. The Decision Agent reads from state and writes.

4. **Accept `precedentBrief` as input** — the system prompt includes the brief as context.

Updated system prompt:

```
You are a senior fraud investigation specialist. You have been provided
with a PRECEDENT BRIEF containing similar past cases — both confirmed
fraud and confirmed false positives — and the agent's historical accuracy
for this case type. Use this context to guide your investigation.

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
```

New tool (replaces write_investigation_findings):

```javascript
const submitFindingsTool = tool(
  async ({ findings, confidence, recommendation }) => {
    // Returns findings to the agent loop — the graph state captures this
    return JSON.stringify({
      findings,
      confidence,
      recommendation, // "escalate" | "auto_close"
    });
  },
  {
    name: 'submit_investigation_findings',
    description: 'Submit your investigation findings, confidence level, and recommendation. This is your final step.',
    schema: z.object({
      findings: z.string().describe('Detailed investigation summary'),
      confidence: z.enum(['high', 'medium', 'low']).describe('Your confidence in the conclusion'),
      recommendation: z.enum(['escalate', 'auto_close']).describe('Whether to escalate to human or auto-close'),
    }),
  }
);
```

The agent's generator now yields findings as structured state instead of writing them directly:

```javascript
async function* runInvestigationAgent(transaction_id, precedentBrief) {
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    thinking: { type: 'adaptive' },
  }).bindTools(TOOLS); // fetch_fraud_transaction, fetch_user_history,
                      // search_similar_fraud_cases, submit_investigation_findings

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(
      `Investigate transaction_id: "${transaction_id}".\n\n${precedentBrief}`
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
      const result = await match.invoke(tc.args);
      messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));

      // Capture submitted findings
      if (tc.name === 'submit_investigation_findings') {
        const parsed = JSON.parse(result);
        yield { type: 'findings_submitted', ...parsed };
      }
      yield { type: 'step_done', tool: tc.name, result: JSON.parse(result) };
    }
  }
  yield { type: 'error', text: 'Agent exceeded 8 turns' };
  yield { type: 'done' };
}
```

---

## Phase 4: Decision Agent

**Goal:** Take the investigation agent's findings + confidence + recommendation, make the final routing decision, and write everything back to MongoDB.

### New file: `src/agents/decision-agent.js`

This is a lightweight agent — it doesn't need tools. It's an LLM call that takes the investigation findings and precedent brief, applies a decision policy, and returns a structured decision. The actual MongoDB write happens in the graph node (not the LLM) to keep writes deterministic.

```javascript
// src/agents/decision-agent.js

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

Return a JSON object with:
{
  "route_to_human": true|false,
  "decision_rationale": "why this decision was made",
  "final_notes": ["note1", "note2"]  // notes to write to the document
}`;
```

**The write-back function** (called by the graph node after the LLM decides):

```javascript
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

module.exports = { makeDecision, writeDecision, DECISION_PROMPT };
```

**New fields on `fraud_transactions.investigation`:**

- `confidence` — "high" | "medium" | "low"
- `recommendation` — "escalate" | "auto_close"
- `decision_rationale` — why the final decision was made (ties to accuracy stat)

---

## Phase 5: Learning Cycle Agents

### New file: `src/agents/learning/outcome-ingest-agent.js`

**Triggered by:** the human feedback endpoint when an analyst submits `confirmed_fraud` or `false_positive`.

**What it does:** Gathers all the case facts needed for synthesis. Like the Memory Retrieval Agent, this is deterministic — no LLM needed.

```javascript
// src/agents/learning/outcome-ingest-agent.js

const { MongoClient } = require('mongodb');
const config = require('../../config/atlas-config');

async function ingestOutcome(transaction_id, human_outcome, human_notes) {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) throw new Error(`Transaction not found: ${transaction_id}`);

    // Extract what the agent concluded
    const agentConclusion = {
      confidence: txn.investigation?.confidence ?? 'unknown',
      recommendation: txn.investigation?.recommendation ?? 'unknown',
      routed_to_human: txn.investigation?.routed_to_human ?? false,
      notes: txn.investigation?.notes ?? [],
      decision_rationale: txn.investigation?.decision_rationale ?? '',
    };

    // Determine if agent and human agreed
    // Agent escalated (routed_to_human = true) and human confirmed fraud = agreement
    // Agent escalated and human said false_positive = disagreement
    // Agent auto-closed (routed_to_human = false) and human confirmed fraud = disagreement
    const agentSaidFraud = txn.investigation?.routed_to_human === true
      || txn.investigation?.recommendation === 'escalate';
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
      agent_notes: agentConclusion.notes,
      agent_rationale: agentConclusion.decision_rationale,
      human_notes: human_notes ?? '',
    };
  } finally {
    await client.close();
  }
}

module.exports = { ingestOutcome };
```

### New file: `src/agents/learning/memory-synthesis-agent.js`

**What it does:** Takes the ingested outcome and generates a natural-language lesson summary. This *is* an LLM call — the value is in synthesizing a reusable lesson from the case facts.

```javascript
// src/agents/learning/memory-synthesis-agent.js

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
    `Agent notes: ${Array.isArray(ingestedOutcome.agent_notes)
      ? ingestedOutcome.agent_notes.join(' ') : ingestedOutcome.agent_notes}`,
    `Agent rationale: ${ingestedOutcome.agent_rationale}`,
    `Human notes: ${ingestedOutcome.human_notes}`,
  ].join('\n');

  const response = await model.invoke([
    new SystemMessage(SYNTHESIS_PROMPT),
    new HumanMessage(caseDescription),
  ]);

  return extractText(response.content);
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.filter(b => b.type === 'text').map(b => b.text).join('');
  return '';
}

module.exports = { synthesizeLesson };
```

### Memory Index Update (no separate file needed)

The write to `agent_memory` happens directly in the graph node after synthesis. It uses `buildLessonMemory()` (added in Phase 1) and inserts one document. The autoEmbed index handles embedding automatically.

---

## Phase 6: LangGraph State Graph

### New file: `src/agents/learning/memory-graph.js`

This wires both cycles into a single LangGraph state graph. The investigation cycle runs synchronously when a case is investigated. The learning cycle runs asynchronously when human feedback is submitted.

```javascript
// src/agents/learning/memory-graph.js

const { StateGraph, START, END, Annotation } = require('@langchain/langgraph');
const { buildPrecedentBrief } = require('../memory-retrieval-agent');
const { runInvestigationAgent } = require('../fraud-investigation-stream');
const { makeDecision, writeDecision } = require('../decision-agent');
const { ingestOutcome } = require('./outcome-ingest-agent');
const { synthesizeLesson } = require('./memory-synthesis-agent');
const { buildLessonMemory } = require('../agent-memory-tool');
const { MongoClient } = require('mongodb');
const config = require('../../config/atlas-config');

// -- State schema ------------------------------------------------

const InvestigationState = Annotation.Root({
  transaction_id: Annotation.string,
  precedentBrief: Annotation.string,
  indicators: Annotation.array(Annotation.string),
  findings: Annotation.string,
  confidence: Annotation.enum(['high', 'medium', 'low']),
  recommendation: Annotation.enum(['escalate', 'auto_close']),
  route_to_human: Annotation.boolean,
  decision_rationale: Annotation.string,
  final_notes: Annotation.array(Annotation.string),
  messages: Annotation.messages,  // for streaming
});

const LearningState = Annotation.Root({
  transaction_id: Annotation.string,
  human_outcome: Annotation.enum(['confirmed_fraud', 'false_positive']),
  human_notes: Annotation.string,
  ingested: Annotation.any,
  lesson_summary: Annotation.string,
});

// -- Investigation cycle nodes -----------------------------------

async function memoryRetrievalNode(state) {
  const { brief, indicators } = await buildPrecedentBrief(state.transaction_id);
  return { precedentBrief: brief, indicators };
}

async function investigationNode(state) {
  let findings, confidence, recommendation;

  for await (const event of runInvestigationAgent(state.transaction_id, state.precedentBrief)) {
    if (event.type === 'findings_submitted') {
      findings = event.findings;
      confidence = event.confidence;
      recommendation = event.recommendation;
    }
  }

  return { findings, confidence, recommendation };
}

async function decisionNode(state) {
  const decision = await makeDecision({
    findings: state.findings,
    confidence: state.confidence,
    recommendation: state.recommendation,
    precedentBrief: state.precedentBrief,
    indicators: state.indicators,
  });

  const written = await writeDecision({
    transaction_id: state.transaction_id,
    route_to_human: decision.route_to_human,
    decision_rationale: decision.decision_rationale,
    final_notes: decision.final_notes,
    investigation_findings: state.findings,
    confidence: state.confidence,
    recommendation: state.recommendation,
  });

  return {
    route_to_human: decision.route_to_human,
    decision_rationale: decision.decision_rationale,
    final_notes: decision.final_notes,
  };
}

// -- Investigation graph -----------------------------------------

const investigationGraph = new StateGraph(InvestigationState)
  .addNode('memory_retrieval', memoryRetrievalNode)
  .addNode('investigate', investigationNode)
  .addNode('decide', decisionNode)
  .addEdge(START, 'memory_retrieval')
  .addEdge('memory_retrieval', 'investigate')
  .addEdge('investigate', 'decide')
  .addEdge('decide', END);

const compiledInvestigationGraph = investigationGraph.compile();

// -- Learning cycle nodes ----------------------------------------

async function outcomeIngestNode(state) {
  const ingested = await ingestOutcome(
    state.transaction_id, state.human_outcome, state.human_notes
  );
  return { ingested };
}

async function synthesisNode(state) {
  const lessonSummary = await synthesizeLesson(state.ingested);
  return { lesson_summary: lessonSummary };
}

async function memoryWriteNode(state) {
  const lesson = buildLessonMemory({
    transaction_id: state.ingested.transaction_id,
    user_id: state.ingested.user_id,
    lesson_summary: state.lesson_summary,
    tags: state.ingested.indicators,
    outcome: state.ingested.human_conclusion,
    agent_conclusion: state.ingested.agent_conclusion,
    human_conclusion: state.ingested.human_conclusion,
    agreement: state.ingested.agreement,
    indicators: state.ingested.indicators,
    merchant_id: state.ingested.merchant_id,
  });

  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    await client.db(config.atlas.database).collection('agent_memory').insertOne(lesson);
  } finally {
    await client.close();
  }

  return { lesson_written: true };
}

// -- Learning graph ----------------------------------------------

const learningGraph = new StateGraph(LearningState)
  .addNode('ingest', outcomeIngestNode)
  .addNode('synthesize', synthesisNode)
  .addNode('write_lesson', memoryWriteNode)
  .addEdge(START, 'ingest')
  .addEdge('ingest', 'synthesize')
  .addEdge('synthesize', 'write_lesson')
  .addEdge('write_lesson', END);

const compiledLearningGraph = learningGraph.compile();

module.exports = {
  compiledInvestigationGraph,
  compiledLearningGraph,
};
```

**Graph topology — investigation cycle:**

```
START -> memory_retrieval -> investigate -> decide -> END
```

Three nodes, strictly sequential. The memory retrieval must complete before investigation. The investigation must complete before the decision. No conditional edges — the decision policy is inside the decision node.

**Graph topology — learning cycle:**

```
START -> ingest -> synthesize -> write_lesson -> END
```

Three nodes, strictly sequential. Runs asynchronously after human feedback.

---

## Phase 7: Server Integration

### Modify: `src/server.js`

**Change 1: Investigation endpoint calls the graph instead of the direct agent**

Current (`server.js:236-259`):

```javascript
app.post('/api/investigate', async (req, res) => {
  ...
  for await (const event of runFraudInvestigationStream(transaction_id)) {
    send(event);
    if (event.type === 'done') break;
  }
  ...
});
```

New:

```javascript
const { compiledInvestigationGraph, compiledLearningGraph } = require('./agents/learning/memory-graph');

app.post('/api/investigate', async (req, res) => {
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Run the investigation graph with streaming
    const stream = await compiledInvestigationGraph.stream(
      { transaction_id },
      { streamMode: 'updates' }
    );

    for await (const chunk of stream) {
      const [nodeName, stateUpdate] = Object.entries(chunk)[0];

      if (nodeName === 'memory_retrieval') {
        send({ type: 'step_done', tool: 'memory_retrieval',
               result: { indicators: stateUpdate.indicators } });
      }

      if (nodeName === 'investigate') {
        // The investigation agent's internal events are streamed separately
        // via the generator inside investigationNode. For simplicity here,
        // we send the final findings.
        send({ type: 'step_done', tool: 'investigation',
               result: { findings: stateUpdate.findings,
                         confidence: stateUpdate.confidence,
                         recommendation: stateUpdate.recommendation }});
      }

      if (nodeName === 'decide') {
        send({ type: 'step_done', tool: 'decision',
               result: { route_to_human: stateUpdate.route_to_human,
                         rationale: stateUpdate.decision_rationale }});
        send({ type: 'done' });
      }
    }
  } catch (err) {
    send({ type: 'error', text: err.message });
    send({ type: 'done' });
  }

  res.end();
});
```

**Change 2: Feedback endpoint triggers the learning cycle**

Current (`server.js:264-323`): writes feedback to `fraud_transactions` + writes a raw `analyst_feedback` memory.

New: does the same writes, then triggers the learning graph asynchronously.

```javascript
app.post('/api/fraud-transactions/:transaction_id/feedback', async (req, res) => {
  const { transaction_id } = req.params;
  const { outcome, notes } = req.body;

  const validOutcomes = ['confirmed_fraud', 'false_positive'];
  if (!validOutcomes.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${validOutcomes.join(', ')}` });
  }

  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) return res.status(404).json({ error: `No fraud transaction found` });

    const reviewed_at = new Date();

    // 1. Write human outcome to the transaction (unchanged)
    await db.collection('fraud_transactions').updateOne(
      { transaction_id },
      { $set: {
        'investigation.human_outcome': outcome,
        'investigation.human_notes': notes ?? null,
        'investigation.human_reviewed_at': reviewed_at,
        'investigation.human_reviewed_by': req.analystId,
      }}
    );

    // 2. Write the raw analyst_feedback memory (unchanged — keeps the audit trail)
    const summary = [
      `Human analyst (${req.analystName}) reviewed transaction ${transaction_id} and confirmed outcome: ${outcome}.`,
      Array.isArray(txn.investigation?.notes) ? txn.investigation.notes.join(' ') : txn.investigation?.notes ?? '',
      notes ? `Analyst note: ${notes}` : '',
    ].filter(Boolean).join(' ');

    await db.collection('agent_memory').insertOne({
      type: 'analyst_feedback',
      transaction_id, user_id: txn.user_id, summary,
      tags: txn.fraud_indicators ?? [], outcome,
      source: 'human_confirmed',
      reviewed_by: req.analystId, created_at: reviewed_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }

  // 3. Trigger learning cycle ASYNCHRONOUSLY (don't block the response)
  //    The user gets immediate confirmation; the lesson is generated in background.
  compiledLearningGraph.invoke({
    transaction_id,
    human_outcome: outcome,
    human_notes: notes ?? '',
  }).catch(err => {
    console.error('[learning] Lesson synthesis failed:', err);
  });

  res.json({ success: true, transaction_id, outcome, reviewed_at });
});
```

**Key decision: async learning cycle.** The human analyst gets immediate feedback confirmation. The lesson synthesis (1 LLM call + 1 MongoDB insert) runs in the background. If it fails, the raw `analyst_feedback` memory still exists from step 2 — the audit trail is intact, just the synthesized lesson is missing.

---

## Phase 8: Update the CLI Agent

### Modify: `src/agents/fraud-investigation-agent.js`

Update the CLI entry point to call the investigation graph:

```javascript
if (require.main === module) {
  const transactionId = process.argv[2];
  if (!transactionId) {
    console.error('Usage: node src/agents/fraud-investigation-agent.js <transaction_id>');
    process.exit(1);
  }

  const { compiledInvestigationGraph } = require('./learning/memory-graph');

  (async () => {
    const result = await compiledInvestigationGraph.invoke({ transaction_id: transactionId });
    console.log('\n[Investigation Complete]');
    console.log('Findings:', result.findings);
    console.log('Confidence:', result.confidence);
    console.log('Routed to human:', result.route_to_human);
    console.log('Rationale:', result.decision_rationale);
  })().catch(err => {
    console.error('[Fatal]', err);
    process.exit(1);
  });
}
```

---

## Phase 9: Frontend Changes

### Modify: `public/investigate.html`

The investigation UI needs to render the new graph stages. The current UI shows a timeline of tool calls. The new graph produces three stages:

1. **Precedent Brief** — show the retrieved precedents as a card before the investigation starts
2. **Investigation** — the existing tool-call timeline (fetch transaction, fetch user history, search similar cases)
3. **Decision** — show confidence, recommendation, decision rationale, and routing

**Specific changes:**

- Add a "Precedent Brief" panel that renders before the investigation timeline. Shows confirmed fraud precedents, false-positive precedents, and the accuracy stat.
- Add a "Decision" panel after the investigation timeline. Shows confidence badge (green/yellow/red), recommendation, and rationale text.
- The feedback flow is unchanged — the analyst still clicks "Confirm Fraud" or "False Positive". But now a small "Learning..." indicator appears briefly, confirming that the lesson was generated.

### Modify: `public/index.html` (analyst chatbot)

No changes needed — the chatbot doesn't use the investigation graph. It has its own tools and agent loop, which remain independent.

---

## Phase 10: Verification Plan

### Unit verification (no Atlas required)

| Test | How |
|---|---|
| `buildPrecedentBrief` returns structured brief | Mock `MongoClient`, verify it runs two vector searches + accuracy aggregation, formats brief string |
| `ingestOutcome` correctly determines agreement | Mock transaction with `routed_to_human: true` + human `confirmed_fraud` -> agreement = true. Same + `false_positive` -> agreement = false |
| `buildLessonMemory` produces correct shape | Verify field names, `source: "human_confirmed"`, `type: "lesson_learned"`, `lesson_type` derived from agreement |
| `computeAccuracyStat` handles empty case | No `lesson_learned` docs -> returns `null`, brief omits accuracy section |

### Integration verification (requires Atlas)

| Test | How |
|---|---|
| Full investigation cycle | Insert a test transaction, trigger `/api/investigate`, verify: precedent brief appears in SSE stream, investigation runs, decision written to `fraud_transactions.investigation`, `agent_memory` gets an `investigation_summary` entry |
| Full learning cycle | Submit feedback via `/api/fraud-transactions/:id/feedback`, verify: response is immediate, `analyst_feedback` memory written synchronously, `lesson_learned` memory appears within ~5 seconds (async LLM call), lesson `summary` is a coherent natural-language lesson |
| Accuracy stat bootstraps | On first run with no `lesson_learned` docs, brief omits accuracy section. After one learning cycle completes, subsequent investigations for same indicators show accuracy stat |
| Vector search finds lessons | After a lesson is written, run `search_agent_memory` with a query matching the lesson's pattern. Verify the lesson appears in results with `source: "human_confirmed"` |

### End-to-end verification

1. `npm run generate-data` — seed database
2. Deploy stream processing pipeline
3. Submit a high-risk transaction via `/simulate.html` (all indicators firing)
4. Run investigation via `/investigate.html` — verify precedent brief appears (empty on first run), investigation completes, decision is written
5. Submit human feedback: "confirmed_fraud"
6. Wait 5 seconds, run investigation on a similar transaction — verify the precedent brief now includes the confirmed fraud precedent and accuracy stat
7. Submit feedback on second case: "false_positive" (agent was wrong)
8. Run investigation on a third similar transaction — verify the precedent brief now includes both the confirmed fraud and false-positive precedents, and the accuracy stat reflects 50% (1 of 2 agreed)

---

## Implementation Order and Dependencies

```
Phase 1: agent_memory schema fields + buildLessonMemory()
    |
    +--> Phase 2: Memory Retrieval Agent (buildPrecedentBrief)
    |        |
    |        +--> Phase 3: Refactor Investigation Agent
    |                 |
    |                 +--> Phase 4: Decision Agent
    |                          |
    |                          +--> Phase 6: LangGraph wiring (investigation cycle)
    |                                   |
    |                                   +--> Phase 7: Server integration (investigate endpoint)
    |                                            |
    |                                            +--> Phase 9: Frontend (investigate.html)
    |
    +--> Phase 5: Learning Cycle Agents
                 |
                 +--> Phase 6: LangGraph wiring (learning cycle)
                          |
                          +--> Phase 7: Server integration (feedback endpoint)
                                   |
                                   +--> Phase 8: CLI update
                                            |
                                            +--> Phase 10: Verification
```

**Critical path:** Phase 1 -> 2 -> 3 -> 4 -> 6 -> 7 (investigation endpoint)

**Can be done in parallel:** Phases 2-4 and Phase 5 are independent — two developers could work on them simultaneously after Phase 1.

**Estimated effort:**

- Phases 1-4 (investigation cycle): 2-3 days
- Phase 5 (learning cycle): 1-2 days
- Phase 6 (graph wiring): 0.5 day
- Phase 7 (server integration): 0.5 day
- Phase 9 (frontend): 1 day
- Phase 10 (verification): 0.5 day
- **Total: ~5-7 days for a single developer**

---

## What This Does NOT Change

- **The analyst chatbot** (`fraud-analyst-chat.js`) — remains a standalone agent with its own tools. It already calls `search_agent_memory` and benefits from richer memory as lessons accumulate, without any code change.
- **The stream processing pipeline** — unchanged. It still scores and flags transactions.
- **The `agent_memory` autoEmbed index** — unchanged. The `summary` field still carries natural-language text. New `lesson_learned` documents are automatically embedded.
- **The existing `analyst_feedback` memory type** — still written by the feedback endpoint. The new `lesson_learned` type is additive. Both coexist and both are searchable.
- **The chat session memory system** — unchanged. Short-term conversation memory is orthogonal to this learning loop.

The design is deliberately additive: every new piece extends the existing system without requiring changes to working components. The learning loop bootstraps naturally — it starts empty and gets smarter with every human review.
