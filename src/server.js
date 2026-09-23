require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { MongoClient } = require('mongodb');
const config = require('../config/atlas-config');
const { runFraudAnalyst, summarizeConversation } = require('./agents/fraud-analyst-chat');
const { compiledInvestigationGraph, compiledLearningGraph, setInvestigationEventCallback } = require('./agents/learning/memory-graph');

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Identity — a name-only login (design A: identity for attribution, not a
// security boundary). The cookie is unsigned and unverified on purpose;
// anyone can set analyst_id themselves. Its only job is to give chat
// sessions and analyst feedback a stable, human-readable owner instead of
// an anonymous browser-local UUID.
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = new Set(['/login.html', '/api/login']);

function identifyAnalyst(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const analystId = req.cookies?.analyst_id;
  if (!analystId) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not_logged_in' });
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }

  req.analystId = analystId;
  req.analystName = req.cookies?.analyst_name || analystId;
  next();
}

app.use(identifyAnalyst);

app.post('/api/login', async (req, res) => {
  const { name, email } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const trimmedName = name.trim();
  const analystId = (email && email.trim() ? email.trim().toLowerCase() : trimmedName.toLowerCase()).replace(/\s+/g, '_');

  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    await client
      .db(config.atlas.database)
      .collection('analysts')
      .updateOne(
        { _id: analystId },
        {
          $set: { name: trimmedName, email: email?.trim() || null, last_seen_at: new Date() },
          $setOnInsert: { created_at: new Date() },
        },
        { upsert: true }
      );

    const cookieOpts = { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 };
    res.cookie('analyst_id', analystId, cookieOpts);
    res.cookie('analyst_name', trimmedName, cookieOpts);
    res.json({ success: true, analyst_id: analystId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie('analyst_id');
  res.clearCookie('analyst_name');
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  res.json({ analyst_id: req.analystId, name: req.analystName });
});

// Session memory: how many messages a chat session keeps verbatim before
// the oldest overflow gets compressed into `summary` and trimmed.
const SESSION_WINDOW = 20;

// Compresses the oldest overflow of a session's message buffer into its
// rolling summary, then trims the buffer back down to SESSION_WINDOW.
// Runs after the response has already been sent, so a summarization
// failure never blocks the chat turn — it just skips trimming this time.
async function trimSession(sessions, session_id) {
  const session = await sessions.findOne({ _id: session_id }, { projection: { messages: 1, summary: 1 } });
  if (!session || session.messages.length <= SESSION_WINDOW) return;

  const overflowCount = session.messages.length - SESSION_WINDOW;
  const overflow = session.messages.slice(0, overflowCount);

  try {
    const summary = await summarizeConversation(overflow, session.summary);
    await sessions.updateOne(
      { _id: session_id },
      { $set: { summary, messages: session.messages.slice(overflowCount) } }
    );
  } catch (err) {
    console.error('[server] Session summarization failed, buffer left untrimmed:', err);
  }
}

// API routes must be registered before express.static so they are matched first
app.post('/api/chat', async (req, res) => {
  const { message, searchMode = 'hybrid' } = req.body;
  const session_id = req.analystId; // one continuous conversation per logged-in analyst

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const validModes = ['vector', 'lexical', 'hybrid'];
  const resolvedMode = validModes.includes(searchMode) ? searchMode : 'hybrid';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const sessions = client.db(config.atlas.database).collection('chat_sessions');

    const session = await sessions.findOneAndUpdate(
      { _id: session_id },
      { $setOnInsert: { created_at: new Date(), updated_at: new Date(), messages: [], summary: null } },
      { upsert: true, returnDocument: 'after' }
    );

    const history = session.summary
      ? [{ role: 'user', content: `[Earlier conversation summary]: ${session.summary}` }, ...session.messages]
      : session.messages;

    let assistantText = '';
    try {
      for await (const event of runFraudAnalyst(message, history, resolvedMode)) {
        if (event.type === 'token') assistantText = event.text;
        send(event);
        if (event.type === 'done') break;
      }
    } catch (err) {
      console.error('[server] Agent error:', err);
      send({ type: 'error', text: err.message });
      send({ type: 'done' });
    }

    const now = new Date();
    await sessions.updateOne(
      { _id: session_id },
      {
        $push: { messages: { $each: [
          { role: 'user', content: message },
          { role: 'assistant', content: assistantText },
        ] } },
        $set: { updated_at: now, search_mode: resolvedMode },
      }
    );

    await trimSession(sessions, session_id);
  } catch (err) {
    console.error('[server] Chat session error:', err);
    send({ type: 'error', text: err.message });
    send({ type: 'done' });
  } finally {
    await client.close();
  }

  res.end();
});

// Insert a simulated transaction to trigger the stream processor
app.post('/api/transactions', async (req, res) => {
  const txn = req.body;
  if (!txn || typeof txn !== 'object') {
    return res.status(400).json({ error: 'Transaction body is required' });
  }

  // Auto-generate ID and timestamp if omitted; force status to pending
  if (!txn.transaction_id) txn.transaction_id = `txn_demo_${Date.now()}`;
  txn.timestamp = txn.timestamp ? new Date(txn.timestamp) : new Date();
  txn.status = 'pending';
  txn.fraud_score = 0;
  txn.fraud_indicators = [];
  txn.is_fraudulent = false;

  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    await client.db(config.atlas.database).collection('transactions').insertOne(txn);
    res.json({ success: true, transaction_id: txn.transaction_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});

// List recent fraud transactions for the investigation UI case list
app.get('/api/fraud-transactions', async (_req, res) => {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const cases = await client
      .db(config.atlas.database)
      .collection('fraud_transactions')
      .find({})
      .sort({ timestamp: -1 })
      .limit(30)
      .project({
        _id: 0, transaction_id: 1, user_id: 1, amount: 1, currency: 1,
        fraud_score: 1, fraud_indicators: 1, location: 1, merchant: 1,
        device: 1, timestamp: 1,
        'investigation.investigated_at': 1,
        'investigation.routed_to_human': 1,
        'investigation.confidence': 1,
        'investigation.recommendation': 1,
        'investigation.decision_rationale': 1,
        'investigation.notes': 1,
        'investigation.human_outcome': 1,
        'investigation.human_reviewed_at': 1,
        'investigation.precedent_brief': 1,
      })
      .toArray();
    res.json(cases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});


// Check if a lesson_learned document exists for a transaction (used by graph.html polling)
app.get('/api/lessons/:transaction_id', async (req, res) => {
  const { transaction_id } = req.params;
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const lesson = await client
      .db(config.atlas.database)
      .collection('agent_memory')
      .findOne(
        { type: 'lesson_learned', transaction_id },
        { projection: { _id: 0, summary: 1, lesson_type: 1, agreement: 1, outcome: 1, indicators: 1, created_at: 1 } }
      );
    if (!lesson) return res.status(404).json({ found: false });
    res.json({ found: true, ...lesson });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});

// Get accuracy stats for a transaction's indicators (used by graph.html gauge)
app.get('/api/accuracy-stats/:transaction_id', async (req, res) => {
  const { transaction_id } = req.params;
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    const indicators = txn.fraud_indicators ?? [];
    if (!indicators.length) return res.json({ rate: null, total: 0, agreed: 0, indicators });

    const result = await db.collection('agent_memory').aggregate([
      { $match: { type: 'lesson_learned', source: 'human_confirmed' } },
      { $match: { indicators: { $all: indicators } } },
      { $group: { _id: null, total: { $sum: 1 }, agreed: { $sum: { $cond: ['$agreement', 1, 0] } } } },
    ]).toArray();

    if (!result.length) return res.json({ rate: null, total: 0, agreed: 0, indicators });

    const { total, agreed } = result[0];
    res.json({ rate: Math.round((agreed / total) * 100), total, agreed, indicators });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});


// Get the precedent brief for a transaction (used by learning-flow.html)
app.get('/api/precedent-brief/:transaction_id', async (req, res) => {
  const { transaction_id } = req.params;
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    const indicators = txn.fraud_indicators ?? [];
    const queryText = [
      `Fraud case with indicators: ${indicators.join(', ')}`,
      `Amount: ${txn.amount} ${txn.currency}`,
      `Location: ${txn.location?.country}, ${txn.location?.city}`,
      `Device: ${txn.device?.device_type}, ${txn.device?.os}`,
      `Merchant: ${txn.merchant?.merchant_name}`,
    ].join('. ');

    // Try $vectorSearch first, fall back to $match on indicators if no results
    let verified = [];
    let allMemory = [];

    try {
      [verified, allMemory] = await Promise.all([
        db.collection('agent_memory').aggregate([
          { $vectorSearch: { index: 'agent_memory_text_index', path: 'summary', query: queryText, numCandidates: 50, limit: 10, model: 'voyage-4' } },
          { $match: { source: 'human_confirmed' } },
          { $limit: 6 },
          { $project: { _id: 0, type: 1, transaction_id: 1, summary: 1, outcome: 1, lesson_type: 1, indicators: 1, created_at: 1, score: { $meta: 'vectorSearchScore' } } },
        ]).toArray(),
        db.collection('agent_memory').aggregate([
          { $vectorSearch: { index: 'agent_memory_text_index', path: 'summary', query: queryText, numCandidates: 50, limit: 10, model: 'voyage-4' } },
          { $limit: 6 },
          { $project: { _id: 0, type: 1, transaction_id: 1, summary: 1, source: 1, outcome: 1, score: { $meta: 'vectorSearchScore' } } },
        ]).toArray(),
      ]);
    } catch (e) {
      // Vector search failed (index might not exist) — fall through to fallback
    }

    // Fallback: if vector search returned nothing, use $match on indicators
    if (verified.length === 0 && allMemory.length === 0 && indicators.length > 0) {
      [verified, allMemory] = await Promise.all([
        db.collection('agent_memory').aggregate([
          { $match: { source: 'human_confirmed', transaction_id: { $ne: transaction_id } } },
          { $match: { $or: [
            { indicators: { $all: indicators } },
            { tags: { $all: indicators } },
          ] } },
          { $sort: { created_at: -1 } },
          { $limit: 6 },
          { $project: { _id: 0, type: 1, transaction_id: 1, summary: 1, outcome: 1, lesson_type: 1, indicators: 1, created_at: 1, score: null } },
        ]).toArray(),
        db.collection('agent_memory').aggregate([
          { $match: { source: 'agent', transaction_id: { $ne: transaction_id } } },
          { $match: { $or: [
            { indicators: { $all: indicators } },
            { tags: { $all: indicators } },
          ] } },
          { $sort: { created_at: -1 } },
          { $limit: 6 },
          { $project: { _id: 0, type: 1, transaction_id: 1, summary: 1, source: 1, outcome: 1, score: null } },
        ]).toArray(),
      ]);
    }

    // Accuracy stat
    let accuracy = null;
    if (indicators.length) {
      const statResult = await db.collection('agent_memory').aggregate([
        { $match: { type: 'lesson_learned', source: 'human_confirmed' } },
        { $match: { indicators: { $all: indicators } } },
        { $group: { _id: null, total: { $sum: 1 }, agreed: { $sum: { $cond: ['$agreement', 1, 0] } } } },
      ]).toArray();
      if (statResult.length) {
        const { total, agreed } = statResult[0];
        accuracy = { total, agreed, rate: Math.round((agreed / total) * 100) };
      }
    }

    const confirmedFraud = verified.filter(m => m.outcome === 'confirmed_fraud');
    const confirmedFalsePositive = verified.filter(m => m.outcome === 'false_positive');
    const unverified = allMemory.filter(m => m.source === 'agent');

    res.json({
      transaction_id,
      indicators,
      queryText,
      confirmedFraud,
      confirmedFalsePositive,
      unverified,
      accuracy,
      storedPrecedentBrief: txn.investigation?.precedent_brief || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});

// Run the investigation graph and stream progress events.
// The investigation graph nodes emit events via a module-level callback
// (setInvestigationEventCallback) that forwards to the SSE stream in real time.
// This gives the browser live tool-by-tool progress instead of waiting for
// each graph node to complete.
app.post('/api/investigate', async (req, res) => {
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Set the callback that the graph nodes will call for every event.
  // This fires in real time — each tool start/done, findings, token, error.
  setInvestigationEventCallback((event) => {
    send(event);
  });

  try {
    console.log(`[server] Investigation started for ${transaction_id}`);

    const stream = await compiledInvestigationGraph.stream(
      { transaction_id },
      { streamMode: 'updates' }
    );

    for await (const chunk of stream) {
      const [nodeName] = Object.entries(chunk)[0];

      if (nodeName === 'decide') {
        // Decision node completion means the graph is done.
        // The individual tool events were already streamed via the callback.
        send({ type: 'done' });
      }
    }

    console.log(`[server] Investigation complete for ${transaction_id}`);
  } catch (err) {
    console.error('[server] Investigation error:', err);
    send({ type: 'error', text: err.message });
    send({ type: 'done' });
  } finally {
    setInvestigationEventCallback(null);
  }

  res.end();
});

// Records a human analyst's verdict on an investigated transaction — the
// ground-truth signal that distinguishes verified outcomes from the agent's
// own unverified conclusions in long-term memory.
app.post('/api/fraud-transactions/:transaction_id/feedback', async (req, res) => {
  const { transaction_id } = req.params;
  const { outcome, notes } = req.body;

  const validOutcomes = ['confirmed_fraud', 'false_positive'];
  if (!validOutcomes.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${validOutcomes.join(', ')}` });
  }

  const client = new MongoClient(config.atlas.connectionString);
  const reviewed_at = new Date();
  try {
    await client.connect();
    const db = client.db(config.atlas.database);

    const txn = await db.collection('fraud_transactions').findOne({ transaction_id });
    if (!txn) return res.status(404).json({ error: `No fraud transaction found for transaction_id: ${transaction_id}` });

    await db.collection('fraud_transactions').updateOne(
      { transaction_id },
      {
        $set: {
          'investigation.human_outcome': outcome,
          'investigation.human_notes': notes ?? null,
          'investigation.human_reviewed_at': reviewed_at,
          'investigation.human_reviewed_by': req.analystId,
        },
      }
    );

    const priorNotes = Array.isArray(txn.investigation?.notes)
      ? txn.investigation.notes.join(' ')
      : txn.investigation?.notes ?? '';

    const summary = [
      `Human analyst (${req.analystName}) reviewed transaction ${transaction_id} and confirmed outcome: ${outcome}.`,
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
      reviewed_by: req.analystId,
      created_at: reviewed_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }

  // Trigger the learning cycle asynchronously — don't block the response.
  // The user gets immediate confirmation; the lesson is generated in the background.
  compiledLearningGraph.invoke({
    transaction_id,
    human_outcome: outcome,
    human_notes: notes ?? '',
  }).catch((err) => {
    console.error('[learning] Lesson synthesis failed:', err);
  });

  res.json({ success: true, transaction_id, outcome, reviewed_at });
});

// Static files served last so API routes always take precedence
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// Idle chat sessions expire automatically after 14 days.
async function ensureIndexes() {
  const client = new MongoClient(config.atlas.connectionString);
  try {
    await client.connect();
    await client
      .db(config.atlas.database)
      .collection('chat_sessions')
      .createIndex({ updated_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });
  } finally {
    await client.close();
  }
}

ensureIndexes()
  .catch((err) => console.error('[server] Failed to ensure indexes:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Fraud Analyst chatbot running at http://localhost:${PORT}`);
    });
  });
