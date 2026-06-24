# Fraud Detection & Agent Demo — Powered by MongoDB

A demoable end-to-end fraud detection system built on MongoDB Atlas. Combines real-time stream processing, AI agents with tool-calling, and Atlas Vector Search in a single web interface designed for customer-facing demos.

---

## What This Demo Shows

| MongoDB Capability | Where It Appears |
|---|---|
| Atlas Stream Processing | Scores incoming transactions in real time, writes flagged cases to `fraud_transactions` |
| Atlas Vector Search (autoEmbed) | Semantic search over historical fraud cases — no client-side embedding required |
| Atlas Search (lexical / BM25) | Keyword search over merchant names, locations, device types, and fraud indicators |
| Hybrid Search (`$rankFusion`) | Combines vector + lexical results via Reciprocal Rank Fusion for best recall |
| Document model | Nested fraud indicators, device metadata, and investigation notes in a single record |
| AI agent with tool-calling | LangChain + Claude Sonnet investigates a case, writes findings back, routes to human or auto-close |
| Natural language → MQL | Conversational analyst generates and runs live aggregation pipelines from plain English |

---

## Architecture

```
Browser (simulate.html)
        │
        │  POST /api/transactions
        ▼
┌─────────────────────────────────────┐
│  transactions collection (Atlas)    │  ← insert here to trigger the pipeline
└──────────────────┬──────────────────┘
                   │
                   │  Atlas Stream Processing
                   │  (continuous aggregation on change stream)
                   ▼
          ┌─────────────────┐
          │  Scoring logic  │  $lookup user_profiles → evaluate 3 signals
          │  high_amount    │  score ≥ 70 → flagged
          │  unusual_loc    │
          │  new_device     │
          └────────┬────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  fraud_transactions collection       │  ← flagged cases land here
│  (includes autoEmbed vector field)   │
└──────────────────────────────────────┘
        │                    │
        │                    │
        ▼                    ▼
Investigation Agent    Interactive Analyst
(investigate.html)     (index.html)
  4-tool LangChain       Conversational chatbot
  agent streams          generates + runs MQL
  findings via SSE       via SSE
```

---

## The Three UI Surfaces

### Transaction Simulator (`/simulate.html`)
Inject test transactions directly from the browser using preset fraud scenarios. Five presets cover common patterns: all indicators firing, unusual location only, high amount only, new device only, and a clean baseline. Each submission posts to `POST /api/transactions`, which writes to the `transactions` collection and lets Atlas Stream Processing score it.

### Fraud Investigator (`/investigate.html`)
Displays the 30 most recent flagged cases from `fraud_transactions`. Clicking a case launches the investigation agent, which streams its reasoning steps to the browser in real time via Server-Sent Events. The agent runs four tools in sequence, writes its findings and routing decision back to the document, and renders a final markdown report.

### Interactive Analyst (`/`)
A conversational chat interface backed by a three-tool fraud analyst agent. Ask natural language questions — the agent determines whether to run a search, generate an aggregation, or fetch a user risk profile, then streams the response token by token.

A **search mode toggle** (Hybrid / Vector / Lexical) sits above the input bar and controls how `search_fraud_cases` retrieves results for that session:

| Mode | Mechanism | Best for |
|---|---|---|
| **Hybrid** (default) | `$rankFusion` combining vector + lexical via RRF (60/40 weight) | Best overall recall |
| **Vector** | `$vectorSearch` with autoEmbed (voyage-4) | Conceptual / pattern queries |
| **Lexical** | `$search` with BM25 over key fields | Exact merchant names, countries, device types |

---

## The AI Agents

### Investigation Agent (`src/agents/fraud-investigation-stream.js`)

Runs a fixed four-step protocol on a single `transaction_id`:

1. `fetch_fraud_transaction` — retrieves the flagged record
2. `fetch_user_history` — retrieves behavioral profile and recent transactions in parallel
3. `search_similar_fraud_cases` — semantic vector search for top-5 similar historical cases
4. `write_investigation_findings` — writes case notes and `route_to_human` decision back to the document

Implemented as an async generator that yields typed SSE events: `step_start`, `step_done`, `token`, `done`, `error`. The web UI renders each step as a timeline card and the final report as markdown.

There is also a CLI version (`src/agents/fraud-investigation-agent.js`) that takes `transaction_id` as a command-line argument and is kept separate — the web agent does not modify it.

### Fraud Analyst Chatbot (`src/agents/fraud-analyst-chat.js`)

Conversational agent with three tools:

| Tool | What it does |
|---|---|
| `search_fraud_cases` | Vector, lexical, or hybrid search over `fraud_transactions` — mode controlled by the UI toggle |
| `run_aggregation` | Executes model-generated MongoDB aggregation pipelines. Blocks `$out` and `$merge`; caps results at 50 |
| `get_user_risk_profile` | Fetches `user_profiles` + fraud history + recent transactions in a single parallel read |

The `run_aggregation` tool is the key capability: the model translates natural language into a valid MQL aggregation pipeline, which Atlas executes directly. The model sees the result set, not a bulk dump of raw data.

The `search_fraud_cases` tool supports three modes passed as a `mode` parameter. Hybrid mode uses `$rankFusion` to merge a `$vectorSearch` sub-pipeline and a `$search` (BM25) sub-pipeline, with weights 0.6 / 0.4. The active mode is injected into the agent's system prompt at request time based on the user's toggle selection.

---

## Collections

### `transactions`
Source collection. Every document inserted here is picked up by the Stream Processing pipeline. The pipeline writes `fraud_score`, `fraud_indicators`, `status`, and `is_fraudulent` back to the same document via `$merge`.

### `fraud_transactions`
Read model for flagged cases. Populated by Stream Processing when `fraud_score ≥ 70`. Contains the scored transaction plus an `investigation` subdocument that the agent populates after running. Also contains a `text` field used by the autoEmbed vector index.

### `user_profiles`
Behavioral baselines per user: `avg_transaction_amount`, `frequent_locations`, `known_devices`. The stream processor does a `$lookup` against this collection when scoring each transaction.

---

## Atlas Stream Processing Pipeline

Defined in `stream-processing/fraud-detection-pipeline.json`. The pipeline:

1. Sources from `fraud_detection.transactions` on insert/update/replace
2. Filters for `status: "pending"` documents
3. `$lookup` against `user_profiles` to get the user's behavioral baseline
4. Evaluates three fraud signals using `$cond` + `$concatArrays`:
   - `high_amount`: transaction amount > 3× user's average
   - `unusual_location`: transaction country not in user's frequent locations
   - `new_device`: device ID not in user's known devices
5. Computes `fraud_score` (high_amount: 25pts, unusual_location: 30pts, new_device: 20pts)
6. `$merge` back to `transactions`, setting `status`, `is_fraudulent`, `fraud_score`, and `fraud_indicators`

Transactions scoring ≥ 70 are written separately to `fraud_transactions` for the investigation UI.

---

## Atlas Search Indexes

### Vector Search Index (`indexes/fraud_transactions_text_index.json`)

```json
{
  "fields": [
    {
      "type": "autoEmbed",
      "model": "voyage-4",
      "path": "text",
      "modality": "text"
    }
  ]
}
```

`autoEmbed` means Atlas generates and stores the embedding at write time using Voyage AI's `voyage-4` model. At query time, `$vectorSearch` accepts a plain `query: "text string"` — no client-side embedding call, no Voyage API key required in the application.

### Lexical Search Index (`indexes/fraud_transactions_lexical_index.json`)

```json
{
  "name": "fraud_transactions_lexical",
  "mappings": {
    "dynamic": false,
    "fields": {
      "text":             [{ "type": "string" }],
      "fraud_indicators": [{ "type": "string" }],
      "merchant":         { "type": "document", "fields": { "merchant_name": [...], "merchant_country": [...] } },
      "location":         { "type": "document", "fields": { "country": [...], "city": [...] } },
      "device":           { "type": "document", "fields": { "device_type": [...], "os": [...] } }
    }
  }
}
```

BM25 full-text index for keyword search. Powers the **Lexical** mode and the lexical sub-pipeline in **Hybrid** mode. Create this index in the Atlas UI under **Atlas Search** → `fraud_detection.fraud_transactions` with name `fraud_transactions_lexical`.

Both indexes must exist on the `fraud_transactions` collection for all three search modes to work. The Vector index alone is sufficient if you only use Vector mode.

---

## Setup

### Prerequisites

- Node.js 18+
- MongoDB Atlas cluster with Atlas Stream Processing enabled
- Atlas Vector Search index (`fraud_transactions_text_index`) created on `fraud_transactions`
- Atlas Search lexical index (`fraud_transactions_lexical`) created on `fraud_transactions`
- Anthropic API key (Claude Sonnet)

### Environment

Create `.env` in the project root:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
ANTHROPIC_API_KEY=sk-ant-...
```

`VOYAGE_API_KEY` is not required — embeddings are handled by Atlas autoEmbed.

### Install

```bash
npm install
```

### Generate Sample Data

```bash
npm run generate-data
```

Creates 50 user profiles and 1,000 transactions in the `fraud_detection` database.

### Deploy the Stream Processing Pipeline

In the Atlas UI: navigate to Stream Processing → create a processor → paste the contents of `stream-processing/fraud-detection-pipeline.json`.

Or use the deploy script:

```bash
node scripts/deploy-asp.js
```

### Run the Web Demo

```bash
npm run chat
```

Opens the full web UI at `http://localhost:3000`. All three pages are served from here.

### Run the CLI Investigation Agent

```bash
npm run investigate <transaction_id>
```

Runs the terminal version of the investigation agent against a specific transaction ID.

---

## Project Structure

```
.
├── config/
│   └── atlas-config.js                  # Connection string + database name
├── indexes/
│   ├── fraud_transactions_text_index.json    # autoEmbed vector index (voyage-4)
│   ├── fraud_transactions_lexical_index.json # Atlas Search BM25 lexical index
│   └── user_profiles_text_index.json
├── public/                              # Static web UI (served by Express)
│   ├── index.html                       # Interactive Analyst (chatbot)
│   ├── investigate.html                 # Fraud Investigator (agent)
│   └── simulate.html                   # Transaction Simulator
├── scripts/
│   ├── deploy-asp.js                    # Deploy the stream processing pipeline
│   └── generate-sample-data.js         # Seed users + transactions
├── src/
│   ├── agents/
│   │   ├── fraud-analyst-chat.js        # Conversational analyst agent (generator)
│   │   ├── fraud-investigation-agent.js # CLI investigation agent
│   │   └── fraud-investigation-stream.js # Web investigation agent (SSE generator)
│   ├── server.js                        # Express server — API routes + static serving
│   └── index.js                         # Legacy entry point
├── stream-processing/
│   └── fraud-detection-pipeline.json   # Atlas Stream Processing pipeline definition
├── views/
│   └── *.json                           # Atlas view definitions
├── .env                                 # Local environment variables (not committed)
└── package.json
```

---

## npm Scripts

| Script | Command | What it does |
|---|---|---|
| `npm run chat` | `node src/server.js` | Start the web demo on port 3000 |
| `npm run investigate <id>` | `node src/agents/fraud-investigation-agent.js` | CLI agent for a single transaction |
| `npm run generate-data` | `node scripts/generate-sample-data.js` | Seed the database with sample data |
| `npm start` | `node src/index.js` | Legacy monitoring process |

---

## Stream Processor Debug Commands

Run these in the Atlas Stream Processing shell when troubleshooting the pipeline:

```javascript
// Inspect live documents flowing through the source
sp.process([{
  "$source": {
    "connectionName": "democluster",
    "db": "fraud_detection",
    "coll": "transactions"
  }
}])

// Check processor stats
sp["<processor-name>"].stats({ verbose: true })

// Stop / start / drop
sp["<processor-name>"].stop()
sp["<processor-name>"].start()
sp["<processor-name>"].drop()
```

---

## Key Dependencies

| Package | Role |
|---|---|
| `mongodb` | Atlas driver — all database reads and writes |
| `@langchain/anthropic` | Claude Sonnet (`claude-sonnet-4-6`) model binding with `bindTools()` |
| `@langchain/core` | `HumanMessage`, `SystemMessage`, `ToolMessage` primitives |
| `langchain` | `tool()` helper for defining agent tools with Zod schemas |
| `express` | Web server for API routes and static file serving |
| `zod` | Schema validation for tool input parameters |
| `dotenv` | Environment variable loading |
