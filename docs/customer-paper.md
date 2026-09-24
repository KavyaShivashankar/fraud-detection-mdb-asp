# Fraud Detection with Multi-Agent Learning Loop
### A MongoDB Atlas Reference Architecture for Real-Time AI-Powered Fraud Investigation

---

## Executive Summary

Financial institutions lose billions annually to fraud, yet most fraud detection systems suffer from two fundamental gaps: (1) they flag transactions but leave the investigation entirely to humans, and (2) they never learn from the outcomes of those investigations. This paper presents a reference architecture built entirely on MongoDB Atlas that closes both gaps — combining real-time stream processing, multi-agent AI investigation, and a closed-loop learning cycle that improves with every human review.

The system demonstrates six MongoDB Atlas capabilities working as a single platform: Atlas Stream Processing for real-time scoring, Atlas Vector Search with autoEmbed for semantic case retrieval, Atlas Search for lexical keyword matching, Hybrid Search via `$rankFusion` for best-of-both retrieval, the document model for rich nested investigation records, and the aggregation framework as the execution engine for natural-language-to-MQL query generation.

The result: a fraud operations system that investigates cases autonomously, routes decisions intelligently, learns from human feedback, and gets smarter over time — all on a single database platform with no additional infrastructure.

---

## The Business Problem

| Challenge | Current State | What's Needed |
|---|---|---|
| **Volume** | Thousands of flagged transactions per day, limited analyst capacity | Automated investigation that pre-analyzes cases before humans see them |
| **Consistency** | Each analyst investigates differently — no shared learning | A system that accumulates institutional knowledge from every review |
| **Speed** | Manual investigation takes 15-45 minutes per case | Pre-investigated cases with precedent briefs delivered in seconds |
| **Learning** | Lessons from past cases stay in analysts' heads | A memory system that retrieves relevant past conclusions for each new case |
| **Trust** | AI decisions are black boxes — humans can't verify or correct | Human-in-the-loop feedback that creates ground-truth signal for future decisions |

---

## The Solution: Three Surfaces, One Platform

The system presents three user-facing surfaces, all powered by a single MongoDB Atlas cluster:

### 1. Transaction Simulator
Injects test transactions with preset fraud scenarios (all indicators, unusual location only, high amount only, new device only, clean baseline). Each submission writes to the `transactions` collection and triggers the stream processing pipeline for real-time scoring.

### 2. Fraud Investigator (Agent)
Displays flagged cases and launches a multi-agent investigation graph that runs autonomously: retrieves precedents from past cases, investigates with tool-calling AI, makes a routing decision, and presents findings with a confidence level. A human analyst reviews the decision and provides feedback — triggering the learning cycle.

### 3. Interactive Analyst (Chatbot)
A conversational interface where analysts ask natural-language questions. The agent generates and executes MongoDB aggregation pipelines directly against the database — translating "show me fraud trends by country this week" into a live MQL pipeline. Supports hybrid search (vector + lexical via `$rankFusion`), vector-only, and lexical-only modes.

---

## Architecture

```
                    Browser (3 UI surfaces)
                           |
            +--------------+--------------+
            |              |              |
     Transaction         Investigation    Analyst
     Simulator           Agent (graph)    Chatbot
            |              |              |
            | POST /api/   | LangGraph    | 4-tool agent
            | transactions | 3-node graph | SSE streaming
            v              v              v
    +----------------+  +------------------+  +----------------+
    | transactions   |  | Memory Retrieval |  | search_fraud   |
    | collection     |  |    |             |  | _cases (hybrid)|
    +-------+--------+  |    v             |  | run_aggregation|
            |           | Investigation   |  | get_user_risk  |
            | Atlas     |    Agent (4 tools)|  | search_agent   |
            | Stream    |    |             |  | _memory        |
            | Processing|    v             |  +----------------+
            | (real-time|  Decision Agent  |
            |  scoring) |    |             |
            v           |    v             |
    +-------+--------+  | fraud_transactions|
    | fraud_score     |  |  + investigation |
    | fraud_indicators|  |  + precedent_brief|
    | status          |  +--------+---------+
    +-----------------+            |
                         Human feedback (confirm/reject)
                                   |
                                   v
                         +-----------------+
                         | Learning Graph   |
                         | ingest ->        |
                         | synthesize ->    |
                         | write_lesson     |
                         +--------+---------+
                                  |
                                  v
                         +-----------------+
                         | agent_memory    |
                         | (autoEmbed)     |
                         | lesson_learned  |
                         | analyst_feedback|
                         | investigation_  |
                         |   summary       |
                         +-----------------+
                                  |
                          Retrieved by next
                          investigation's
                          Memory Retrieval
                          Agent via
                          $vectorSearch
                                  |
                     +------------v-----------+
                     |   The loop continues   |
                     +------------------------+
```

---

## MongoDB Atlas Capabilities Demonstrated

### 1. Atlas Stream Processing — Real-Time Fraud Scoring

**What it does:** A continuous aggregation pipeline monitors the `transactions` collection's change stream. Every inserted transaction is scored in real time — no application code in the hot path.

**How it works:**
- `$source` connects to `fraud_detection.transactions` on insert/update/replace
- `$lookup` joins `user_profiles` to get behavioral baselines
- Three fraud signals are evaluated using `$cond` + `$concatArrays`:
  - `high_amount`: transaction amount > 3x user's average (25 points)
  - `unusual_location`: country not in user's frequent locations (30 points)
  - `new_device`: device ID not in user's known devices (20 points)
- `fraud_score` is computed as the sum of triggered signals
- `$merge` writes results back to `transactions` with status, score, and indicators
- A second pipeline copies flagged transactions (score >= threshold) to `fraud_transactions`

**MongoDB value:** No separate streaming platform (Kafka, Flink, Spark Streaming). The same database that stores the data also processes the stream — one platform, one connection, one operational model.

### 2. Atlas Vector Search with autoEmbed — Semantic Case Retrieval

**What it does:** The Investigation Agent and the Analyst Chatbot search for similar past fraud cases using natural language — "high-amount mobile purchase in West Africa from unknown device" — and get semantically matching results without any client-side embedding logic.

**How it works:**
- An autoEmbed vector index on `fraud_transactions.text` uses the `voyage-4` model
- Atlas generates and stores embeddings at write time — the application never calls an embedding API
- At query time, `$vectorSearch` accepts plain text: `query: "fraud pattern description"`
- No Voyage API key in the application, no embedding pipeline, no vector storage management

**MongoDB value:** Traditional vector search requires a separate vector database (Pinecone, Weaviate, Milvus), an embedding service, and sync logic between the operational database and the vector store. With autoEmbed, the operational database *is* the vector database — embeddings are generated and stored automatically, and vector search runs alongside regular queries on the same documents.

### 3. Atlas Search (BM25) — Lexical Keyword Search

**What it does:** Enables precise keyword matching over merchant names, locations, device types, and fraud indicators — "show me all cases involving Electronics Store in Lagos."

**How it works:**
- A static-mapping Atlas Search index with BM25 scoring on key fields
- `$search` operator with `text` query over multiple paths
- Returns relevance-scored results for exact term matching

**MongoDB value:** Lexical search lives next to vector search on the same collection — no separate Elasticsearch cluster. The same query can combine `$search` (lexical) with `$vectorSearch` (semantic) in a single pipeline.

### 4. Hybrid Search via `$rankFusion` — Best-of-Both Retrieval

**What it does:** Combines semantic vector search and lexical BM25 search in a single query, fusing results via Reciprocal Rank Fusion (RRF) with configurable weights (60% vector, 40% lexical).

**How it works:**
```javascript
{
  $rankFusion: {
    input: {
      pipelines: {
        vectorPipeline: [{ $vectorSearch: { ... } }],
        lexicalPipeline: [{ $search: { ... } }, { $limit: 20 }],
      },
    },
    combination: { weights: { vectorPipeline: 0.6, lexicalPipeline: 0.4 } },
  },
}
```

**MongoDB value:** No other database natively combines vector and lexical search with rank fusion in a single query. Competing solutions require application-level merging of results from two separate systems. With `$rankFusion`, Atlas handles the fusion server-side — one query, one result set, one round trip.

### 5. Document Model — Rich Investigation Records

**What it does:** Each fraud transaction is a single rich document containing the transaction details, fraud score, indicators, device metadata, merchant info, and a nested `investigation` subdocument that grows as the agent investigates and the human reviews.

**Document shape:**
```json
{
  "transaction_id": "txn_demo_1234",
  "amount": 4800,
  "fraud_score": 75,
  "fraud_indicators": ["high_amount", "unusual_location", "new_device"],
  "merchant": { "merchant_name": "Unknown Electronics", "merchant_country": "NG" },
  "location": { "country": "NG", "city": "Lagos" },
  "device": { "device_id": "dev_unknown_001", "device_type": "mobile" },
  "investigation": {
    "confidence": "high",
    "recommendation": "escalate",
    "routed_to_human": true,
    "decision_rationale": "Pattern matches confirmed account takeover...",
    "notes": ["Device not in known devices", "Amount exceeds account limit"],
    "human_outcome": "confirmed_fraud",
    "human_reviewed_at": "2026-09-22T21:37:19Z",
    "precedent_brief": "PRECEDENT BRIEF for txn_demo_1234..."
  }
}
```

**MongoDB value:** No joins. No object-relational mapping. The entire investigation — from scoring to agent findings to human feedback — is one document that evolves over time. A relational schema would require 5-7 tables with foreign keys to represent the same data.

### 6. Aggregation Framework as AI Execution Engine

**What it does:** The Analyst Chatbot's `run_aggregation` tool lets the AI model generate MongoDB aggregation pipelines from natural language and execute them directly against the database.

**Example:**
- Analyst asks: "What's the average fraud score by country this month?"
- Model generates: `[{ $match: { timestamp: { $gte: ... } } }, { $group: { _id: "$location.country", avgScore: { $avg: "$fraud_score" } } }]`
- Atlas executes it and returns the result set to the model
- Model summarizes the findings in plain English

**Safety:** The tool blocks `$out`, `$merge`, `$indexStats`, and other write/admin stages. Results are capped at 50 documents. Only allowed collections are queryable.

**MongoDB value:** The aggregation framework is the most expressive query language in the database industry. By exposing it to an AI agent, the system turns natural language into live analytics — without pre-built dashboards, without BI tools, without a separate analytics database.

---

## The Multi-Agent Investigation Graph

The investigation is orchestrated as a LangGraph state graph with three sequential nodes. Unlike prompt-enforced protocols (where the AI might skip steps), the graph topology guarantees execution order.

### Node 1: Memory Retrieval (deterministic, no LLM)

Before the investigation agent starts, a deterministic retrieval function:
1. Fetches the flagged transaction from `fraud_transactions`
2. Constructs a pattern description from its indicators, amount, location, device, and merchant
3. Runs **two parallel `$vectorSearch` calls** on `agent_memory`:
   - **Verified search**: filtered to `source: "human_confirmed"` — finds lessons from past human reviews
   - **Unverified search**: all memories — finds prior agent conclusions
4. Computes an **accuracy stat**: aggregates `lesson_learned` documents with matching indicators to calculate "the agent has been right X% of the time for this pattern"
5. Assembles a structured **precedent brief** containing confirmed fraud precedents, confirmed false-positive precedents, unverified agent precedents, and the accuracy stat

**MongoDB value:** The precedent brief is built entirely from MongoDB queries — `$vectorSearch` for semantic retrieval and `$match` + `$group` for the accuracy aggregation. No external retrieval service, no separate analytics engine.

### Node 2: Investigation Agent (LLM — Claude Sonnet)

Receives the precedent brief as input and investigates with four tools:

| Tool | What it does | MongoDB operation |
|---|---|---|
| `fetch_fraud_transaction` | Gets the flagged transaction details | `findOne` on `fraud_transactions` |
| `fetch_user_history` | Gets behavioral baseline + recent transactions | `findOne` + `find` on `user_profiles` and `transactions` |
| `search_similar_fraud_cases` | Semantic search for similar past cases | `$vectorSearch` on `fraud_transactions` |
| `submit_investigation_findings` | Submits findings with confidence + recommendation | Returns to graph state (no DB write) |

The agent reads the precedent brief and uses it to guide its investigation — checking exonerating evidence that past false positives revealed, or weighing fraud signals that past confirmed cases validated.

### Node 3: Decision Agent (LLM — Claude Sonnet)

Applies a decision policy that uses the accuracy stat as a threshold:

| Condition | Decision |
|---|---|
| Accuracy < 60% | Force human escalation (agent is often wrong for this pattern) |
| Accuracy >= 75% + confidence "high" + recommendation "auto_close" | Auto-close (agent is reliable for this pattern) |
| Confidence "medium" or "low" | Always escalate to human |
| No accuracy stat (first case) | Follow recommendation, lean toward escalation |

Writes the final decision to `fraud_transactions.investigation` (confidence, recommendation, rationale, notes, routing) and writes an `investigation_summary` to `agent_memory` with `source: "agent"`.

---

## The Learning Loop

### The Problem with Traditional Fraud Detection

Traditional systems flag transactions, humans investigate, and the investigation ends. The knowledge gained from each investigation stays in the analyst's head or in a case management note that nobody reads for the next case. The system never gets smarter.

### The Solution: A Closed Learning Loop

When a human analyst reviews the agent's decision and clicks "Confirm fraud" or "False positive," a learning graph runs asynchronously:

```
Human clicks "Confirm fraud" or "False positive"
        |
        v
  +-----------+
  |  Ingest   |  Reads the investigated case, compares:
  |           |  - What the agent concluded (flagged_as_fraud)
  |  (no LLM) |  - What the human concluded (confirmed_fraud / false_positive)
  |           |  - Produces: agreement = true/false
  +-----------+
        |
        v
  +-----------+
  | Synthesize|  Claude generates a 2-4 sentence reusable lesson:
  |           |  - Agreement -> "confirmed pattern" lesson
  |  (LLM)    |  - Disagreement -> "correction" lesson
  |           |  Example: "For [new_device] where user has 3+ years
  |           |   of clean history and device is same OS, check if
  |           |   it's an upgrade before flagging."
  +-----------+
        |
        v
  +-----------+
  | Write     |  Inserts lesson_learned document to agent_memory:
  | Lesson    |  - source: "human_confirmed" (ground truth)
  |           |  - lesson_type: confirmed_fraud_lesson / false_positive_lesson
  | (no LLM)  |  - agreement: true/false
  |           |  - indicators: [high_amount, new_device]
  |           |  autoEmbed indexes the summary automatically
  +-----------+
        |
        v
  Next investigation with similar indicators
        |
        v
  Memory Retrieval Agent runs $vectorSearch on agent_memory
        |
        v
  Precedent brief includes the lesson
  + accuracy stat reflects the feedback
        |
        v
  Investigation Agent reads the brief ->
  adjusts analysis based on past learning
        |
        v
  Decision Agent sees accuracy stat ->
  forces escalation if < 60%, allows auto-close if >= 75%
```

### The Trust Gradient

The `source` field on each memory document creates a trust gradient:

| `source` | Meaning | How the agent treats it |
|---|---|---|
| `"agent"` | The agent's own unverified conclusion | Prior reasoning — cite as precedent, not as fact |
| `"human_confirmed"` | A human verified this outcome | Ground truth — trust this over agent conclusions |

The Memory Retrieval Agent runs two parallel searches — one filtered to `human_confirmed` only, one unfiltered — and the system prompt coaches the investigation agent: "Prefer results with `source: "human_confirmed"` as ground truth."

### How Accuracy Compounds

Each human review adds one `lesson_learned` document. The accuracy stat is computed per indicator combination:

| After N feedbacks | Accuracy | Decision Agent behavior |
|---|---|---|
| 1 feedback, 0 agreed | 0% | Force escalation (< 60%) |
| 2 feedbacks, 1 agreed | 50% | Force escalation (< 60%) |
| 3 feedbacks, 2 agreed | 67% | Follow recommendation (60-75%) |
| 5 feedbacks, 4 agreed | 80% | Allow auto-close (>= 75%) |
| 10 feedbacks, 9 agreed | 90% | Allow auto-close (>= 75%) |

The system adjusts its own autonomy threshold based on past performance. Patterns where the agent is frequently wrong get forced to human review. Patterns where it's consistently right can be auto-closed without human intervention.

---

## The Memory Architecture

### Short-Term Memory (per analyst, ephemeral)

| Aspect | Details |
|---|---|
| Collection | `chat_sessions` |
| Scope | One analyst's conversation with the chatbot |
| Content | Verbatim messages + rolling LLM-compressed summary |
| Window | 20-message sliding window — overflow is summarized by Claude |
| Lifecycle | TTL index auto-expires after 14 days of inactivity |

### Long-Term Memory (global, permanent, searchable)

| Document type | `source` | Written by | Purpose |
|---|---|---|---|
| `investigation_summary` | `agent` | Decision Agent | Agent's unverified conclusion after each investigation |
| `analyst_feedback` | `human_confirmed` | Feedback endpoint | Raw audit trail of human's verdict |
| `lesson_learned` | `human_confirmed` | Learning graph | Synthesized reusable lesson with agreement, indicators, lesson_type |

All long-term memory documents have a `summary` field with an autoEmbed vector index (`voyage-4`). Every lesson is automatically embedded and searchable by future investigations — no manual indexing, no embedding pipeline.

---

## Collections

| Collection | Role |
|---|---|
| `transactions` | Source — every inserted document triggers stream processing scoring |
| `fraud_transactions` | Read model — flagged cases with nested `investigation` subdocument + `precedent_brief` |
| `user_profiles` | Behavioral baselines — `avg_transaction_amount`, `frequent_locations`, `known_devices` |
| `agent_memory` | Long-term memory — investigation summaries, analyst feedback, lessons learned (autoEmbed indexed) |
| `chat_sessions` | Short-term memory — per-analyst conversation history with rolling summary |
| `analysts` | Lightweight identity records for the login flow |

---

## MongoDB Value Framework

### Speed to Value

| Traditional approach | This project |
|---|---|
| Separate streaming platform (Kafka + Flink) | Atlas Stream Processing — same database |
| Separate vector database (Pinecone/Weaviate) | autoEmbed — Atlas generates embeddings automatically |
| Separate search engine (Elasticsearch) | Atlas Search — BM25 on the same collection |
| Application-level result merging for hybrid search | `$rankFusion` — server-side fusion in one query |
| ETL pipeline to sync operational data to analytics warehouse | Aggregation framework — analytics on live operational data |
| 5-7 infrastructure components | **1 platform: MongoDB Atlas** |

### Developer Productivity

The entire system — real-time scoring, vector search, lexical search, hybrid search, agent memory, learning loop, conversational analytics — runs on one database with one connection string and one driver. Developers learn one query language (MQL), one aggregation framework, and one deployment model.

The `run_aggregation` tool demonstrates the ultimate productivity multiplier: an AI agent that writes MongoDB queries from natural language. Analysts don't need to learn MQL — they ask questions in English and the database executes the generated pipelines directly.

### Simplification

| Without MongoDB | With MongoDB Atlas |
|---|---|
| Operational database + vector database + search engine + streaming platform + embedding service | One Atlas cluster |
| 5+ vendor relationships, 5+ billing models, 5+ support contracts | One vendor, one bill, one support team |
| Data sync pipelines between systems (operational -> vector, operational -> search, operational -> analytics) | No sync — all capabilities on the same data |
| Embedding service + API key management + embedding pipeline | autoEmbed — server-side, zero config |

### Trust and Security

- **Human-in-the-loop**: Every AI decision can be reviewed, confirmed, or corrected by a human analyst
- **Trust gradient**: Memory distinguishes agent conclusions from human-verified outcomes
- **Sandboxed AI queries**: The `run_aggregation` tool blocks write operations (`$out`, `$merge`) and caps results
- **Audit trail**: Every investigation, feedback, and lesson is persisted with timestamps and analyst identity
- **Encryption**: Data encrypted at rest and in transit (Atlas built-in)
- **Authentication**: MongoDB authentication + analyst identity cookies

### Scalability

- Atlas auto-scaling handles cluster growth as transaction volume increases
- Stream processing scales horizontally across nodes
- Vector search scales with the collection — no separate vector index to manage
- The application is stateless (per-request MongoDB connections) — horizontally scalable
- `agent_memory` grows with every investigation — autoEmbed handles indexing automatically

### Cost Efficiency

| Cost category | Traditional | This project |
|---|---|---|
| Infrastructure | 5+ separate services | 1 Atlas cluster |
| Embedding API calls | Per-insert + per-query | Zero (autoEmbed is server-side) |
| Streaming platform | Kafka cluster + Flink compute | Included in Atlas |
| Search engine | Elasticsearch cluster | Included in Atlas |
| Vector database | Pinecone/Weaviate subscription | Included in Atlas |
| Developer time | Integrating 5+ systems | Building features on 1 platform |

---

## Demo Script

### Setup (5 minutes)
1. `npm install` — install dependencies
2. Configure `.env` with Atlas connection string and Anthropic API key
3. `npm run generate-data` — seed 50 users + 1,000 transactions with varied fraud patterns
4. Create 3 Atlas Search indexes (vector on `fraud_transactions`, lexical on `fraud_transactions`, vector on `agent_memory`)
5. Deploy the stream processing pipeline in Atlas UI
6. `npm run fraud_ai_agent` — start the web server on port 3000

### Demo Flow (15 minutes)

**Step 1: Submit a fraudulent transaction (2 minutes)**
- Open Transaction Simulator → click "All Indicators" preset → submit
- Explain: "This writes to the `transactions` collection. Atlas Stream Processing scores it in real time — see the fraud score and indicators appear."

**Step 2: Investigate the flagged case (5 minutes)**
- Open Fraud Investigator → select the flagged case → click "Run Investigation"
- Watch the investigation graph animate:
  - Memory Retrieval node: "Searching past lessons in agent_memory via $vectorSearch"
  - Investigation Agent node: tools execute one by one (fetch transaction, fetch user history, search similar cases)
  - Decision Agent node: "Applying decision policy — confidence high, recommendation escalate"
- Explain: "The agent pre-investigated this case. It found precedents, compared the transaction to the user's behavioral baseline, and made a routing decision — all autonomously."

**Step 3: Human feedback triggers learning (3 minutes)**
- Click "Confirm fraud" on the investigation result
- Switch to Investigation Agent tab → watch the learning cycle nodes animate:
  - Ingest: "Reading case, comparing agent vs human conclusion"
  - Synthesize: "Claude generating a reusable lesson"
  - Write Lesson: "Lesson saved to agent_memory with autoEmbed"
- Explain: "The system just learned from this review. A lesson was synthesized and written to agent_memory. Atlas autoEmbed indexed it automatically — no embedding API call needed."

**Step 4: Show the learning loop (3 minutes)**
- Open Learning Flow Detailed tab → select the same case
- Show the "At Investigation Time" card (what the agent saw) vs "Current Memory" card (what a re-investigation would see now)
- Show the accuracy gauge: "The agent has been right X% of the time for these indicators"
- Show the feedback loop annotation: "Lessons feed back into Memory Retrieval on the next investigation via $vectorSearch"

**Step 5: Natural language analytics (2 minutes)**
- Open Interactive Analyst (under Analyst Tools dropdown)
- Ask: "What's the average fraud score by country?"
- Watch the agent generate and execute a MongoDB aggregation pipeline
- Explain: "The AI wrote an MQL pipeline from plain English and Atlas executed it directly — no BI tool, no pre-built dashboard."

---

## Key Takeaways

1. **One platform, six capabilities**: Atlas Stream Processing, Vector Search (autoEmbed), Atlas Search (BM25), Hybrid Search (`$rankFusion`), document model, and aggregation framework — all on one cluster.

2. **The database is the AI infrastructure**: Vector embeddings, semantic search, lexical search, and real-time scoring all happen inside MongoDB. No external AI infrastructure beyond the LLM API.

3. **The system learns from humans**: Every human review produces a searchable lesson that improves future investigations. The accuracy stat controls how much autonomy the agent gets — it knows its own limits.

4. **Natural language to MQL**: Analysts ask questions in English. The AI generates MongoDB aggregation pipelines. Atlas executes them. No BI tool required.

5. **Simplification at every layer**: One vendor, one connection string, one query language, one deployment model — replacing 5+ infrastructure components with a single Atlas cluster.

---

## Technical Stack

| Component | Technology |
|---|---|
| Database + Search + Streaming | MongoDB Atlas |
| Vector embeddings | autoEmbed with voyage-4 (server-side) |
| AI model | Claude Sonnet 4 (Anthropic) |
| Agent orchestration | LangGraph (StateGraph) |
| Agent tools | LangChain tool() with Zod schemas |
| Web server | Express.js |
| Frontend | Vanilla HTML/CSS/JS with Server-Sent Events |
| Driver | mongodb Node.js driver v6 |

---

## Appendix: API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Analyst login (creates `analysts` record) |
| POST | `/api/transactions` | Insert transaction (triggers stream processor) |
| GET | `/api/fraud-transactions` | List 30 most recent flagged cases |
| POST | `/api/investigate` | Run investigation graph (SSE streaming) |
| POST | `/api/fraud-transactions/:id/feedback` | Submit human verdict (triggers learning graph) |
| GET | `/api/precedent-brief/:id` | Get precedent brief + stored brief + accuracy |
| GET | `/api/lessons/:id` | Check if lesson_learned exists for a transaction |
| GET | `/api/accuracy-stats/:id` | Get accuracy stats for a transaction's indicators |
| POST | `/api/chat` | Run analyst chatbot (SSE streaming) |

---

*This paper describes a reference architecture for demonstration purposes. Production deployments should add rate limiting, authentication hardening, connection pooling, and monitoring.*

*Powered by MongoDB Atlas.*
