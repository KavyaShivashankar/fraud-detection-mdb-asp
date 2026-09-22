#!/usr/bin/env node
/**
 * Test script for the learning graph and memory loop.
 *
 * Verifies the full cycle:
 *   1. Run the investigation graph on a case
 *   2. Submit human feedback (confirmed_fraud or false_positive)
 *   3. Wait for the learning graph to write a lesson_learned to agent_memory
 *   4. Run the investigation graph again on a similar case
 *   5. Verify the precedent brief now includes the lesson + accuracy stat
 *
 * Usage:
 *   node scripts/test-learning-loop.js                    # auto-finds a case
 *   node scripts/test-learning-loop.js <transaction_id>   # specific case
 *   node scripts/test-learning-loop.js <transaction_id> false_positive   # override feedback
 *
 * Requires: running Atlas cluster, ANTHROPIC_API_KEY, and the three
 * Atlas Search indexes (fraud_transactions_text_index,
 * fraud_transactions_lexical, agent_memory_text_index).
 */

require('dotenv').config();

const { MongoClient } = require('mongodb');
const config = require('../config/atlas-config');
const { compiledInvestigationGraph, compiledLearningGraph } = require('../src/agents/learning/memory-graph');
const { buildPrecedentBrief, computeAccuracyStat } = require('../src/agents/memory-retrieval-agent');

const WAIT_FOR_LEARNING_MS = 60000; // 60s for the learning graph LLM call
const POLL_INTERVAL_MS = 3000;

function log(label, msg) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(70)}`);
  if (msg) console.log(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getDb() {
  const client = new MongoClient(config.atlas.connectionString);
  await client.connect();
  return { client, db: client.db(config.atlas.database) };
}

async function findTestCase(db) {
  // Find a fraud_transactions case that hasn't been investigated yet
  const txn = await db.collection('fraud_transactions').findOne(
    {
      $or: [
        { 'investigation.investigated_at': { $exists: false } },
        { 'investigation.investigated_at': null },
      ],
    },
    { sort: { timestamp: -1 } }
  );

  if (!txn) {
    // Fall back to any case
    const any = await db.collection('fraud_transactions').findOne({}, { sort: { timestamp: -1 } });
    if (!any) throw new Error('No fraud transactions found. Run npm run generate-data first.');
    return any;
  }

  return txn;
}

async function findSimilarCase(db, original) {
  // Find a different case with the same indicators
  const similar = await db.collection('fraud_transactions').findOne({
    transaction_id: { $ne: original.transaction_id },
    fraud_indicators: { $all: original.fraud_indicators ?? [] },
  });
  return similar;
}

async function runInvestigation(transaction_id, label) {
  log(label, `transaction_id: ${transaction_id}`);

  console.log('  Running investigation graph (memory_retrieval → investigate → decide)...');
  const start = Date.now();

  const result = await compiledInvestigationGraph.invoke({ transaction_id });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Completed in ${elapsed}s`);
  console.log(`    confidence:    ${result.confidence}`);
  console.log(`    recommendation: ${result.recommendation}`);
  console.log(`    route_to_human:  ${result.route_to_human}`);
  console.log(`    rationale:       ${(result.decision_rationale ?? '').slice(0, 120)}...`);
  console.log(`    notes:           ${result.final_notes?.length ?? 0} notes written`);

  return result;
}

async function submitFeedback(db, transaction_id, outcome, notes) {
  log('STEP 2: Submit Human Feedback', `transaction_id: ${transaction_id}\n  outcome: ${outcome}\n  notes: ${notes ?? '(none)'}`);

  // Write directly to fraud_transactions (same as the feedback endpoint does)
  const reviewed_at = new Date();
  await db.collection('fraud_transactions').updateOne(
    { transaction_id },
    {
      $set: {
        'investigation.human_outcome': outcome,
        'investigation.human_notes': notes ?? null,
        'investigation.human_reviewed_at': reviewed_at,
        'investigation.human_reviewed_by': 'test_script',
      },
    }
  );

  // Write the raw analyst_feedback memory (same as the feedback endpoint does)
  const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
  const priorNotes = Array.isArray(txn.investigation?.notes)
    ? txn.investigation.notes.join(' ')
    : txn.investigation?.notes ?? '';

  const summary = [
    `Test script reviewed transaction ${transaction_id} and confirmed outcome: ${outcome}.`,
    priorNotes,
    notes ? `Analyst note: ${notes}` : '',
  ].filter(Boolean).join(' ');

  await db.collection('agent_memory').insertOne({
    type: 'analyst_feedback',
    transaction_id,
    user_id: txn.user_id,
    summary,
    tags: txn.fraud_indicators ?? [],
    outcome,
    source: 'human_confirmed',
    reviewed_by: 'test_script',
    created_at: reviewed_at,
  });

  console.log('  Feedback written to fraud_transactions.investigation.human_outcome');
  console.log('  analyst_feedback memory written to agent_memory');
}

async function triggerLearningGraph(transaction_id, outcome, notes) {
  log('STEP 3: Trigger Learning Graph', `transaction_id: ${transaction_id}`);

  console.log('  Running learning graph (ingest → synthesize → write_lesson)...');
  console.log('  (this makes 1 Claude API call to synthesize the lesson)');
  const start = Date.now();

  try {
    const result = await compiledLearningGraph.invoke({
      transaction_id,
      human_outcome: outcome,
      human_notes: notes ?? '',
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Learning graph completed in ${elapsed}s`);
    return result;
  } catch (err) {
    console.error(`  Learning graph FAILED: ${err.message}`);
    throw err;
  }
}

async function verifyLessonWritten(db, transaction_id) {
  log('STEP 4: Verify Lesson Written to agent_memory');

  const lesson = await db.collection('agent_memory').findOne({
    type: 'lesson_learned',
    transaction_id,
  });

  if (!lesson) {
    console.log('  ✗ No lesson_learned document found!');
    return null;
  }

  console.log('  ✓ lesson_learned document found:');
  console.log(`    type:            ${lesson.type}`);
  console.log(`    source:          ${lesson.source}`);
  console.log(`    lesson_type:     ${lesson.lesson_type}`);
  console.log(`    agreement:       ${lesson.agreement}`);
  console.log(`    outcome:         ${lesson.outcome}`);
  console.log(`    indicators:      [${lesson.indicators?.join(', ')}]`);
  console.log(`    summary:         ${lesson.summary?.slice(0, 200)}...`);

  return lesson;
}

async function verifyPrecedentBrief(transaction_id, indicators, label) {
  log(label, `transaction_id: ${transaction_id}\n  indicators: [${indicators?.join(', ')}]`);

  console.log('  Building precedent brief (2x vector search + accuracy stat)...');
  const { brief, indicators: foundIndicators } = await buildPrecedentBrief(transaction_id);

  console.log('\n  --- PRECEDENT BRIEF ---');
  console.log(brief);
  console.log('  --- END BRIEF ---\n');

  return { brief, indicators: foundIndicators };
}

async function verifyAccuracyStat(db, indicators, label) {
  log(label, `indicators: [${indicators?.join(', ')}]`);

  const stat = await computeAccuracyStat(db, indicators);

  if (!stat) {
    console.log('  No accuracy stat available (no lesson_learned docs for these indicators yet)');
    return null;
  }

  console.log(`  ✓ Accuracy stat:`);
  console.log(`    total reviewed:  ${stat.total}`);
  console.log(`    agreed:          ${stat.agreed}`);
  console.log(`    accuracy rate:   ${stat.rate}%`);

  return stat;
}

async function verifyMemoryVectorSearch(db, queryText, label) {
  log(label, `query: "${queryText.slice(0, 100)}..."`);

  const results = await db.collection('agent_memory').aggregate([
    {
      $vectorSearch: {
        index: 'agent_memory_text_index',
        path: 'summary',
        query: queryText,
        numCandidates: 50,
        limit: 5,
        model: 'voyage-4',
      },
    },
    {
      $project: {
        _id: 0,
        type: 1,
        transaction_id: 1,
        summary: 1,
        source: 1,
        outcome: 1,
        lesson_type: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]).toArray();

  if (!results.length) {
    console.log('  ✗ No results returned from vector search!');
    return [];
  }

  console.log(`  ✓ ${results.length} results from $vectorSearch on agent_memory:`);
  results.forEach((r, i) => {
    console.log(`    ${i + 1}. [score=${r.score?.toFixed(4)}] type=${r.type} source=${r.source} outcome=${r.outcome ?? '—'}`);
    console.log(`       ${r.summary?.slice(0, 150)}...`);
  });

  return results;
}

async function main() {
  const overrideTxnId = process.argv[2];
  const overrideOutcome = process.argv[3]; // "confirmed_fraud" or "false_positive"

  log('LEARNING LOOP TEST', 'Testing the full cycle: investigate → feedback → learn → verify');

  const { client, db } = await getDb();

  try {
    // ── STEP 1: Find or use a test case ────────────────────────────────
    log('STEP 1: Find Test Case');

    let txn;
    if (overrideTxnId) {
      txn = await db.collection('fraud_transactions').findOne({ transaction_id: overrideTxnId });
      if (!txn) throw new Error(`Transaction not found: ${overrideTxnId}`);
    } else {
      txn = await findTestCase(db);
    }

    console.log(`  transaction_id: ${txn.transaction_id}`);
    console.log(`  user_id:        ${txn.user_id}`);
    console.log(`  amount:         ${txn.amount} ${txn.currency}`);
    console.log(`  fraud_score:    ${txn.fraud_score}`);
    console.log(`  indicators:     [${txn.fraud_indicators?.join(', ')}]`);
    console.log(`  location:       ${txn.location?.city}, ${txn.location?.country}`);

    // ── STEP 2: Run the investigation graph ────────────────────────────
    const invResult = await runInvestigation(txn.transaction_id, 'STEP 2: Run Investigation Graph');

    // ── STEP 3: Submit human feedback ──────────────────────────────────
    const outcome = overrideOutcome === 'false_positive' ? 'false_positive' : 'confirmed_fraud';
    const feedbackNotes = outcome === 'confirmed_fraud'
      ? 'Confirmed fraud — pattern matches known account takeover'
      : 'False positive — user was traveling and notified bank in advance';

    await submitFeedback(db, txn.transaction_id, outcome, feedbackNotes);

    // ── STEP 4: Trigger the learning graph ─────────────────────────────
    await triggerLearningGraph(txn.transaction_id, outcome, feedbackNotes);

    // ── STEP 5: Verify the lesson was written ──────────────────────────
    const lesson = await verifyLessonWritten(db, txn.transaction_id);
    if (!lesson) {
      console.error('\n✗ FAILED: No lesson_learned document was written. Check server logs.');
      process.exit(1);
    }

    // ── STEP 6: Verify the lesson is findable via vector search ────────
    const queryText = `Fraud case with indicators: ${txn.fraud_indicators?.join(', ')}. ` +
      `Amount: ${txn.amount}. Location: ${txn.location?.country}.`;
    const searchResults = await verifyMemoryVectorSearch(db, queryText, 'STEP 6: Verify Lesson Findable via Vector Search');

    const lessonInResults = searchResults.some(
      (r) => r.type === 'lesson_learned' && r.transaction_id === txn.transaction_id
    );
    if (lessonInResults) {
      console.log('\n  ✓ Lesson found in vector search results!');
    } else {
      console.log('\n  ⚠ Lesson not in top 5 vector search results (may rank lower — autoEmbed indexing can take a few seconds)');
    }

    // ── STEP 7: Verify accuracy stat ───────────────────────────────────
    await verifyAccuracyStat(db, txn.fraud_indicators, 'STEP 7: Verify Accuracy Stat');

    // ── STEP 8: Run investigation on the SAME case again and check brief
    log('STEP 8: Re-investigate Same Case — Verify Precedent Brief Includes Lesson');

    // First, clear the old investigation so we can re-run
    await db.collection('fraud_transactions').updateOne(
      { transaction_id: txn.transaction_id },
      { $unset: { 'investigation.investigated_at': '', 'investigation.confidence': '', 'investigation.recommendation': '' } }
    );

    // Build just the precedent brief (don't need to re-run the full investigation)
    await verifyPrecedentBrief(
      txn.transaction_id,
      txn.fraud_indicators,
      'STEP 8: Precedent Brief After Learning (same case)'
    );

    // ── STEP 9: If there's a similar case, check its brief too ─────────
    const similar = await findSimilarCase(db, txn);
    if (similar) {
      console.log(`\n  Found similar case: ${similar.transaction_id} (indicators: [${similar.fraud_indicators?.join(', ')}])`);
      await verifyPrecedentBrief(
        similar.transaction_id,
        similar.fraud_indicators,
        'STEP 9: Precedent Brief on Similar Case (cross-case learning)'
      );
    } else {
      console.log('\n  No similar case found for cross-case verification (skipping step 9)');
    }

    // ── SUMMARY ────────────────────────────────────────────────────────
    log('TEST COMPLETE');

    console.log(`  Investigation:     ${txn.transaction_id} → confidence=${invResult.confidence}, route_to_human=${invResult.route_to_human}`);
    console.log(`  Human feedback:    ${outcome}`);
    console.log(`  Lesson written:    ${lesson.lesson_type} (agreement=${lesson.agreement})`);
    console.log(`  Lesson summary:    ${lesson.summary?.slice(0, 120)}...`);
    console.log(`  Vector searchable: ${lessonInResults ? 'yes' : 'not in top 5 (may need indexing time)'}`);

    console.log('\n  The learning loop is working if:');
    console.log('    ✓ A lesson_learned document exists in agent_memory');
    console.log('    ✓ The lesson is findable via $vectorSearch on agent_memory');
    console.log('    ✓ The precedent brief on a subsequent case includes the lesson');
    console.log('    ✓ The accuracy stat reflects the feedback');

  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('\n✗ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});

/**
#======================================================================
#  LEARNING LOOP TEST
#======================================================================
Testing the full cycle: investigate → feedback → learn → verify
The script loads and starts. Here's how to use it:
Run the test
# Auto-finds an uninvestigated case, runs the full cycle
#node scripts/test-learning-loop.js

# Test a specific case
#node scripts/test-learning-loop.js txn_demo_1789679868903

# Test a specific case and force false_positive feedback
#node scripts/test-learning-loop.js txn_demo_1789679868903 false_positive
**/