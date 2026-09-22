# Fraud Detection & Multi-Agent Learning Loop — Powered by MongoDB Atlas

An end-to-end fraud detection system that combines real-time stream processing, a multi-agent investigation pipeline with LangGraph, and a closed-loop learning cycle that improves from human feedback. Built entirely on MongoDB Atlas capabilities — vector search, lexical search, hybrid search, stream processing, and the document model.

---

## What This System Does

| Capability | Where It Appears |
|---|---|
| **Atlas Stream Processing** | Scores incoming transactions in real time via a continuous aggregation on a change stream |
| **Multi-agent investigation (LangGraph)** | A 3-node state graph: precedent retrieval → investigation → decision. Code-enforced protocol, not prompt-enforced |
| **Memory-curated learning loop** | Human analyst feedback triggers a learning cycle that synthesizes reusable lessons and writes them to long-term vector-searchable memory |
| **Atlas Vector Search (autoEmbed)** | Semantic search over historical fraud cases and agent memory — no client-side embedding required |
| **Atlas Search (BM25 lexical)** | Keyword search over merchant names, locations, device types, and fraud indicators |
| **Hybrid Search (`$rankFusion`)** | Combines vector + lexical results via Reciprocal Rank Fusion (60/40 weight) |
| **Natural language → MQL** | Conversational analyst agent generates and runs live aggregation pipelines from plain English |
| **Trust-gradient memory** | Long-term memory distinguishes `source: "human_confirmed"` (ground truth) from `source: "agent"` (unverified reasoning) |

---

## Architecture

```
                         Browser (3 UI surfaces)
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
          simulate.html   investigate.html   index.html
          (Simulator)      (Investigator)    (Analyst chat)
                 │              │              │
                 │   POST /api/transactions   │
                 ▼              │              ▼
    ┌────────────────────┐      │     ┌──────────────────┐
    │ transactions       │      │     │ Fraud Analyst     │
    │ collection         │      │     │ Chatbot (standalone│
    └─────────┬──────────┘      │     │  4-tool agent)    │
              │                  │     └──────────────────┘
              │ Atlas Stream     │
              │ Processing       │ POST /api/investigate
              ▼                  ▼
    ┌────────────────────┐  ┌──────────────────────────────┐
    │ Scoring pipeline   │  │  LangGraph Investigation Graph │
    │ $lookup user_prof  │  │                                │
    │ 3 fraud signals    │  │  memory_retrieval              │
    │ score ≥ 70 → flag  │  │    → buildPrecedentBrief()     │
    └─────────┬──────────┘  │    → 2 parallel $vectorSearch  │
              │              │    → accuracy stat aggregation │
              ▼              │                                │
    ┌────────────────────┐  │  investigate                   │
    │ fraud_transactions │  │    → fetch_fraud_transaction   │
    │ collection         │  │    → fetch_user_history        │
    │ (autoEmbed text    │  │    → search_similar_fraud      │
    │  + investigation   │  │    → submit_findings           │
    │  subdocument)      │  │                                │
    └────────────────────┘  │  decide                        │
              │              │    → LLM decision policy       │
              │              │    → write to fraud_txn        │
              │              │    → write agent_memory        │
              │              └──────────────────────────────┘
              │
              │  POST /api/fraud-transactions/:id/feedback
              ▼
    ┌──────────────────────────────────────┐
    │  LangGraph Learning Graph (async)     │
    │                                       │
    │  ingest                               │
    │    → read fraud_txn + investigation   │
    │    → compute agent-vs-human agreement │
    │                                       │
    │  synthesize                           │
    │    → LLM generates 2-4 sentence lesson│
    │                                       │
    │  write_lesson                         │
    │    → buildLessonMemory()              │
    │    → insert to agent_memory           │
    │    → autoEmbed indexes automatically  │
    └──────────────────────────────────────┘
```

---

## The Two Agent Graphs

### Investigation Graph (`src/agents/learning/memory-graph.js`)

Three sequential nodes, code-enforced — the LLM cannot skip steps:

```
START → memory_retrieval → investigate → decide → END
```

| Node | What it does | LLM? |
|---|---|---|
| `memory_retrieval` | Fetches the flagged transaction, constructs a pattern description, runs two parallel `$vectorSearch` calls on `agent_memory` (verified + all), computes an accuracy stat for the case's indicators, assembles a structured precedent brief | No — deterministic |
| `investigate` | Claude Sonnet agent with 4 tools: `fetch_fraud_transaction`, `fetch_user_history`, `search_similar_fraud_cases`, `submit_investigation_findings`. Receives the precedent brief as input | Yes |
| `decide` | LLM applies a decision policy (confidence + accuracy stat thresholds), writes findings + routing decision to `fraud_transactions.investigation`, writes an `investigation_summary` to `agent_memory` | Yes (1 call) |

### Learning Graph (`src/agents/learning/memory-graph.js`)

Three sequential nodes, triggered asynchronously when a human submits feedback:

```
START → ingest → synthesize → write_lesson → END
```

| Node | What it does | LLM? |
|---|---|---|
| `ingest` | Reads the fraud transaction + investigation results, determines whether agent and human agreed | No — deterministic |
| `synthesize` | Claude Sonnet generates a 2-4 sentence reusable lesson from the case facts. Agreement → "confirmed pattern" lesson. Disagreement → "correction" lesson | Yes (1 call) |
| `write_lesson` | Builds a `lesson_learned` memory document with `source: "human_confirmed"`, `agreement`, `indicators`, `lesson_type` fields. Inserts to `agent_memory`. autoEmbed indexes it automatically | No — deterministic |

### Fraud Analyst Chatbot (`src/agents/fraud-analyst-chat.js`)

A standalone conversational agent (not part of the LangGraph graphs) with four tools:

| Tool | What it does |
|---|---|
| `search_fraud_cases` | Vector, lexical, or hybrid search over `fraud_transactions` — mode controlled by UI toggle |
| `run_aggregation` | Executes model-generated MongoDB aggregation pipelines. Blocks `$out`/`$merge`; caps at 50 results |
| `get_user_risk_profile` | Fetches `user_profiles` + fraud history + recent transactions in parallel |
| `search_agent_memory` | Searches distilled findings from past investigations and analyst reviews (including lessons learned) |

The chatbot benefits from the learning loop automatically — as `lesson_learned` documents accumulate in `agent_memory`, the `search_agent_memory` tool surfaces them with no code changes needed.

---

## Collections

### `transactions`
Source collection. Every inserted document is picked up by the Stream Processing pipeline. The pipeline writes `fraud_score`, `fraud_indicators`, `status`, and `is_fraudulent` back via `$merge`.

### `fraud_transactions`
Read model for flagged cases (score >= 70). Contains the scored transaction, an `investigation` subdocument (populated by the decision agent), and a `text` field for autoEmbed.

**`investigation` subdocument fields:**

| Field | Written by | Description |
|---|---|---|
| `notes` | Decision agent | Final investigation notes array |
| `routed_to_human` | Decision agent | Whether case is escalated to human review |
| `investigated_at` | Decision agent | Timestamp |
| `assigned_to` | Decision agent | `"human_review_queue"` or `"automated"` |
| `confidence` | Decision agent | `"high"`, `"medium"`, or `"low"` |
| `recommendation` | Investigation agent | `"escalate"` or `"auto_close"` |
| `decision_rationale` | Decision agent | Why the final decision was made |
| `human_outcome` | Feedback endpoint | `"confirmed_fraud"` or `"false_positive"` |
| `human_notes` | Feedback endpoint | Analyst's optional notes |
| `human_reviewed_at` | Feedback endpoint | Timestamp |
| `human_reviewed_by` | Feedback endpoint | Analyst ID |

### `user_profiles`
Behavioral baselines per user: `avg_transaction_amount`, `frequent_locations`, `known_devices`. Used by the stream processor's `$lookup` and the `get_user_risk_profile` tool.

### `agent_memory`
Long-term memory of distilled findings. All documents have a `summary` field with an autoEmbed vector index (`voyage-4`). Three document types coexist:

| `type` | `source` | Written by | Description |
|---|---|---|---|
| `investigation_summary` | `agent` | Decision agent | Agent's unverified conclusion after investigation |
| `analyst_feedback` | `human_confirmed` | Feedback endpoint | Raw record of human analyst's verdict |
| `lesson_learned` | `human_confirmed` | Learning graph | Synthesized reusable lesson with `agreement`, `lesson_type`, `indicators` fields |

The `lesson_learned` type is the key output of the learning loop. Its `lesson_type` is `"confirmed_fraud_lesson"` (agent and human agreed) or `"false_positive_lesson"` (they disagreed). The `indicators` array enables the accuracy stat aggregation in the precedent brief.

### `chat_sessions`
Per-analyst conversation history for the chatbot. Rolling summary compression with a 20-message sliding window. TTL index expires idle sessions after 14 days.

### `analysts`
Lightweight identity records (name + email), upserted on login.

---

## Memory Architecture

### Short-Term Memory (per analyst, ephemeral)
- `chat_sessions` collection — one document per analyst
- `messages` array holds verbatim turns; `summary` holds rolling LLM-compressed context
- 20-message sliding window: overflow is summarized by Claude, summary is reinjected at conversation start
- TTL index auto-expires after 14 days of inactivity

### Long-Term Memory (shared, persistent, searchable)
- `agent_memory` collection with autoEmbed vector index on `summary`
- Three document types: `investigation_summary`, `analyst_feedback`, `lesson_learned`
- Trust gradient: `source: "human_confirmed"` = ground truth; `source: "agent"` = unverified reasoning
- The Memory Retrieval Agent runs two parallel vector searches — one filtered to human-confirmed, one unfiltered — and computes an accuracy stat from `lesson_learned` documents
- The Learning Graph writes `lesson_learned` documents that are immediately searchable by future investigations

### How the loop closes
1. Investigation agent flags a case → writes `investigation_summary` to `agent_memory`
2. Human analyst reviews → submits feedback via the UI
3. Feedback endpoint writes `analyst_feedback` to `agent_memory` (synchronous, immediate)
4. Learning graph triggers asynchronously: ingests outcome → synthesizes lesson → writes `lesson_learned` to `agent_memory`
5. Next investigation for similar indicators → Memory Retrieval Agent finds the lesson in vector search → includes it in the precedent brief → investigation agent has the benefit of past learning

---

## The Three UI Surfaces

### Transaction Simulator (`/simulate.html`)
Inject test transactions using preset fraud scenarios. Five presets cover: all indicators firing, unusual location only, high amount only, new device only, and a clean baseline. Each submission writes to `transactions` and triggers the stream processor.

### Fraud Investigator (`/investigate.html`)
Displays the 30 most recent flagged cases. Clicking a case and running an investigation streams the three graph stages via SSE:

1. **Precedent Brief** — shows retrieved confirmed-fraud precedents, false-positive precedents, unverified agent precedents, and the accuracy stat
2. **Investigation** — the investigation agent runs its tools (fetch transaction, fetch user history, search similar cases)
3. **Decision** — shows confidence badge, recommendation, decision rationale, and routing

After investigation, the analyst can submit feedback ("Confirm fraud" or "False positive"). A "Learning..." indicator confirms the lesson generation cycle has been triggered.

### Interactive Analyst (`/`)
Conversational chat interface with the Fraud Analyst Chatbot. Search mode toggle (Hybrid / Vector / Lexical) controls how `search_fraud_cases` retrieves results. The agent streams responses token by token via SSE.

---

## Atlas Search Indexes

Three indexes must be created in the Atlas UI. All use `autoEmbed` with `voyage-4` — no Voyage API key is needed in the application.

### 1. Vector Search Index on `fraud_transactions` (`indexes/fraud_transactions_text_index.json`)

Create in Atlas UI: **Atlas Search** → `fraud_detection.fraud_transactions` → name `fraud_transactions_text_index`

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

### 2. Lexical Search Index on `fraud_transactions` (`indexes/fraud_transactions_lexical_index.json`)

Create in Atlas UI: **Atlas Search** → `fraud_detection.fraud_transactions` → name `fraud_transactions_lexical`

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

### 3. Vector Search Index on `agent_memory` (`indexes/agent_memory_text_index.json`)

Create in Atlas UI: **Atlas Search** → `fraud_detection.agent_memory` → name `agent_memory_text_index`

```json
{
  "fields": [
    {
      "modality": "text",
      "model": "voyage-4",
      "path": "summary",
      "type": "autoEmbed"
    }
  ]
}
```

---

## Setup

### Prerequisites

- Node.js 18+
- MongoDB Atlas cluster (M10+ for Stream Processing) with:
  - Atlas Stream Processing enabled
  - Atlas Vector Search + Atlas Search indexes created (see above)
  - Network access configured for your IP
  - Database user with read/write permissions
- Anthropic API key (Claude Sonnet)

### Environment

Create `.env` in the project root:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
ANTHROPIC_API_KEY=sk-ant-...
```

`VOYAGE_API_KEY` is not required — embeddings are handled by Atlas autoEmbed server-side.

### Install

```bash
npm install
```

### Generate Sample Data

```bash
npm run generate-data
```

Creates 50 user profiles and 1,000 transactions in the `fraud_detection` database. Also creates standard indexes on `transactions` and `user_profiles`.

### Create Atlas Search Indexes

Create the three indexes listed above in the Atlas UI. All three must exist for the full system to work:
- `fraud_transactions_text_index` — powers vector search on fraud cases
- `fraud_transactions_lexical` — powers lexical and hybrid search on fraud cases
- `agent_memory_text_index` — powers vector search on agent memory (investigation summaries, analyst feedback, and lessons learned)

### Deploy the Stream Processing Pipeline

**Option A — Atlas UI:**
1. Navigate to Stream Processing → create a processor
2. Paste the contents of `stream-processing/fraud-detection-pipeline.json`
3. Start the processor

**Option B — Deploy script:**
```bash
node scripts/deploy-asp.js
```

The pipeline sources from `fraud_detection.transactions`, evaluates three fraud signals (`high_amount`, `unusual_location`, `new_device`), computes a fraud score, and `$merge`s results back. Transactions scoring >= 70 are flagged.

### Run the Web Demo

```bash
npm run fraud_ai_agent
```

Opens at `http://localhost:3000`. All three UI surfaces are served from here. The server creates a TTL index on `chat_sessions` on startup.

### Run the CLI Investigation Agent

```bash
npm run investigate <transaction_id>
```

Runs the full investigation graph (memory retrieval → investigation → decision) from the terminal and prints the findings, confidence, routing decision, and rationale.

---

## End-to-End Verification Walkthrough

1. **Generate data:** `npm run generate-data`
2. **Deploy stream processor:** Via Atlas UI or `node scripts/deploy-asp.js`
3. **Submit a fraudulent transaction:** Open `http://localhost:3000/simulate.html`, use the "All Indicators" preset
4. **Wait for scoring:** The stream processor scores the transaction and writes to `fraud_transactions` (score >= 70)
5. **Investigate:** Open `http://localhost:3000/investigate.html`, select the case, click "Run Investigation"
   - First run: precedent brief will be empty (no lessons learned yet)
   - Investigation runs, decision is written, case appears with confidence badge and routing
6. **Submit human feedback:** Click "Confirm fraud" or "False positive"
   - Response is immediate
   - "Learning..." indicator appears
   - In the background, the learning graph synthesizes a lesson and writes it to `agent_memory`
7. **Investigate a similar case:** The precedent brief now includes the confirmed fraud/false-positive precedent and an accuracy stat
8. **Repeat:** Each human review enriches the memory. The system gets smarter with every case.

---

## Project Structure

```
.
├── config/
│   └── atlas-config.js                       # Connection string + database name + thresholds
├── indexes/
│   ├── fraud_transactions_text_index.json    # autoEmbed vector index (voyage-4) on fraud_transactions
│   ├── fraud_transactions_lexical_index.json # Atlas Search BM25 lexical index
│   ├── agent_memory_text_index.json          # autoEmbed vector index on agent_memory
│   └── user_profiles_text_index.json
├── public/                                   # Static web UI (served by Express)
│   ├── index.html                            # Interactive Analyst (chatbot)
│   ├── investigate.html                      # Fraud Investigator (multi-agent graph + feedback)
│   ├── simulate.html                         # Transaction Simulator
│   └── login.html                            # Analyst login
├── scripts/
│   ├── deploy-asp.js                         # Deploy the stream processing pipeline
│   └── generate-sample-data.js              # Seed users + transactions + indexes
├── src/
│   ├── agents/
│   │   ├── agent-memory-tool.js              # search_agent_memory tool + buildInvestigationMemory + buildLessonMemory
│   │   ├── memory-retrieval-agent.js         # Deterministic precedent brief builder (2x vector search + accuracy stat)
│   │   ├── decision-agent.js                 # LLM decision policy + MongoDB write-back
│   │   ├── fraud-investigation-stream.js     # Investigation agent (4 tools, accepts precedentBrief, yields findings)
│   │   ├── fraud-investigation-agent.js      # CLI entry point (calls investigation graph)
│   │   ├── fraud-analyst-chat.js             # Conversational analyst chatbot (4 tools, standalone)
│   │   └── learning/
│   │       ├── memory-graph.js               # LangGraph state graphs (investigation + learning)
│   │       ├── outcome-ingest-agent.js       # Gathers case facts, computes agent-vs-human agreement
│   │       └── memory-synthesis-agent.js     # LLM generates reusable lesson from case outcome
│   ├── server.js                             # Express server — API routes + SSE streaming + learning trigger
│   └── index.js                              # Legacy monitoring entry point
├── stream-processing/
│   └── fraud-detection-pipeline.json         # Atlas Stream Processing pipeline definition
├── views/
│   └── *.json                                # Atlas view definitions
├── design5.md                                # Design 5 implementation plan
├── .env                                      # Local environment variables (not committed)
└── package.json
```

---

## npm Scripts

| Script | Command | What it does |
|---|---|---|
| `npm run fraud_ai_agent` | `node src/server.js` | Start the web demo (all 3 UI surfaces) on port 3000 |
| `npm run investigate <id>` | `node src/agents/fraud-investigation-agent.js <id>` | Run the full investigation graph for a single transaction from the CLI |
| `npm run generate-data` | `node scripts/generate-sample-data.js` | Seed 50 users + 1,000 transactions + create standard indexes |
| `npm start` | `node src/index.js` | Legacy change-stream monitoring process |

---

## API Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/login` | Name-based login (creates `analysts` record, sets cookie) |
| `POST` | `/api/logout` | Clears analyst cookie |
| `GET` | `/api/me` | Returns current analyst identity |
| `POST` | `/api/transactions` | Inserts a transaction (triggers stream processor) |
| `GET` | `/api/fraud-transactions` | Lists 30 most recent flagged cases |
| `POST` | `/api/investigate` | Runs the investigation graph, streams SSE events (`memory_retrieval`, `investigate`, `decide`, `done`) |
| `POST` | `/api/fraud-transactions/:id/feedback` | Records human analyst verdict, triggers learning graph asynchronously |
| `POST` | `/api/chat` | Runs the analyst chatbot, streams SSE tokens |

---

## Atlas Stream Processing Pipeline

Defined in `stream-processing/fraud-detection-pipeline.json`:

1. **`$source`** — connects to `fraud_detection.transactions` on insert/update/replace
2. **`$match`** — filters for `status: "pending"` documents
3. **`$lookup`** — joins `user_profiles` to get the user's behavioral baseline
4. **`$addFields`** — evaluates three fraud signals via `$cond` + `$concatArrays`:
   - `high_amount`: amount > 3x user's average (25 pts)
   - `unusual_location`: country not in user's frequent locations (30 pts)
   - `new_device`: device ID not in user's known devices (20 pts)
5. **`$addFields`** — computes `fraud_score` (sum of triggered signals, max 75)
6. **`$addFields`** — sets `is_fraudulent` (score >= 70), `status` ("flagged" or "completed")
7. **`$merge`** — writes results back to `transactions` on `transaction_id`

Transactions scoring >= 70 appear in `fraud_transactions` for the investigation UI.

---

## Stream Processor Debug Commands

Run these in the Atlas Stream Processing shell:

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
| `@langchain/core` | `HumanMessage`, `SystemMessage`, `ToolMessage`, `tool()` primitives |
| `@langchain/langgraph` | `StateGraph`, `Annotation`, `START`, `END` — multi-agent graph orchestration |
| `langchain` | Framework glue (transitive `langgraph` dependency) |
| `express` | Web server for API routes and static file serving |
| `zod` | Schema validation for tool input parameters |
| `dotenv` | Environment variable loading |
| `cookie-parser` | Analyst identity cookie parsing |

---

## Troubleshooting

### Connection Issues

| Error | Fix |
|---|---|
| `bad auth` | Check username/password in `MONGODB_URI` |
| `IP not in whitelist` | Add your IP in Atlas → Network Access |
| `stream processing not available` | Cluster must be M10+ |

### Missing Atlas Search Indexes

| Symptom | Fix |
|---|---|
| `vectorSearchScore` error or no results from `search_fraud_cases` | Create `fraud_transactions_text_index` on `fraud_transactions` |
| Lexical/hybrid search returns nothing | Create `fraud_transactions_lexical` on `fraud_transactions` |
| Precedent brief always empty | Create `agent_memory_text_index` on `agent_memory` |
| Accuracy stat never appears | Submit at least one human feedback (creates a `lesson_learned` doc) |

### Agent / Graph Issues

| Symptom | Fix |
|---|---|
| `ANTHROPIC_API_KEY` error | Set in `.env` |
| Investigation hangs | Check that `fraud_transactions` has documents with `status: "flagged"` |
| Learning cycle doesn't trigger | Check server logs for `[learning] Lesson synthesis failed` |
| Precedent brief shows empty on first run | Expected — memory bootstraps after the first human feedback |

---

## License

MIT
