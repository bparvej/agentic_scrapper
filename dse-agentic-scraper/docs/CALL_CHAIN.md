# Call Chain — How the Code Flows

> **Purpose:** This document shows every function call, in order, when you run
> `npm run scrape -- BATBC` or `npm run scrape:all`.
>
> Read this before touching any file. Knowing the call chain prevents you from
> accidentally breaking an upstream caller or a downstream dependency.

---

## Command → File Mapping

| Command | npm script (package.json) | Entry File |
|---|---|---|
| `npm run scrape -- BATBC` | `"scrape": "node src/cli/scrape.js"` | `src/cli/scrape.js` |
| `npm run scrape:all` | `"scrape:all": "node src/cli/scrape-all.js"` | `src/cli/scrape-all.js` |
| `npm start` | `"start": "node src/app.js"` | `src/app.js` (HTTP server) |

---

## 1. `npm run scrape -- BATBC`

### Full Call Chain (read top → bottom)

```
npm run scrape -- BATBC
│
└─▶ src/cli/scrape.js   (ENTRY POINT)
      │  parse process.argv → symbol="BATBC", debug=false, force=false
      │  require('../config')               ← loads .env into process.env
      │  require('../agents/orchestrator/Orchestrator')
      │
      └─▶ run()   [async function inside scrape.js]
            │
            └─▶ Orchestrator.scrape("BATBC", { force, debug })
                  │  src/agents/orchestrator/Orchestrator.js → scrape()
                  │
                  │  1. getLLMProvider()
                  │     src/providers/llm/factory.js → getLLMProvider()
                  │       reads config.llm.provider
                  │       returns MockProvider | OpenAIProvider | OpenRouterProvider
                  │
                  │  2. new ScrapingState({ symbol: "BATBC" })
                  │     src/workflow/state/ScrapingState.js
                  │       sets runId = "SCRAPE-20260928-XXXXXXXX"
                  │       sets status = "pending"
                  │
                  │  3. ScrapingRunRepository.create(state)
                  │     src/repositories/ScrapingRunRepository.js → create()
                  │       getDb() → src/database/knex.js
                  │       INSERT INTO scraping_runs (run_id, symbol, status, ...)
                  │
                  │  ┌─────────────────────────────────────────────────────┐
                  │  │  STEP 1 — SOURCE DISCOVERY                          │
                  │  └─────────────────────────────────────────────────────┘
                  │
                  │  4. state.transition('fetching')
                  │  5. ScrapingRunRepository.update(state)   ← UPDATE scraping_runs
                  │
                  │  6. SourceDiscoveryAgent.run(state, llm)
                  │     src/agents/source-discovery/SourceDiscoveryAgent.js → run()
                  │     │
                  │     │  a. DseTool.fetchCompanyPage("BATBC")
                  │     │     src/tools/dse/DseTool.js → fetchCompanyPage()
                  │     │       buildCompanyUrl("BATBC") → "https://dse.com.bd/company/BATBC"
                  │     │       isDseUrl(url) → true (SSRF check)
                  │     │       HttpTool.fetchUrl(url)
                  │     │         src/tools/http/HttpTool.js → fetchUrl()
                  │     │           axios.get(url, { timeout, headers })
                  │     │           ← retries up to MAX_RETRIES on 5xx
                  │     │           ← waits on 429 Retry-After header
                  │     │         returns { data: html, statusCode: 200, ... }
                  │     │       sleep(REQUEST_DELAY_MS)  ← respectful delay
                  │     │       HtmlTool.isRenderedPage(html)
                  │     │         src/tools/html/HtmlTool.js → isRenderedPage()
                  │     │         returns { html, isRendered, fetchedAt, ... }
                  │     │
                  │     │  b. HtmlTool.extractJsonScripts(html)  ← look for __NEXT_DATA__
                  │     │     src/tools/html/HtmlTool.js → extractJsonScripts()
                  │     │       cheerio.load(html)
                  │     │       find <script id="__NEXT_DATA__"> → parse JSON
                  │     │
                  │     │  c. HtmlTool.extractTables(html)
                  │     │  d. HtmlTool.extractText(html)
                  │     │
                  │     │  e. llm.generateStructured(prompt, SourceDiscoveryOutputSchema)
                  │     │     ← LLM decides: "nextjs_data" | "html" | "browser"
                  │     │     ← if LLM fails → _deterministicFallback() (no LLM)
                  │     │
                  │     └─▶ returns updated state
                  │           state.extractionStrategy = "browser" (or "nextjs_data"/"html")
                  │           state.source.html = "<html>..."
                  │           state.status = "analyzing"
                  │
                  │  7. ScrapingRunRepository.update(state)
                  │
                  │  ┌─────────────────────────────────────────────────────┐
                  │  │  STEP 2 — EXTRACTION                                │
                  │  └─────────────────────────────────────────────────────┘
                  │
                  │  8. state.transition('extracting')
                  │  9. ScrapingRunRepository.update(state)
                  │
                  │  10. ExtractionAgent.run(state)
                  │      src/agents/extraction/ExtractionAgent.js → run()
                  │      │
                  │      │  Strategy waterfall (tries each until one succeeds):
                  │      │
                  │      │  ── Strategy 1: nextjs_data ──────────────────────
                  │      │  nextjsDataStrategy.extract(html, "BATBC")
                  │      │    src/extraction/strategies/nextjsDataStrategy.js
                  │      │      extractNextData(html) → parse __NEXT_DATA__ JSON
                  │      │      extractCompanyFromNextData(nextData)
                  │      │        walks props.pageProps.companyData / .company / .data
                  │      │      _normalizeNextData(raw, symbol)
                  │      │        normalizeNumber("680.40") → 680.40
                  │      │        normalizePercentage("7.35%") → 7.35
                  │      │        normalizeDate("2026-09-28") → "2026-09-28"
                  │      │        normalizeString("Food & Allied") → "Food & Allied"
                  │      │        → all from src/extraction/normalizers/valueNormalizer.js
                  │      │      returns ExtractionResult | null
                  │      │
                  │      │  ── Strategy 2: html (if strategy 1 returned null) ──
                  │      │  htmlStrategy.extract(html, "BATBC")
                  │      │    src/extraction/strategies/htmlStrategy.js
                  │      │      HtmlTool.extractTables(html)      ← all <table> rows
                  │      │      HtmlTool.extractKeyValuePairs(html) ← label|value <tr>s
                  │      │      _mapKvToSchema(allKv, symbol)
                  │      │        lookup("ltp" / "last trade price" / ...) → normalizeNumber()
                  │      │        lookup("eps" / "earnings per share" / ...) → normalizeNumber()
                  │      │        ... (fuzzy case-insensitive label matching)
                  │      │      returns ExtractionResult | null
                  │      │
                  │      │  ── Strategy 3: playwright (if strategies 1+2 failed) ──
                  │      │  playwrightStrategy.extract(url, "BATBC")
                  │      │    src/extraction/strategies/playwrightStrategy.js
                  │      │      new BrowserTool()
                  │      │        src/tools/browser/BrowserTool.js
                  │      │          chromium.launch({ headless: true })
                  │      │          page.goto(url, { waitUntil: 'networkidle' })
                  │      │          page.waitForTimeout(3000)   ← wait for JS hydration
                  │      │          page.content() → fully rendered HTML
                  │      │      htmlStrategy.extract(renderedHtml, "BATBC")  ← reuse strategy 2
                  │      │      browser.close()
                  │      │      returns ExtractionResult | null
                  │      │
                  │      └─▶ returns updated state
                  │            state.normalizedData = { symbol, lastTradePrice, eps, ... }
                  │            state.extractionStrategy = "playwright"
                  │            state.status = "validating"
                  │
                  │  11. ScrapingRunRepository.update(state)
                  │
                  │  ┌─────────────────────────────────────────────────────┐
                  │  │  STEP 3 — VALIDATION (+ optional RECOVERY loop)     │
                  │  └─────────────────────────────────────────────────────┘
                  │
                  │  12. MarketDataRepository.findLatestBySymbol("BATBC")
                  │      ← fetch previous data for anomaly comparison (may be null)
                  │
                  │  13. ValidationAgent.run(state, llm, previousData)
                  │      src/agents/validation/ValidationAgent.js → run()
                  │      │
                  │      │  Layer 1 — Zod schema check:
                  │      │    NormalizedInstrumentSchema.safeParse(normalizedData)
                  │      │    src/extraction/schemas/instrumentSchema.js
                  │      │
                  │      │  Layer 2 — Business rules (deterministic):
                  │      │    businessRules.validate(normalizedData)
                  │      │    src/validation/businessRules.js → validate()
                  │      │      checks: highPrice >= lowPrice
                  │      │      checks: volume >= 0
                  │      │      checks: ownership sums to ~100%
                  │      │      checks: faceValue is 1|2|5|10|100
                  │      │      ... (returns errors[], warnings[])
                  │      │
                  │      │  Layer 3 — Anomaly detection (vs previous DB data):
                  │      │    _detectAnomalies(current, previous)
                  │      │      compares: eps, lastTradePrice, navps, peRatio, ...
                  │      │      flags if change > threshold (e.g. EPS +200%)
                  │      │    llm.generateStructured(anomalyPrompt, schema)
                  │      │      ← LLM classifies: "normal" | "warning" | "critical"
                  │      │      ← if "critical" → moves to recovery
                  │      │
                  │      └─▶ returns updated state
                  │            state.validationResult = { valid, schemaErrors, businessErrors, ... }
                  │            state.status = "persisting" (if valid)
                  │                         = "recovering"  (if invalid)
                  │
                  │  ── IF validation failed → RECOVERY loop ────────────
                  │
                  │  14. RecoveryAgent.run(state, llm)
                  │      src/agents/recovery/RecoveryAgent.js → run()
                  │        checks state.recoveryAttempts < MAX_RECOVERY_ATTEMPTS
                  │        llm.generateStructured(recoveryPrompt, RecoveryPlanSchema)
                  │          ← LLM produces: { strategy, reason, waitForSelector, ... }
                  │          ← fallback: _deterministicRecoveryPlan() if LLM fails
                  │        executes plan (re-runs one of the 3 extraction strategies)
                  │        returns state with new normalizedData
                  │        → loops back to ValidationAgent.run()
                  │
                  │  ┌─────────────────────────────────────────────────────┐
                  │  │  STEP 4 — PERSISTENCE                               │
                  │  └─────────────────────────────────────────────────────┘
                  │
                  │  15. state.transition('persisting')
                  │  16. ScrapingRunRepository.update(state)
                  │
                  │  17. PersistenceAgent.run(state)
                  │      src/agents/persistence/PersistenceAgent.js → run()
                  │      │
                  │      │  Guard: validationResult.valid MUST be true or throws
                  │      │
                  │      │  db.transaction(async (trx) => {
                  │      │
                  │      │    a. InstrumentRepository.upsertTrx(trx, normalizedData)
                  │      │       src/repositories/InstrumentRepository.js → _upsertWith()
                  │      │         SELECT * FROM instruments WHERE symbol = 'BATBC'
                  │      │         → if exists:  UPDATE instruments SET company_name=... WHERE symbol=...
                  │      │         → if missing: INSERT INTO instruments (id, symbol, company_name, ...)
                  │      │         returns { id: "uuid", created: true|false }
                  │      │
                  │      │    b. MarketDataRepository.upsertTrx(trx, instrumentId, data, runId)
                  │      │       src/repositories/MarketDataRepository.js → _upsertWith()
                  │      │         SELECT FROM instrument_market_data WHERE instrument_id=...
                  │      │         → UPDATE or INSERT instrument_market_data
                  │      │         (last_trade_price, volume, market_cap, ...)
                  │      │
                  │      │    c. FinancialDataRepository.upsertTrx(trx, instrumentId, data, runId)
                  │      │       src/repositories/FinancialDataRepository.js → _upsertWith()
                  │      │         → UPDATE or INSERT instrument_financial_data
                  │      │         (eps, navps, pe_ratio, paid_up_capital, ...)
                  │      │
                  │      │    d. ListingDataRepository.upsertTrx(trx, instrumentId, data, runId)
                  │      │       src/repositories/ListingDataRepository.js → _upsertWith()
                  │      │         → UPDATE or INSERT instrument_listing_data
                  │      │         (sponsor_director_percent, institutional_percent, ...)
                  │      │
                  │      │  })  ← COMMIT or ROLLBACK as one atomic unit
                  │      │
                  │      │  e. ScrapingRunRepository.saveSnapshot(runId, ...)
                  │      │       INSERT INTO scraping_snapshots (raw_payload = html)
                  │      │
                  │      │  f. ScrapingRunRepository.logAnomalies(runId, symbol, anomalies)
                  │      │       INSERT INTO scraping_anomalies (field, severity, ...)
                  │      │
                  │      └─▶ returns updated state
                  │            state.status = "completed"
                  │            state.persistenceResult = { recordsCreated: 4, recordsUpdated: 0 }
                  │
                  │  18. ScrapingRunRepository.update(state)
                  │       UPDATE scraping_runs SET status='completed', completed_at=NOW()
                  │
                  │  19. ScrapingRunRepository.logErrors(runId, state.errors)
                  │       INSERT INTO scraping_errors (if any errors occurred)
                  │
                  └─▶ returns ScrapingRunResult
                        { runId, symbol, status, recordsCreated, recordsUpdated, ... }

      └─▶ back in run() inside scrape.js
            prints summary to console
            destroyConnection()  ← closes MySQL connection pool
            process.exitCode = 0 (success) or 1 (failure)
```

---

## 2. `npm run scrape:all`

### Full Call Chain

```
npm run scrape:all
│
└─▶ src/cli/scrape-all.js   (ENTRY POINT)
      │  require('../config')
      │
      └─▶ run()   [async function inside scrape-all.js]
            │
            │  1. InstrumentRepository.findAll()
            │     src/repositories/InstrumentRepository.js → findAll()
            │       SELECT * FROM instruments ORDER BY symbol
            │       ← if DB has rows: use those symbols
            │       ← if DB is empty: use SEED_SYMBOLS array (hardcoded fallback)
            │
            │  2. for each symbol in symbols[]:
            │     │
            │     └─▶ Orchestrator.scrape(symbol)
            │           ← SAME CALL CHAIN AS "npm run scrape -- BATBC" above
            │           ← runs steps 1–19 for each symbol
            │
            │     sleep(REQUEST_DELAY_MS)   ← delay between symbols (polite scraping)
            │
            └─▶ destroyConnection()
                  process.exitCode = 0 | 1
```

---

## 3. Web Server Path: `npm start` → API → Scrape

When the server is running and you call `POST /api/scrape/instrument`:

```
npm start
│
└─▶ src/app.js   (ENTRY POINT)
      │  createApp()   ← builds Express app
      │    app.use('/api/scrape',       scrapeRoutes)
      │    app.use('/api/instruments',  instrumentRoutes)
      │    app.use('/api/health',       healthRoutes)
      │  app.listen(3000)
      │
      └─▶ (waiting for HTTP requests)

POST /api/scrape/instrument  { "symbol": "BATBC" }
│
└─▶ src/api/routes/scrape.js → router.post('/instrument', handler)
      │  validate symbol (400 if missing/invalid)
      │
      └─▶ Orchestrator.scrape("BATBC", { force })
            ← SAME CALL CHAIN AS ABOVE (steps 1–19)

      └─▶ res.json(result)   ← HTTP 200 or 207
```

---

## 4. Key File Responsibilities (Quick Reference)

| File | Role | What it calls |
|---|---|---|
| `src/cli/scrape.js` | CLI entry for single symbol | `Orchestrator.scrape()` |
| `src/cli/scrape-all.js` | CLI entry for all symbols | `InstrumentRepository.findAll()`, `Orchestrator.scrape()` |
| `src/app.js` | HTTP server entry | Mounts Express routes |
| `src/api/routes/scrape.js` | POST /api/scrape/instrument | `Orchestrator.scrape()` |
| `src/agents/orchestrator/Orchestrator.js` | **Hub of everything** | All 5 agents + DB repos |
| `src/agents/source-discovery/SourceDiscoveryAgent.js` | Fetch + decide strategy | `DseTool`, `HtmlTool`, LLM |
| `src/agents/extraction/ExtractionAgent.js` | Run extraction strategy | 3 strategy files |
| `src/agents/validation/ValidationAgent.js` | Validate data | Zod, `businessRules`, LLM |
| `src/agents/recovery/RecoveryAgent.js` | Retry on failure | LLM, extraction strategies |
| `src/agents/persistence/PersistenceAgent.js` | Write to DB | 4 repositories |
| `src/tools/http/HttpTool.js` | All HTTP | `axios` |
| `src/tools/html/HtmlTool.js` | All HTML parsing | `cheerio` |
| `src/tools/browser/BrowserTool.js` | Headless browser | `playwright` |
| `src/tools/dse/DseTool.js` | DSE URL + fetch | `HttpTool`, `HtmlTool` |
| `src/extraction/strategies/nextjsDataStrategy.js` | Parse __NEXT_DATA__ | `valueNormalizer` |
| `src/extraction/strategies/htmlStrategy.js` | Parse HTML tables | `HtmlTool`, `valueNormalizer` |
| `src/extraction/strategies/playwrightStrategy.js` | Browser + HTML | `BrowserTool`, `htmlStrategy` |
| `src/extraction/normalizers/valueNormalizer.js` | Clean raw strings | (pure functions) |
| `src/validation/businessRules.js` | Business checks | (pure functions) |
| `src/repositories/InstrumentRepository.js` | instruments table | `knex.js` |
| `src/repositories/MarketDataRepository.js` | instrument_market_data | `knex.js` |
| `src/repositories/FinancialDataRepository.js` | instrument_financial_data | `knex.js` |
| `src/repositories/ListingDataRepository.js` | instrument_listing_data | `knex.js` |
| `src/repositories/ScrapingRunRepository.js` | scraping_runs + audit tables | `knex.js` |
| `src/database/knex.js` | DB connection singleton | `knex` npm package |
| `src/workflow/state/ScrapingState.js` | Immutable run state | (no dependencies) |
| `src/providers/llm/factory.js` | Create LLM provider | OpenAI / OpenRouter / Mock |
| `src/config/index.js` | All env vars | `dotenv` |
| `src/logging/logger.js` | Structured logging | `winston` |

---

## 5. Data Shape at Each Stage

```
Stage              Data shape
──────────────────────────────────────────────────────────────
After HTTP fetch   raw HTML string (may be a JS shell)
                       ↓
After extraction   ExtractionResult.data = {
                     symbol: "BATBC",
                     lastTradePrice: 680.40,   ← already a number
                     eps: 68.45,
                     volume: 12450,
                     extractedFields: [...],   ← provenance
                     extractionWarnings: [...],
                     ...
                   }
                       ↓
After validation   same object + validationResult = {
                     valid: true,
                     schemaErrors: [],
                     businessErrors: [],
                     anomalies: [],
                   }
                       ↓
After persistence  4 DB rows upserted:
                     instruments           (master record)
                     instrument_market_data
                     instrument_financial_data
                     instrument_listing_data
                   + audit rows:
                     scraping_runs         (1 row per command run)
                     scraping_snapshots    (raw HTML)
                     scraping_anomalies    (if any)
```

---

## 6. Where Errors Are Handled

| Location | What happens on error |
|---|---|
| `HttpTool.fetchUrl()` | Retries up to `MAX_RETRIES`, then throws |
| `SourceDiscoveryAgent.run()` | Catches throw → `state.addError()` → `state.transition('failed')` |
| `ExtractionAgent.run()` | All strategies fail → `state.transition('recovering')` |
| `ValidationAgent.run()` | Invalid data → `state.transition('recovering')` |
| `RecoveryAgent.run()` | Max attempts → `state.transition('failed')` |
| `PersistenceAgent.run()` | Transaction rollback → `state.addError()` → `state.transition('failed')` |
| `Orchestrator.scrape()` | Final state is always returned, never throws to caller |
| `scrape.js run()` | Wraps in try/catch → prints error, sets exitCode=1 |

---

## 7. State Machine Diagram

```
                    ┌─────────┐
                    │ pending │
                    └────┬────┘
                         │ ScrapingState created, DB row inserted
                         ▼
                    ┌──────────┐
                    │ fetching │  SourceDiscoveryAgent fetches DSE page
                    └────┬─────┘
                         │
                         ▼
                    ┌──────────┐
                    │analyzing │  LLM picks strategy, HTML analysed
                    └────┬─────┘
                         │
                         ▼
                    ┌────────────┐
                    │ extracting │  ExtractionAgent runs strategy waterfall
                    └─────┬──────┘
                          │
                          ▼
                    ┌────────────┐
                    │ validating │◀────────────────┐
                    └─────┬──────┘                 │
                          │                        │
               ┌──────────┴──────────┐             │
               │ valid               │ invalid      │
               ▼                     ▼              │
         ┌───────────┐        ┌────────────┐        │
         │ persisting│        │ recovering │────────┘
         └─────┬─────┘        └─────┬──────┘  (up to MAX_RECOVERY_ATTEMPTS)
               │                   │
               │                   │ max attempts reached
               ▼                   ▼
         ┌───────────┐        ┌────────┐
         │ completed │        │ failed │
         └───────────┘        └────────┘
```
