require('dotenv').config();

const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const config = require('../config/atlas-config');
const { runFraudAnalyst } = require('./agents/fraud-analyst-chat');
const { runFraudInvestigationStream } = require('./agents/fraud-investigation-stream');

const app = express();
app.use(express.json());

// API routes must be registered before express.static so they are matched first
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    for await (const event of runFraudAnalyst(message, history)) {
      send(event);
      if (event.type === 'done') break;
    }
  } catch (err) {
    console.error('[server] Agent error:', err);
    send({ type: 'error', text: err.message });
    send({ type: 'done' });
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
        device: 1, timestamp: 1, 'investigation.investigated_at': 1,
      })
      .toArray();
    res.json(cases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});

// Run the investigation agent and stream progress events
app.post('/api/investigate', async (req, res) => {
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    for await (const event of runFraudInvestigationStream(transaction_id)) {
      send(event);
      if (event.type === 'done') break;
    }
  } catch (err) {
    console.error('[server] Investigation error:', err);
    send({ type: 'error', text: err.message });
    send({ type: 'done' });
  }

  res.end();
});

// Static files served last so API routes always take precedence
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Fraud Analyst chatbot running at http://localhost:${PORT}`);
});
