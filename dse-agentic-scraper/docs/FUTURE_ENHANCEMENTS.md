# FUTURE_ENHANCEMENTS.md — System Enhancement & Extensibility Roadmap

> **Audience:** Core developers, software architects, and AI coding agents extending and scaling the DSE Agentic Scraper.
>
> **Core Architecture Guideline:** Always maintain the system's foundational principle:  
> `LLM = Reasoning. Node.js = Execution. Database = State.`

---

## Table of Contents

1. [Executive Architectural Vision](#1-executive-architectural-vision)
2. [Target Distributed Architecture (Current vs. Future)](#2-target-distributed-architecture-current-vs-future)
3. [Distributed Job Orchestration & Queues (BullMQ + Redis)](#3-distributed-job-orchestration--queues-bullmq--redis)
4. [High-Resilience Scraping & Anti-Detection Upgrades](#4-high-resilience-scraping--anti-detection-upgrades)
5. [Autonomous Multi-Agent & LLM Evolution](#5-autonomous-multi-agent--llm-evolution)
6. [Data Pipeline & Time-Series Scaling (PostgreSQL / TimescaleDB)](#6-data-pipeline--time-series-scaling-postgresql--timescaledb)
7. [Enterprise Observability, Laravel-Style Logging & Tracing](#7-enterprise-observability-laravel-style-logging--tracing)
8. [Multi-Exchange & Multi-Asset Expansion (CSE & Bonds)](#8-multi-exchange--multi-asset-expansion-cse--bonds)
9. [Automated Financial Intelligence & Anomaly Alerting](#9-automated-financial-intelligence--anomaly-alerting)
10. [Implementation Blueprints & Code Recipes](#10-implementation-blueprints--code-recipes)

---

## 1. Executive Architectural Vision

The **DSE Agentic Scraper** was originally designed as a single-process, multi-agent pipeline capable of resilient data extraction from the Dhaka Stock Exchange (`dse.com.bd`). 

To transform this system into an institutional-grade, continuous financial data platform, future enhancements should target four primary axes:

| Dimension | Current Baseline | Target State (Future) |
|---|---|---|
| **Execution Model** | Single Node.js process / synchronous CLI / REST | Distributed worker pool with Redis/BullMQ queue & cron scheduler |
| **Data Storage** | Single MySQL instance (or in-memory mock fallback) | Master-replica PostgreSQL + TimescaleDB for tick/minute price series |
| **LLM Utilization** | Anomaly classification & failure diagnosis | Autonomous selector self-healing, multimodal vision parsing, news sentiment |
| **Audit & Storage** | In-database text blobs | Cloud Object Storage (S3 / R2) for full HTML/DOM snapshots + OpenTelemetry |
| **Coverage** | Core DSE Equity instruments | All 400+ DSE equities, Debentures, Treasury Bonds, DSEX indices, CSE (Chittagong) |

---

## 2. Target Distributed Architecture (Current vs. Future)

```
CURRENT ARCHITECTURE (Monolithic CLI & Single Express Server)
┌────────────────────────────────────────────────────────┐
│ Express Server / CLI Runner                            │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Orchestrator                                       │ │
│ │  ├─ SourceDiscoveryAgent                           │ │
│ │  ├─ ExtractionAgent                                │ │
│ │  ├─ ValidationAgent                                │ │
│ │  ├─ RecoveryAgent (LLM)                            │ │
│ │  └─ PersistenceAgent                               │ │
│ └────────────────────────────────────────────────────┘ │
│                     │                                  │
│                     ▼                                  │
│           Single MySQL Database                        │
└────────────────────────────────────────────────────────┘

TARGET ARCHITECTURE (Distributed Event-Driven Financial Intelligence Engine)
┌────────────────────────────────────────────────────────────────────────┐
│                           API & INGESTION GATEWAY                      │
│      Express REST API  │  SSE Debug Stream  │  Webhooks  │  Admin UI   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Publishes Jobs
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     REDIS CLUSTER / BULLMQ QUEUE                       │
│  [ high-priority-scrape ]   [ batch-eod-scrape ]   [ anomaly-recovery ]│
└──────────────┬────────────────────┬────────────────────┬───────────────┘
               │                    │                    │
               ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       DISTRIBUTED WORKER POOL                          │
│                                                                        │
│  Worker Node 1                 Worker Node 2           Worker Node N   │
│  ┌─────────────────────────┐   ┌───────────────────┐   ┌─────────────┐ │
│  │ Playwright Stealth Pool │   │ Cheerio / SSR     │   │ LLM Healing │ │
│  │ Proxy Rotator (BD IPs)  │   │ Fast Extractors   │   │ & Diagnosis │ │
│  └─────────────────────────┘   └───────────────────┘   └─────────────┘ │
└──────────────┬─────────────────────────────────────────┬───────────────┘
               │ Raw Snapshots                           │ Structured
               ▼                                         ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│     OBJECT STORAGE (S3/R2)    │        │  PRIMARY RELATIONAL & TSDB    │
│  • Raw HTML Snapshots         │        │  • PostgreSQL / TimescaleDB   │
│  • Agent Run Audit Artifacts  │        │  • Real-time Minute Ticks     │
│  • Selector Diff History      │        │  • Anomaly & Audit Logs       │
└───────────────────────────────┘        └───────────────┬───────────────┘
                                                         │
                                                         ▼
                                         ┌───────────────────────────────┐
                                         │  ALERTING & STREAMING BUS     │
                                         │  • Telegram / Discord Bots    │
                                         │  • WebSocket Live Dashboard   │
                                         │  • Kafka / NATS Message Bus   │
                                         └───────────────────────────────┘
```

---

## 3. Distributed Job Orchestration & Queues (BullMQ + Redis)

### Why BullMQ?
The current execution model runs scrapes directly within HTTP request cycles or one-off CLI commands. Scraping all 400+ DSE instruments consecutively takes 15–25 minutes. A distributed queue provides:
- **Concurrency control:** Cap simultaneous Playwright instances to prevent CPU exhaustion.
- **Rate limiting:** Respect DSE domain request policies (e.g., maximum 1 request per second per IP).
- **Automatic retries:** Exponential backoff with jitter on network timeouts.
- **Priority queues:** Single-stock on-demand requests get processed ahead of daily batch jobs.

### Queue Topology

```
                  ┌─────────────────┐
                  │  Scheduler Cron │ (Every 5 min during 10:00 - 14:30 BST)
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Scrape Queue   │
                  │ (BullMQ/Redis)  │
                  └────────┬────────┘
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
       ┌───────────┐ ┌───────────┐ ┌───────────┐
       │ Worker 1  │ │ Worker 2  │ │ Worker 3  │
       └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
             └─────────────┼─────────────┘
                           ▼
               Central State / DB / S3
```

### Queue Implementation Blueprint

Create `src/queue/scrapeQueue.js`:

```javascript
'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');
const config = require('../config');
const logger = require('../logging/logger');
const Orchestrator = require('../agents/orchestrator/Orchestrator');

const log = logger.createChild({ module: 'scrapeQueue' });

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

const scrapeQueue = new Queue('dse-scrapes', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

function initScrapeWorker() {
  const worker = new Worker(
    'dse-scrapes',
    async (job) => {
      const { symbol, options } = job.data;
      log.info(`Processing queued scrape for ${symbol}`, { jobId: job.id });
      
      const result = await Orchestrator.scrape(symbol, options);
      if (!result.success) {
        throw new Error(result.error || 'Scrape execution failed');
      }
      return result;
    },
    {
      connection: redisConnection,
      concurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '2', 10),
      limiter: {
        max: 1,
        duration: 1500, // Max 1 job per 1.5s to respect DSE servers
      },
    }
  );

  worker.on('completed', (job) => {
    log.info(`Scrape job completed successfully`, { jobId: job.id, symbol: job.data.symbol });
  });

  worker.on('failed', (job, err) => {
    log.error(`Scrape job failed`, { jobId: job?.id, error: err.message });
  });

  return worker;
}

module.exports = { scrapeQueue, initScrapeWorker };
```

---

## 4. High-Resilience Scraping & Anti-Detection Upgrades

### 1. Bangladesh Residential Proxy Pool
During volatile market sessions or network throttling, direct requests from foreign cloud IPs (Render, AWS, DigitalOcean) may suffer geo-blocking or high latency.

- **Solution:** Introduce a `ProxyPool` abstraction in `src/tools/http/ProxyManager.js`:
  ```javascript
  class ProxyManager {
    constructor(proxies = []) {
      this.proxies = proxies;
      this.currentIndex = 0;
    }
    
    getNextProxy() {
      if (!this.proxies.length) return null;
      const proxy = this.proxies[this.currentIndex % this.proxies.length];
      this.currentIndex++;
      return proxy;
    }
    
    markFailed(proxy) {
      // Degrade health score or quarantine temporarily
    }
  }
  ```

### 2. Browser Context Recycling & Leak Prevention
Playwright headless Chromium processes consume significant RAM (~150MB per instance).
- **Rule:** Never launch a new browser instance for every symbol.
- **Pattern:** Launch a single `BrowserPool` singleton on startup, spawn lightweight `BrowserContext` instances per scrape, and recycle the browser process every 100 scrapes to prevent V8 memory accumulation.

### 3. Cascading Multi-Strategy Fallback
Current strategy resolution order:
1. `NextDataStrategy` (Fastest, zero-DOM, extracts JSON hydration `__NEXT_DATA__`)
2. `DomTableStrategy` (Direct Cheerio HTML table parse)
3. `PlaywrightStrategy` (Full headless browser render)

**Future Layer 4:** `VisionFallbackStrategy`  
If DSE switches to canvas-based rendering or obfuscates HTML tables into SVG/images:
- Playwright captures viewport screenshot of the company metrics panel.
- Screenshot is passed to a multimodal LLM (Gemini 1.5 Flash / GPT-4o-mini) with structured JSON output schema.
- Zod validates the visual extraction.

---

## 5. Autonomous Multi-Agent & LLM Evolution

### 1. Autonomous Selector Self-Healing (Zero Human Maintenance)
When DSE modifies class names or DOM structures, manual selector maintenance is costly. The `RecoveryAgent` should be empowered with **Selector Synthesis**:

```
      DOM Parsing Fails
              │
              ▼
   Fetch Current HTML snippet
              │
              ▼
  LLM Diagnostician:
  "Find the element containing 'Last Traded Price' or 'LTP'"
              │
              ▼
  Synthesizes new CSS/XPath selector
              │
              ▼
  Test against current HTML
              │
              ├── Valid? ──▶ Save to dynamic_selectors cache / DB
              │
              └── Invalid? ─▶ Escalate to Human-In-The-Loop
```

#### Self-Healing Schema Contract:
```typescript
interface SelectorPatch {
  symbol: string;
  field: 'ltp' | 'eps' | 'pe' | 'volume' | 'navps';
  oldSelector: string;
  newSelector: string;
  confidence: number; // 0.0 - 1.0
  sampleExtractedValue: string | number;
  testedAt: string;
}
```

### 2. Low-Cost Hybrid LLM Strategy (SLM + Frontier LLM)
Avoid high API costs on routine operations:
- **Local Small Language Model (SLM) via Ollama (e.g., Llama-3.2-3B or DeepSeek-R1-8B):**
  - Run locally for Routine Anomaly Classification and JSON schema repair (0 cost).
- **Frontier Models (Claude 3.5 Sonnet / Gemini Pro):**
  - Reserved exclusively for deep failure diagnosis, DOM reorganization, and selector synthesis.

---

## 6. Data Pipeline & Time-Series Scaling (PostgreSQL / TimescaleDB)

### The Dual-Storage Pattern
DSE equity data splits into two distinct data patterns:
1. **Instrument Master & Fundamental State (Relational):**
   - Company name, sector, paid-up capital, category, authorized capital, board meetings.
   - Best stored in standard relational schema: `instruments`, `scraping_runs`, `anomalies`.
2. **High-Frequency Market Quotes & Ratios (Time-Series):**
   - LTP, High, Low, Volume, Turnover, PE, Trade Count.
   - Requires time-series hyper-tables with automated data retention policies, compression, and downsampling (1-minute, 5-minute, 1-day candles).

### TimescaleDB Hyper-table Migration Plan

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Time-series market quotes table
CREATE TABLE instrument_market_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(30) NOT NULL,
    ltp NUMERIC(12, 2) NOT NULL,
    open NUMERIC(12, 2),
    high NUMERIC(12, 2),
    low NUMERIC(12, 2),
    close NUMERIC(12, 2),
    ycp NUMERIC(12, 2),
    volume BIGINT,
    turnover NUMERIC(18, 2),
    pe NUMERIC(8, 2),
    trade_count INTEGER
);

-- Convert to hypertable partitioned by time
SELECT create_hypertable('instrument_market_ticks', 'time');

-- Create compression policy (compress data older than 7 days)
ALTER TABLE instrument_market_ticks SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('instrument_market_ticks', INTERVAL '7 days');
```

---

## 7. Enterprise Observability, Laravel-Style Logging & Tracing

### 1. Centralized Ring Buffer & Daily Rotating Log Files
Following the Laravel framework's log convention (`storage/logs/laravel-YYYY-MM-DD.log`), the logging system should combine:
- **In-Memory Ring Buffer:** For high-speed UI retrieval without disk I/O bottlenecks.
- **Daily Rotating File Transports:** For cold storage and audit trail (`winston-daily-rotate-file`).
- **REST & SSE Endpoints:** Enabling real-time date-filtered log browsing from the frontend.

```
┌────────────────────────────────────────────────────────┐
│                      Winston Logger                    │
│   (log.info, log.warn, log.error, log.debug, etc.)     │
└───────────┬───────────────────────────────┬────────────┘
            │                               │
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│ In-Memory Ring Buffer │       │ Daily Rotating Files  │
│  (Last 2,000 entries) │       │ logs/dse-2026-10-11   │
└───────────┬───────────┘       └───────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────┐
│                 Logs REST API & UI                    │
│   /api/logs?date=2026-10-11&level=error&component=... │
│   Date picker, level badges, stack trace folding      │
└───────────────────────────────────────────────────────┘
```

### 2. Distributed Correlation IDs (`traceId`)
Every request or background job must generate a unique `traceId` (e.g. `tr_9f81a7b8`). This ID passes through every agent and logger call:
```javascript
// Logger child instance with traceId
const log = logger.createChild({ traceId: state.runId, agent: 'ExtractionAgent' });
log.info('Beginning table extraction', { symbol: state.symbol });
```

---

## 8. Multi-Exchange & Multi-Asset Expansion (CSE & Bonds)

To expand beyond DSE Equities, the ingestion architecture should decouple the exchange-specific scraping logic into modular Exchange Adapters.

### Exchange Adapter Interface

```javascript
// src/exchanges/ExchangeAdapter.js
class ExchangeAdapter {
  async getInstrumentList() { throw new Error('Not implemented'); }
  async fetchInstrumentSnapshot(symbol) { throw new Error('Not implemented'); }
  getMarketSchedule() { throw new Error('Not implemented'); }
}
```

### Planned Adapters:
1. **`DseAdapter`** (Existing): Covers Dhaka Stock Exchange main board (`dse.com.bd`).
2. **`DseSmbAdapter`**: Covers DSE Small & Medium Enterprise (SME) board.
3. **`CseAdapter`**: Covers Chittagong Stock Exchange (`cse.com.bd`).
4. **`GovtBondAdapter`**: Scrapes Treasury Bond yields and auction schedules from Bangladesh Bank / DSE debt market.

---

## 9. Automated Financial Intelligence & Anomaly Alerting

Beyond raw data scraping, the ingestion platform can calculate automated derivative indicators upon every successful scrape:

### Quantitative Metric Pipelines
1. **Valuation Multiples:**
   - Trailing P/E, Forward P/E, Price-to-Book (P/B = `LTP / NAVPS`).
   - Dividend Yield (`Latest Cash Dividend / LTP * 100`).
2. **Financial Health Scores:**
   - **Altman Z-Score (Emerging Market formula):** Evaluates insolvency risk for manufacturing companies.
   - **Piotroski F-Score (0 to 9 scale):** Evaluates financial strength improvements year-over-year.

### Multi-Channel Notification Dispatcher
When the `ValidationAgent` flags a `critical` anomaly (e.g. Price fluctuation > 10% circuit limit, or PE ratio swing > 50%):
- **Discord / Slack Webhooks:** Posts rich embed cards with metrics and direct audit link.
- **Telegram Bot:** Sends immediate push notification to traders/analysts.

---

## 10. Implementation Blueprints & Code Recipes

### Blueprint 1: Adding a Telegram Anomaly Alert Tool
File: `src/tools/notifications/TelegramNotifier.js`

```javascript
'use strict';

const axios = require('axios');
const logger = require('../../logging/logger');

const log = logger.createChild({ tool: 'TelegramNotifier' });

class TelegramNotifier {
  constructor(token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID) {
    this.token = token;
    this.chatId = chatId;
  }

  async sendAnomalyAlert(symbol, anomaly) {
    if (!this.token || !this.chatId) {
      log.debug('Telegram credentials not configured. Skipping alert.');
      return false;
    }

    const message = [
      `🚨 *DSE Scraper Anomaly Alert*`,
      `*Symbol:* \`${symbol}\``,
      `*Metric:* \`${anomaly.metric || anomaly.field}\``,
      `*Extracted Value:* ${anomaly.currentValue}`,
      `*Historical Benchmark:* ${anomaly.historicalValue || 'N/A'}`,
      `*Severity:* *${(anomaly.severity || 'WARNING').toUpperCase()}*`,
      `*Reasoning:* ${anomaly.reason || 'Unexpected statistical divergence detected.'}`,
      `_Timestamp:_ ${new Date().toISOString()}`
    ].join('\n');

    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'Markdown',
      }, { timeout: 8000 });
      log.info(`Telegram alert sent for ${symbol}`);
      return true;
    } catch (err) {
      log.error(`Failed to send Telegram alert: ${err.message}`);
      return false;
    }
  }
}

module.exports = TelegramNotifier;
```

---

### Blueprint 2: Creating a Nightly EOD Batch Cron Job
File: `src/cli/cron-scheduler.js`

```javascript
'use strict';

const cron = require('node-cron');
const { scrapeQueue } = require('../queue/scrapeQueue');
const InstrumentRepository = require('../repositories/InstrumentRepository');
const logger = require('../logging/logger');

const log = logger.createChild({ module: 'cronScheduler' });

// Run at 15:00 BST (3:00 PM) Sunday through Thursday (Bangladesh Trading Days)
// Timezone: Asia/Dhaka
cron.schedule('0 15 * * 0-4', async () => {
  log.info('Triggering End-Of-Day (EOD) full market scrape batch');
  
  try {
    const instruments = await InstrumentRepository.getAllActiveSymbols();
    log.info(`Dispatching ${instruments.length} instruments to BullMQ queue`);
    
    for (const inst of instruments) {
      await scrapeQueue.add('eod-scrape', {
        symbol: inst.symbol,
        options: { force: true, source: 'eod-cron' }
      });
    }
  } catch (err) {
    log.error('Failed to dispatch EOD batch', { error: err.message });
  }
}, {
  timezone: 'Asia/Dhaka'
});
```

---

## Summary Checklist for Next Contributors

When implementing any of the enhancements above:
- [ ] Maintain agent boundaries: Agents do not make raw database calls (use Repositories).
- [ ] Do not let the LLM generate unverified SQL or code (use Zod schemas for all LLM inputs/outputs).
- [ ] Ensure non-DB fallbacks are maintained so local/ephemeral environments continue to function.
- [ ] Include unit tests using Mock LLM and synthetic HTML fixtures.
- [ ] Document all new environment flags in `.env.example` and `TECHNICAL.md`.
