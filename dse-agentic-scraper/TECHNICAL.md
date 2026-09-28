# TECHNICAL.md — DSE Agentic Scraper

> **Audience:** Future developers and AI coding agents working on this codebase.
>
> This document explains every architectural decision, every agent contract,
> every tool contract, and the rules that must be followed when modifying the system.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Decisions](#2-technology-decisions)
3. [Directory Responsibilities](#3-directory-responsibilities)
4. [Agent Contracts](#4-agent-contracts)
5. [Tool Contracts](#5-tool-contracts)
6. [Workflow State](#6-workflow-state)
7. [Extraction System](#7-extraction-system)
8. [LLM Abstraction](#8-llm-abstraction)
9. [Database Design](#9-database-design)
10. [Validation System](#10-validation-system)
11. [Recovery System](#11-recovery-system)
12. [Coding Conventions](#12-coding-conventions)
13. [Extension Guide](#13-extension-guide)
14. [Rules for AI Coding Agents](#14-rules-for-ai-coding-agents)

---

## 1. Architecture Overview

### Core Principle

> LLM = Reasoning. Node.js = Execution. MySQL = State.

The LLM is NEVER used for:
- HTTP requests
- SQL queries
- JSON parsing
- Number formatting
- Duplicate detection
- Schema validation (Zod handles that)

The LLM IS used for:
- Deciding which extraction source to use (source discovery)
- Classifying whether an anomaly is normal / warning / critical
- Diagnosing why extraction failed and producing a recovery plan

### Workflow (state machine)

```
pending
  → fetching        SourceDiscoveryAgent: HTTP fetch + page analysis
  → analyzing       (inside SourceDiscovery)
  → extracting      ExtractionAgent: run the right strategy
  → validating      ValidationAgent: schema + business + anomaly
  → [recovering]    RecoveryAgent: LLM diagnosis + retry loop
  → persisting      PersistenceAgent: DB transaction
  → completed
  → failed          (at any point)
```

State is tracked in `ScrapingState` (immutable value object).
Every state transition creates a new object — old state is never mutated.

---

## 2. Technology Decisions

### Node.js (JavaScript, not TypeScript)

Chosen for:
- Minimal toolchain (no compile step)
- Direct `require()` compatibility with all tools
- Team requested JS not TS

### Express over Fastify

Chosen because:
- Wider ecosystem familiarity
- Simpler middleware model for this use case
- Fastify's schema-based routing is valuable at scale but overkill for this MVP

### Knex over Prisma/Drizzle

Chosen because:
- **Portable SQL**: Knex generates SQL that works identically for MySQL and PostgreSQL — just change the `client` config value
- **No code generation step**: Prisma requires `prisma generate`; Knex is pure runtime
- **Migration system**: Knex has a production-proven migration runner built in
- **Flexibility**: Raw query access when needed without leaving the ORM

### Zod for validation

Chosen because:
- Runtime validation (unlike TypeScript types which disappear at runtime)
- Works perfectly with LLM output validation
- Clear error messages

### Winston for logging

Chosen because:
- JSON format out of the box
- Child loggers with metadata (every log includes agent/tool name)
- Configurable transports (console for dev, file for prod)

---

## 3. Directory Responsibilities

| Path | Responsibility |
|---|---|
| `src/config/index.js` | Single source of truth for all env vars. Never call `process.env` elsewhere. |
| `src/logging/logger.js` | Winston logger singleton. Use `logger.createChild({})` for context. |
| `src/providers/llm/` | LLM provider abstraction. All LLM calls go here. |
| `src/tools/http/` | All outbound HTTP. No other module uses axios/fetch directly. |
| `src/tools/html/` | All HTML parsing. No other module uses Cheerio directly. |
| `src/tools/browser/` | All Playwright usage. No other module imports Playwright. |
| `src/tools/dse/` | DSE-specific URL construction and fetch helpers. |
| `src/extraction/strategies/` | One file per extraction strategy. |
| `src/extraction/normalizers/` | Value normalisation. Purely deterministic. |
| `src/extraction/schemas/` | Zod schemas for all data shapes, including LLM output schemas. |
| `src/validation/businessRules.js` | Deterministic business rule checks. No LLM. |
| `src/agents/` | Each agent is a module exporting a `run(state, llm?)` function. |
| `src/workflow/state/` | `ScrapingState` value object. |
| `src/repositories/` | All database operations. No raw SQL. No LLM. |
| `src/database/` | Knex connection, migration runner, migration files. |
| `src/api/` | Express routes. Thin controllers — they call Orchestrator, nothing else. |
| `src/cli/` | CLI entry points. Call Orchestrator and format output. |

---

## 4. Agent Contracts

All agents follow this contract:

```js
// Input:  ScrapingState
// Output: ScrapingState (new object, never mutated)
// Errors: Caught internally, recorded in state.errors
async function run(state, llm) { ... }
```

### SourceDiscoveryAgent

**File:** `src/agents/source-discovery/SourceDiscoveryAgent.js`

| Item | Detail |
|---|---|
| Input | `state` (status: pending/fetching) |
| Output | `state` with `source.html`, `source.nextData`, `extractionStrategy`, `pageMetadata` |
| Tools | `HttpTool.fetchUrl`, `HtmlTool.*`, `DseTool.fetchCompanyPage` |
| LLM use | YES — decides between `nextjs_data`, `html`, `browser` |
| LLM fallback | Deterministic fallback based on `isRendered` and `hasNextData` |
| Failure mode | Returns `state.transition('failed')` on HTTP error |
| Retry | No (retries are in HttpTool) |

### ExtractionAgent

**File:** `src/agents/extraction/ExtractionAgent.js`

| Item | Detail |
|---|---|
| Input | `state` (status: extracting) with `source.html` and `extractionStrategy` |
| Output | `state` with `rawData`, `normalizedData`, `extractionStrategy` |
| Tools | Extraction strategies (nextjsData, html, playwright) |
| LLM use | NO — extraction is entirely deterministic |
| Failure mode | Returns `state.transition('recovering')` if all strategies fail |
| Strategy order | nextjs_data → html → playwright |

### ValidationAgent

**File:** `src/agents/validation/ValidationAgent.js`

| Item | Detail |
|---|---|
| Input | `state` (status: validating), `previousData` from DB |
| Output | `state` with `validationResult`, `anomalies` |
| Tools | Zod schema, `businessRules.validate` |
| LLM use | YES — classifies anomaly severity |
| LLM fallback | All anomalies treated as `warning` |
| Failure mode | Invalid data → `state.transition('recovering')`. Critical anomaly → `state.transition('recovering')` |

### RecoveryAgent

**File:** `src/agents/recovery/RecoveryAgent.js`

| Item | Detail |
|---|---|
| Input | `state` (status: recovering) |
| Output | `state` with new `normalizedData` ready for re-validation |
| Tools | Extraction strategies, DseTool |
| LLM use | YES — produces recovery plan |
| LLM fallback | Deterministic: if page is JS shell → playwright, else html |
| Max retries | `config.workflow.maxRecoveryAttempts` |
| Guard | Never suggests a strategy that was already tried |
| Failure | `state.transition('failed')` when max retries reached |

### PersistenceAgent

**File:** `src/agents/persistence/PersistenceAgent.js`

| Item | Detail |
|---|---|
| Input | `state` (status: persisting) with `validationResult.valid === true` |
| Output | `state` (status: completed) with `persistenceResult` |
| Tools | InstrumentRepository, MarketDataRepository, FinancialDataRepository, ListingDataRepository |
| LLM use | NEVER |
| Transactions | All inserts wrapped in a single Knex transaction |
| Guard | Will not persist if `validationResult.valid === false` |

---

## 5. Tool Contracts

### HttpTool

**File:** `src/tools/http/HttpTool.js`

```
fetchUrl(url, opts?)

Input:
  url: string (validated by isDseUrl before calling agents)
  opts.timeoutMs: number
  opts.maxRetries: number
  opts.delayMs: number

Output:
  { data: string, statusCode: number, headers: object, url: string }

Failures:
  Throws Error after maxRetries exhausted.

Side effects:
  Sleep between retries. No DB writes. No LLM calls.
```

```
isDseUrl(url)

Input: url: string
Output: boolean
Purpose: SSRF prevention — only allows dse.com.bd domains
```

### HtmlTool

**File:** `src/tools/html/HtmlTool.js`

All functions are pure (no side effects):

| Function | Returns |
|---|---|
| `extractTables(html)` | `Array<{headers, rows}>` |
| `extractKeyValuePairs(html)` | `object` (flat key-value map) |
| `extractJsonScripts(html)` | `Array<{id, type, data}>` |
| `extractLinks(html, baseUrl?)` | `Array<{href, text}>` |
| `extractMetadata(html)` | `object` |
| `extractText(html)` | `string` |
| `isRenderedPage(html)` | `boolean` (heuristic: body text > 200 chars) |

### BrowserTool

**File:** `src/tools/browser/BrowserTool.js`

```
new BrowserTool()
  .launch(opts?)
  .openPage(url, opts?) → BrowserPage
  .close()

BrowserPage:
  .getHtml()
  .getText()
  .getTables()
  .getKeyValuePairs()
  .getJsonScripts()
  .getLinks(baseUrl?)
  .getMetadata()
  .getNetworkRequests()
  .isRendered()
  .click(selector)
  .waitFor(selector, timeout?)
```

BrowserTool wraps Playwright. No other module imports Playwright.
If `DISABLE_PLAYWRIGHT=true`, `launch()` throws immediately.

### DseTool

**File:** `src/tools/dse/DseTool.js`

```
buildCompanyUrl(symbol)       → string (validated)
fetchCompanyPage(symbol)      → FetchResult
extractNextData(html)         → object|null
extractCompanyFromNextData(nextData) → object|null
fetchCompanyListPage()        → FetchResult
```

All URL construction happens in DseTool. No other module builds DSE URLs.

---

## 6. Workflow State

**File:** `src/workflow/state/ScrapingState.js`

The `ScrapingState` is an immutable value object. Every update creates a new instance.

### Fields

| Field | Type | Description |
|---|---|---|
| `runId` | string | Unique run ID (`SCRAPE-YYYYMMDD-XXXXXXXX`) |
| `symbol` | string | DSE symbol (always uppercase) |
| `url` | string | Canonical DSE URL |
| `status` | string | Current workflow status |
| `source` | object\|null | Fetch result including `html`, `nextData` |
| `pageMetadata` | object\|null | Page analysis metadata |
| `extractionStrategy` | string\|null | Strategy that succeeded |
| `rawData` | object\|null | Raw extracted data |
| `normalizedData` | object\|null | Normalised instrument data |
| `validationResult` | object\|null | Zod + business + anomaly results |
| `anomalies` | array | Detected anomalies |
| `recoveryAttempts` | number | Number of recovery cycles |
| `recoveryPlans` | array | History of recovery plans |
| `errors` | array | All errors `{agent, message, timestamp}` |
| `startedAt` | Date | Run start time |
| `completedAt` | Date\|null | Run end time |
| `persistenceResult` | object\|null | `{recordsCreated, recordsUpdated}` |

### Methods

```js
state.update(fields)        // Returns new state with overrides
state.addError(agent, err)  // Returns new state with error appended
state.transition(status)    // Returns new state with new status
state.toJSON()              // Safe serialisation (excludes large HTML)
state.durationMs            // Computed: completedAt - startedAt
```

---

## 7. Extraction System

### Strategy Files

| File | Strategy | When Used |
|---|---|---|
| `nextjsDataStrategy.js` | Parse `__NEXT_DATA__` | When Next.js JSON is in page |
| `htmlStrategy.js` | Parse rendered HTML tables | When page is rendered |
| `playwrightStrategy.js` | Browser + HTML strategy | When page is a JS shell |

### Strategy Interface

Every strategy exports:

```js
// Synchronous strategies
extract(html, symbol) → ExtractionResult|null

// Async strategies (Playwright)
extract(url, symbol, opts?) → Promise<ExtractionResult|null>

// ExtractionResult
{
  success: boolean,
  strategy: string,
  data: NormalizedInstrument,
  warnings: string[],
  errors: string[],
}
```

Returning `null` means "this strategy cannot extract from this input".
Returning `{ success: false }` means "tried and failed with an error".

### Normalizers

**File:** `src/extraction/normalizers/valueNormalizer.js`

All normalizers return `{ value, warning }` tuples — never throw.

| Function | Input | Output |
|---|---|---|
| `normalizeNumber(raw)` | `"1,245.50"` | `{ value: 1245.50 }` |
| `normalizePercentage(raw)` | `"7.35%"` | `{ value: 7.35 }` |
| `normalizeDate(raw)` | `"28/09/2026"` | `{ value: "2026-09-28" }` |
| `normalizeString(raw)` | `"N/A"` | `{ value: null }` |
| `normalizeInteger(raw)` | `"12,450"` | `{ value: 12450 }` |

### Provenance

Every extracted field is tracked:

```js
{
  field: "lastTradePrice",
  value: 680.40,
  rawValue: "680.40",
  source: {
    type: "html_kv",   // nextjs_data | html_table | html_kv | playwright | api
    selector: "table",
    text: "680.40"
  },
  confidence: 0.85,
  warning: null
}
```

---

## 8. LLM Abstraction

**Base class:** `src/providers/llm/LLMProvider.js`

```js
class LLMProvider {
  async generateText(input)            // Free text response
  async generateStructured(input, schema) // JSON response validated by Zod
}
```

**Factory:** `src/providers/llm/factory.js`

```js
getLLMProvider()   // Singleton, reads LLM_PROVIDER from config
setLLMProvider(p)  // Override for tests
```

**Implementations:**

| Provider | File | Notes |
|---|---|---|
| Mock | `MockProvider.js` | No API key, deterministic |
| OpenAI | `OpenAIProvider.js` | Uses `response_format: json_object` |
| OpenRouter | `OpenRouterProvider.js` | Extends OpenAIProvider with custom baseURL |

### Hallucination Prevention

- `generateStructured` always validates LLM output against a Zod schema before returning
- If the schema fails, an error is thrown and the caller falls back to deterministic logic
- LLM prompts explicitly state: "Do NOT invent field values"
- Provenance is tracked — every value has a `source` field

### Token Budget

- `maxTokens` defaults to 2048
- `temperature` is 0 for structured outputs (deterministic JSON)
- Prompts are kept in separate `.md` files to keep them auditable

---

## 9. Database Design

### Key Design Decisions

- UUIDs as primary keys (string, 36 chars) — portable between MySQL and PostgreSQL
- All monetary values use `DECIMAL(18,4)` or `DECIMAL(24,4)` — never `FLOAT`
- Timestamps stored as `DATETIME` (UTC)
- JSON columns for flexible metadata
- One record per instrument in master tables (upsert pattern)
- Separate tables for market data, financial data, listing data

### Tables

#### `instruments`
Master record. One row per DSE symbol. Created on first scrape, updated on subsequent scrapes.

```
id (PK), symbol (UNIQUE), company_name, scrip_code, isin, sector,
industry, category, instrument_type, market, operational_status,
electronic_share, listing_year, debut_trading_date, metadata (JSON),
created_at, updated_at
```

#### `instrument_market_data`
Latest price snapshot. One row per instrument (upserted on each run).

```
id (PK), instrument_id (FK), symbol, last_trade_price, open_price,
high_price, low_price, close_price, yesterday_close_price,
week_high_52, week_low_52, change, change_percent, volume,
trade_count, turnover, market_cap, free_float_cap,
scraping_run_id, scraped_at, created_at, updated_at
```

#### `instrument_financial_data`
Financial metrics. One row per instrument (upserted).

```
id (PK), instrument_id (FK), symbol, authorized_capital, paid_up_capital,
face_value, total_securities, eps, eps_q1, eps_h1, eps_9m, diluted_eps,
navps, pe_ratio, dividend_yield, cash_dividend, agm_date,
short_term_loan, long_term_loan, total_loan, scraping_run_id, ...
```

#### `scraping_runs`
Audit record per execution.

```
id (PK), run_id (UNIQUE), symbol, url, status, extraction_strategy,
recovery_attempts, records_created, records_updated, validation_passed,
warnings (JSON), errors (JSON), review_status, started_at, completed_at
```

#### `scraping_snapshots`
Raw HTML/JSON for debugging. Truncated at 1MB.

```
id (PK), scraping_run_id (FK), symbol, source_url, source_type,
raw_payload (MEDIUMTEXT), created_at
```

### PostgreSQL Migration

To migrate from MySQL to PostgreSQL:

1. Change `DATABASE_CLIENT=pg` in `.env`
2. Install `pg`: `npm install pg`
3. Run migrations against the PostgreSQL database
4. No application code changes needed — Knex handles dialect differences

---

## 10. Validation System

Three layers, all deterministic except layer 3:

### Layer 1: Schema (Zod)

**Schema:** `src/extraction/schemas/instrumentSchema.js` — `NormalizedInstrumentSchema`

Checks types and shapes. All financial fields are optional (null-safe).

### Layer 2: Business Rules

**File:** `src/validation/businessRules.js`

Pure function: `validate(data) → { errors, warnings }`. No DB calls. No LLM.

Rules include:
- Required: `symbol`
- `highPrice >= lowPrice`
- `volume >= 0`, `tradeCount >= 0`
- Prices are non-negative
- `dividendYield` in `[0, 100]`
- `faceValue` is a standard DSE value (1, 2, 5, 10, 100)
- Ownership percentages sum to ~100

### Layer 3: Historical Anomaly Detection

**In:** `ValidationAgent.run()`

Compares current values against previous DB values. Flags changes beyond configurable thresholds:

| Field | Threshold |
|---|---|
| lastTradePrice, closePrice | > 50% change |
| eps, navps | > 200% change |
| peRatio | > 300% change |

Flagged anomalies are sent to the LLM for classification into: `normal`, `warning`, `critical`.

`critical` anomalies block persistence and move the workflow to `recovering`.

---

## 11. Recovery System

### Trigger Conditions

Recovery is triggered when:
1. `ExtractionAgent` returns with no result (all strategies yielded null)
2. `ValidationAgent` finds schema or business rule violations
3. `ValidationAgent` detects `critical` anomalies

### Recovery Flow

```
RecoveryAgent.run(state, llm)
  1. Check recoveryAttempts < maxRecoveryAttempts
  2. Build context summary (errors, strategy tried, page info)
  3. LLM produces RecoveryPlan (strategy, reason, actions, waitForSelector)
  4. Guard: don't retry a strategy already tried
  5. Execute plan (run the specified extraction strategy)
  6. Return state ready for re-validation
```

### Recovery Plan Schema

```js
{
  strategy: 'playwright' | 'html' | 'nextjs_data' | 'alternative_url',
  reason: string,
  actions: string[],
  alternativeUrl?: string,
  waitForSelector?: string,
  confidence: number
}
```

### Limits

`MAX_RECOVERY_ATTEMPTS` (default: 3) — hard cap on recovery cycles.
After exhaustion, state transitions to `failed`.

---

## 12. Coding Conventions

### Error Handling

- Every agent catches errors internally and records them in `state.errors`
- Agents never throw to the orchestrator — they return failed states
- Tools (HttpTool, BrowserTool) throw — agents catch them

### Logging

Always use child loggers:

```js
const log = logger.createChild({ agent: 'my-agent' });
log.info('Something happened', { symbol, runId });
```

Never log secrets (API keys, DB passwords, raw tokens).

### Naming

- Files: `camelCase.js` for modules, `PascalCase.js` for classes
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- DB columns: `snake_case`
- JS objects: `camelCase`

### Repository Pattern

All DB access through repositories. Never:
```js
// WRONG — direct DB access outside a repository
const db = getDb();
await db('instruments').insert({ ... });
```

Always:
```js
// RIGHT
await InstrumentRepository.upsert(data);
```

### No SQL from LLM

The LLM MUST NOT generate SQL that is executed against the database.
All queries are written by humans in repository files.

---

## 13. Extension Guide

### Adding a new DSE field

1. Add the field to `NormalizedInstrumentSchema` in `src/extraction/schemas/instrumentSchema.js`
2. Add it to the `pick()` call in `nextjsDataStrategy.js` with all possible API key names
3. Add it to the `lookup()` call in `htmlStrategy.js` with all possible label strings
4. If it needs a new DB column, create a migration in `src/database/migrations/`
5. Add it to the appropriate repository's `upsert` method
6. Add a business rule in `businessRules.js` if appropriate
7. Add a test case

### Adding a new extraction strategy

1. Create `src/extraction/strategies/myStrategy.js` implementing the strategy interface
2. Export `extract(html, symbol)` (sync) or `extract(url, symbol, opts)` (async)
3. Add it to `ExtractionAgent.js` in the strategy waterfall
4. Update `RecoveryPlanSchema` in the schemas file if recovery should target it
5. Document it here

### Adding a new agent

1. Create `src/agents/my-agent/MyAgent.js`
2. Export `async function run(state, llm?) { ... }`
3. Return a new `ScrapingState` (never mutate the input)
4. Record errors via `state.addError()`
5. Add a prompt file in `src/agents/prompts/` if it uses the LLM
6. Wire it into `Orchestrator.js`

### Adding a new LLM provider

1. Create `src/providers/llm/MyProvider.js` extending `LLMProvider`
2. Implement `generateText(input)` and `generateStructured(input, schema)`
3. Add a case in `src/providers/llm/factory.js`
4. Document the env vars in `.env.example`

### Switching to PostgreSQL

1. `npm install pg`
2. Set `DATABASE_CLIENT=pg` in `.env`
3. Set `DATABASE_PORT=5432` and update connection details
4. Run `npm run db:migrate` against the PostgreSQL database
5. No other changes needed

### Adding a validation rule

1. Open `src/validation/businessRules.js`
2. Add a check in the `validate(data)` function
3. Push to `errors[]` for blocking violations, `warnings[]` for informational
4. Add a unit test in `tests/unit/validators/businessRules.test.js`

---

## 14. Rules for AI Coding Agents

> These rules exist to prevent subtle bugs and maintain system integrity.
> Follow them exactly. Do not make exceptions without human approval.

### Absolute Rules

1. **Do not bypass validation.** Data that fails `ValidationAgent` must not reach `PersistenceAgent`. The guard in `PersistenceAgent.run()` must remain.

2. **Do not write or execute arbitrary SQL from LLM output.** All queries must be in repository files, written by humans.

3. **Do not remove provenance.** Every extracted field should include a `source` object. Do not strip `extractedFields` from the data pipeline.

4. **Do not remove audit logging.** `scraping_runs`, `scraping_errors`, and `scraping_anomalies` tables must be written on every run.

5. **Do not hard-code secrets.** All credentials, API keys, and passwords must come from `config/index.js` which reads `.env`.

6. **Do not replace deterministic extraction with LLM reasoning.** The LLM must not guess field values. If a field cannot be found deterministically, its value must be `null` with a warning.

7. **Do not remove the `isDseUrl` check** in `HttpTool.js`. It prevents SSRF.

8. **Do not import Playwright outside `BrowserTool.js`.** All browser interactions go through that abstraction.

9. **Do not call `process.env` directly** anywhere outside `src/config/index.js`.

10. **Do not make the recovery loop infinite.** The `loopGuard` and `MAX_RECOVERY_ATTEMPTS` limits in the Orchestrator must be maintained.

### Required Actions When Modifying

- **Adding a new field** → update schema, strategies, repository, migration, tests
- **Changing a business rule** → update `businessRules.js` AND add a test
- **Changing the DB schema** → create a new migration file, never alter existing migrations
- **Changing agent behaviour** → update this `TECHNICAL.md`
- **Changing user-facing behaviour** → update `README.md`
- **Changing LLM prompts** → review `generateStructured` schema for compatibility

### Testing Requirements

- Every new normalizer function needs unit tests
- Every new business rule needs a test covering the happy path and the violation
- Extraction strategy tests must use fixtures, not live network calls
- Integration tests that hit the database must clean up after themselves
