require('dotenv').config();

const { StateGraph, START, END, Annotation } = require('@langchain/langgraph');
const { MongoClient } = require('mongodb');
const config = require('../../../config/atlas-config');

const { buildPrecedentBrief } = require('../memory-retrieval-agent');
const { runInvestigationAgent } = require('../fraud-investigation-stream');
const { makeDecision, writeDecision } = require('../decision-agent');
const { ingestOutcome } = require('./outcome-ingest-agent');
const { synthesizeLesson } = require('./memory-synthesis-agent');
const { buildLessonMemory } = require('../agent-memory-tool');

// ---------------------------------------------------------------------------
// State schemas
// ---------------------------------------------------------------------------

const InvestigationState = Annotation.Root({
  transaction_id: Annotation(),
  precedentBrief: Annotation(),
  indicators: Annotation(),
  findings: Annotation(),
  confidence: Annotation(),
  recommendation: Annotation(),
  route_to_human: Annotation(),
  decision_rationale: Annotation(),
  final_notes: Annotation(),
});

const LearningState = Annotation.Root({
  transaction_id: Annotation(),
  human_outcome: Annotation(),
  human_notes: Annotation(),
  ingested: Annotation(),
  lesson_summary: Annotation(),
});

// ---------------------------------------------------------------------------
// Event callback — set by the server before streaming the investigation graph.
// LangGraph strips undeclared fields from state, so we can't pass the callback
// through state. Instead, the server calls setInvestigationEventCallback() and
// the investigationNode reads it via the module-level variable.
// ---------------------------------------------------------------------------

let _investigationEventCallback = null;

function setInvestigationEventCallback(cb) {
  _investigationEventCallback = cb;
}

function emitEvent(event) {
  if (_investigationEventCallback) _investigationEventCallback(event);
}

// ---------------------------------------------------------------------------
// Investigation cycle nodes
// ---------------------------------------------------------------------------

async function memoryRetrievalNode(state) {
  console.log(`[graph] memory_retrieval: fetching precedent brief for ${state.transaction_id}`);
  emitEvent({ type: 'step_start', tool: 'memory_retrieval', args: { transaction_id: state.transaction_id } });
  const { brief, indicators } = await buildPrecedentBrief(state.transaction_id);
  console.log(`[graph] memory_retrieval: done — ${indicators.length} indicators, brief length ${brief.length}`);
  emitEvent({ type: 'step_done', tool: 'memory_retrieval', result: { indicators, brief } });

  // Persist the precedent brief so the learning-flow page can show
  // what the agent actually saw at investigation time (the "before" view)
  const mClient = new MongoClient(config.atlas.connectionString);
  try {
    await mClient.connect();
    await mClient.db(config.atlas.database)
      .collection('fraud_transactions')
      .updateOne(
        { transaction_id: state.transaction_id },
        { $set: { 'investigation.precedent_brief': brief } }
      );
  } catch (e) {
    console.error('[graph] memory_retrieval: failed to save precedent_brief:', e.message);
  } finally {
    await mClient.close();
  }

  return { precedentBrief: brief, indicators };
}

async function investigationNode(state) {
  console.log(`[graph] investigate: starting agent for ${state.transaction_id}`);
  let findings = '';
  let confidence = 'medium';
  let recommendation = 'escalate';

  for await (const event of runInvestigationAgent(state.transaction_id, state.precedentBrief)) {
    if (event.type === 'step_start') {
      console.log(`[graph] investigate: tool start — ${event.tool}(${JSON.stringify(event.args).slice(0, 120)})`);
      emitEvent({ type: 'step_start', tool: event.tool, args: event.args });
    } else if (event.type === 'step_done') {
      const summary = summarizeToolResult(event.tool, event.result);
      console.log(`[graph] investigate: tool done — ${event.tool} → ${summary}`);
      emitEvent({ type: 'step_done', tool: event.tool, result: event.result });
    } else if (event.type === 'findings_submitted') {
      findings = event.findings;
      confidence = event.confidence;
      recommendation = event.recommendation;
      console.log(`[graph] investigate: findings submitted — confidence=${confidence}, recommendation=${recommendation}`);
      emitEvent({ type: 'findings_submitted', findings, confidence, recommendation });
    } else if (event.type === 'token') {
      console.log(`[graph] investigate: agent final response (${event.text.length} chars)`);
      emitEvent({ type: 'token', text: event.text });
    } else if (event.type === 'error') {
      console.error(`[graph] investigate: agent error — ${event.text}`);
      emitEvent({ type: 'error', text: event.text });
    }
  }

  console.log(`[graph] investigate: done — confidence=${confidence}, recommendation=${recommendation}`);
  return { findings, confidence, recommendation };
}

function summarizeToolResult(tool, result) {
  if (!result) return 'empty';
  if (tool === 'fetch_fraud_transaction') {
    const t = result.fraud_transaction ?? result;
    return `score=${t.fraud_score}, amount=${t.amount}`;
  }
  if (tool === 'fetch_user_history') {
    return `txns=${result.transaction_count}, has_profile=${!!result.profile}`;
  }
  if (tool === 'search_similar_fraud_cases') {
    return `count=${result.count}`;
  }
  if (tool === 'submit_investigation_findings') {
    return `confidence=${result.confidence}, recommendation=${result.recommendation}`;
  }
  return Object.keys(result).join(',');
}

async function decisionNode(state) {
  console.log(`[graph] decide: making decision for ${state.transaction_id}`);
  console.log(`[graph] decide: confidence=${state.confidence}, recommendation=${state.recommendation}`);
  emitEvent({ type: 'step_start', tool: 'decision', args: { confidence: state.confidence, recommendation: state.recommendation } });

  const decision = await makeDecision({
    findings: state.findings,
    confidence: state.confidence,
    recommendation: state.recommendation,
    precedentBrief: state.precedentBrief,
    indicators: state.indicators,
  });

  console.log(`[graph] decide: route_to_human=${decision.route_to_human}, notes=${decision.final_notes?.length ?? 0}`);

  await writeDecision({
    transaction_id: state.transaction_id,
    route_to_human: decision.route_to_human,
    decision_rationale: decision.decision_rationale,
    final_notes: decision.final_notes,
    investigation_findings: state.findings,
    confidence: state.confidence,
    recommendation: state.recommendation,
  });

  console.log(`[graph] decide: written to fraud_transactions + agent_memory`);
  emitEvent({ type: 'step_done', tool: 'decision',
              result: { route_to_human: decision.route_to_human,
                        rationale: decision.decision_rationale,
                        notes: decision.final_notes } });
  return {
    route_to_human: decision.route_to_human,
    decision_rationale: decision.decision_rationale,
    final_notes: decision.final_notes,
  };
}

// ---------------------------------------------------------------------------
// Learning cycle nodes
// ---------------------------------------------------------------------------

async function outcomeIngestNode(state) {
  console.log(`[graph:learning] ingest: reading case ${state.transaction_id}, outcome=${state.human_outcome}`);
  const ingested = await ingestOutcome(
    state.transaction_id,
    state.human_outcome,
    state.human_notes
  );
  console.log(`[graph:learning] ingest: done — agreement=${ingested.agreement}, agent=${ingested.agent_conclusion}, human=${ingested.human_conclusion}`);
  return { ingested };
}

async function synthesisNode(state) {
  console.log(`[graph:learning] synthesize: generating lesson for ${state.ingested.transaction_id}`);
  const lessonSummary = await synthesizeLesson(state.ingested);
  console.log(`[graph:learning] synthesize: done — lesson length ${lessonSummary.length}`);
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

  console.log(`[graph:learning] write_lesson: inserted lesson_learned for ${state.ingested.transaction_id} — type=${lesson.lesson_type}, indicators=[${lesson.indicators.join(',')}]`);
  return { lesson_written: true };
}

// ---------------------------------------------------------------------------
// Compile graphs
// ---------------------------------------------------------------------------

const investigationGraph = new StateGraph(InvestigationState)
  .addNode('memory_retrieval', memoryRetrievalNode)
  .addNode('investigate', investigationNode)
  .addNode('decide', decisionNode)
  .addEdge(START, 'memory_retrieval')
  .addEdge('memory_retrieval', 'investigate')
  .addEdge('investigate', 'decide')
  .addEdge('decide', END);

const compiledInvestigationGraph = investigationGraph.compile();

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
  setInvestigationEventCallback,
};
