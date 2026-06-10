require('dotenv').config();

const express = require('express');
const path = require('path');
const { runFraudAnalyst } = require('./agents/fraud-analyst-chat');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Fraud Analyst chatbot running at http://localhost:${PORT}`);
});
