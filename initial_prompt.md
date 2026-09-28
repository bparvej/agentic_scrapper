# Build an Agentic DSE Instrument Data Scraping & Ingestion System

## 1. Role

You are a senior software architect and Node.js engineer specializing in:

* Agentic AI workflows
* Web scraping
* Next.js applications
* Dynamic web pages
* Data extraction
* Data validation
* MySQL/PostgreSQL
* Production-grade backend systems
* Observability and audit logging
* Self-healing/recovery workflows

Build the project from scratch.

Do not create a simple scraper.

The goal is to build an **agentic workflow for extracting instrument/company data from the Dhaka Stock Exchange (DSE) website**, validating the extracted information, detecting layout/schema changes, recovering from extraction failures, and storing validated data into MySQL.

The database layer must be designed so that MySQL can later be replaced by PostgreSQL with minimal application changes.

---

# 2. Target Website

Current DSE website:

https://dse.com.bd/company/BATBC

The DSE website has been redesigned and uses **Next.js**.

The old DSE URL was:

https://old.dse.com.bd/displayCompany.php?name=BATBC

Do NOT build the new system around the old website.

The new target is:

https://dse.com.bd/company/{SYMBOL}

Examples:

BATBC
GP
SQURPHARMA
BEXIMCO
etc.

The system must support arbitrary DSE instrument/company symbols.

---

# 3. Primary Objective

Build a system that can perform:

```text
User/Scheduler
      ↓
Agentic Orchestrator
      ↓
Discover DSE page
      ↓
Fetch/Render page
      ↓
Analyze page structure
      ↓
Identify data sections
      ↓
Extract instrument data
      ↓
Normalize data
      ↓
Validate data
      ↓
Compare against existing DB data
      ↓
Detect anomalies
      ↓
If extraction fails:
        ↓
      Recovery Agent
        ↓
      Retry / alternative extraction strategy
      ↓
Validate again
      ↓
Persist validated data
      ↓
Audit/logging
      ↓
Final scraping report
```

The system must be designed around an **agentic workflow**, not just an LLM calling a scraper once.

---

# 4. Important Architectural Principle

DO NOT make the LLM responsible for everything.

Use deterministic code whenever possible.

The architecture should follow:

```text
LLM / Agent
    =
Reasoning + Planning + Diagnosis + Recovery

Node.js Tools
    =
HTTP + Browser + HTML + DOM + Extraction + Validation + Database

MySQL
    =
Persistent State

Workflow State
    =
Shared state between agents/tools
```

Do NOT use an LLM to perform:

* raw HTTP requests
* SQL queries directly
* database schema validation
* numeric parsing
* date parsing
* duplicate detection
* deterministic transformations

Use normal Node.js code for these.

Use the LLM when reasoning is required, for example:

* identifying page sections
* mapping page fields to internal fields
* diagnosing why extraction failed
* generating an alternative extraction strategy
* identifying unexpected layout changes
* deciding whether data should be re-fetched
* explaining anomalies

---

# 5. Technology Stack

Use:

### Backend

Node.js

Prefer:

* TypeScript
* Fastify or Express

Choose one and explain the decision in technical.md.

Prefer TypeScript.

### Database

MySQL initially.

Use a database abstraction/ORM that allows future PostgreSQL migration.

Possible choices:

* Prisma
* Drizzle ORM
* Knex

Choose the most appropriate option and document why.

The application must not contain MySQL-specific SQL everywhere.

Keep the repository/data-access layer database-independent.

### Agentic Workflow

Use a lightweight agentic architecture.

Do not over-engineer the MVP.

You may use an established agent/workflow framework if it provides real value, but the core workflow must remain understandable.

The architecture should support:

* planner
* tools
* shared state
* validation
* retries
* recovery
* audit logs

If using an LLM SDK/framework, isolate it behind an abstraction.

---

# 6. LLM Provider Abstraction

Do not hard-code the application to one LLM provider.

Create:

```text
LLMProvider
```

interface.

Example:

```typescript
interface LLMProvider {
  generateText(input: LLMInput): Promise<LLMResponse>;
  generateStructured<T>(
    input: LLMInput,
    schema: unknown
  ): Promise<T>;
}
```

The implementation should be replaceable.

For example:

```text
providers/
    llm/
        LLMProvider.ts
        OpenAIProvider.ts
        OpenRouterProvider.ts
        ...
```

The exact initial provider can be selected through environment variables.

Example:

```env
LLM_PROVIDER=...
LLM_MODEL=...
LLM_API_KEY=...
```

Do not expose API keys in source code.

---

# 7. DSE Website Investigation

Before implementing extraction logic, inspect the current DSE website:

https://dse.com.bd/company/BATBC

Understand:

* Next.js architecture
* server-rendered vs client-rendered content
* HTML structure
* available embedded data
* API calls made by the frontend
* network/API endpoints if discoverable
* Next.js data payloads
* page source
* JSON data
* JavaScript-generated content
* tables
* tabs
* sections
* dynamic content

IMPORTANT:

Do not assume that browser scraping is automatically required.

First determine whether the DSE Next.js application exposes structured data through:

* public API endpoints
* JSON payloads
* Next.js server data
* page source
* embedded JSON
* network requests

If a stable structured endpoint exists and is publicly accessible, prefer consuming that endpoint over fragile DOM scraping.

However, keep browser/DOM extraction as a fallback.

---

# 8. Scraping Strategy

Implement a layered extraction strategy.

Priority:

```text
Strategy 1:
Structured DSE API/data endpoint

        ↓ if unavailable

Strategy 2:
Next.js embedded/server data

        ↓ if unavailable

Strategy 3:
Rendered HTML parsing

        ↓ if unavailable

Strategy 4:
Headless browser / Playwright

        ↓ if extraction fails

Strategy 5:
Agentic recovery
```

Do not immediately use Playwright for everything.

The goal is reliability and efficiency.

---

# 9. Browser Tool

Use Playwright only when required.

Create a browser abstraction:

```text
BrowserTool
```

It should support:

```typescript
openPage(url)
getHtml()
getText()
getLinks()
getTables()
getJsonScripts()
getNetworkRequests()
getPageMetadata()
```

Keep Playwright isolated from business logic.

---

# 10. Agentic Workflow

Implement an explicit workflow/state machine.

Suggested state:

```typescript
interface ScrapingState {
  symbol: string;

  url: string;

  status:
    | "pending"
    | "fetching"
    | "analyzing"
    | "extracting"
    | "validating"
    | "recovering"
    | "persisting"
    | "completed"
    | "failed";

  source?: {
    url: string;
    statusCode?: number;
    fetchedAt?: Date;
  };

  pageMetadata?: unknown;

  discoveredSections?: unknown[];

  extractionStrategy?: string;

  rawData?: unknown;

  normalizedData?: unknown;

  validationResult?: ValidationResult;

  anomalies?: Anomaly[];

  recoveryAttempts: number;

  errors: WorkflowError[];

  startedAt?: Date;

  completedAt?: Date;
}
```

---

# 11. Agents

Implement the following logical agents.

## Agent 1 — Source Discovery Agent

Responsibilities:

* verify URL
* fetch DSE page
* identify available data sources
* inspect page structure
* determine whether structured data/API exists
* determine whether browser rendering is required

Output:

```json
{
  "sourceType": "api|nextjs_data|html|browser",
  "source": "...",
  "confidence": 0.95,
  "reason": "..."
}
```

---

# 12. Agent 2 — Page Analysis Agent

Responsibilities:

Analyze the fetched page/data and identify:

* company/instrument identity
* instrument metadata
* market information
* trading information
* price information
* financial information
* share information
* listing information
* historical information if available
* other meaningful sections

Do not hard-code only BATBC-specific fields.

The agent should discover sections dynamically.

Example:

```json
{
  "sections": [
    {
      "name": "instrument_information",
      "fields": []
    },
    {
      "name": "market_information",
      "fields": []
    },
    {
      "name": "financial_information",
      "fields": []
    }
  ]
}
```

---

# 13. Agent 3 — Extraction Agent

The Extraction Agent converts source data into a normalized internal representation.

It must support arbitrary DSE instruments.

Example:

```json
{
  "symbol": "BATBC",
  "instrumentName": "...",
  "category": "...",
  "sector": "...",
  "market": "...",
  "lastTradePrice": null,
  "openPrice": null,
  "highPrice": null,
  "lowPrice": null,
  "closePrice": null,
  "change": null,
  "changePercent": null,
  "volume": null,
  "turnover": null
}
```

Do NOT assume these are the only fields.

Create an extensible schema.

Unknown fields should not silently disappear.

Store them in a controlled metadata/JSON structure when appropriate.

---

# 14. Data Normalization

Normalize:

* numbers
* percentages
* dates
* currency
* null values
* whitespace
* commas
* localized formatting
* units
* textual labels

Examples:

```text
"1,245.50"
        ↓
1245.50

"5.25%"
        ↓
5.25

"N/A"
        ↓
null
```

Never convert invalid values silently.

Maintain extraction warnings.

---

# 15. Validation Agent

This is a critical part of the architecture.

Validate:

### Schema validation

* required fields
* field types
* allowed formats

### Business validation

Examples:

```text
highPrice >= lowPrice
volume >= 0
price >= 0
percentage values are within sensible ranges
symbol is not empty
```

Do not hard-code unrealistic financial assumptions.

Rules should be configurable.

### Historical validation

Compare current extracted data with previous DB data.

Example:

```text
Previous EPS:
15.23

Current EPS:
1523

Difference:
+9899%
```

Flag suspicious changes.

Do not automatically reject every large change.

Classify:

```text
normal
warning
critical
```

The decision rules should be configurable.

---

# 16. Recovery Agent

If extraction or validation fails, invoke a Recovery Agent.

Example:

```text
Extraction failed
       ↓
Analyze failure
       ↓
Determine cause
       ↓
Try alternative source
       ↓
Try alternative selector
       ↓
Try browser rendering
       ↓
Re-extract
       ↓
Validate
```

Maximum retries must be configurable.

Example:

```env
MAX_RECOVERY_ATTEMPTS=3
```

The Recovery Agent should receive:

* original source
* failed extraction result
* validation errors
* page structure
* previous strategies

It should produce a structured recovery plan.

Example:

```json
{
  "strategy": "playwright",
  "reason": "Data is client-rendered",
  "actions": [
    "wait_for_network_idle",
    "inspect_table",
    "extract_visible_rows"
  ]
}
```

Do not allow unlimited autonomous retries.

---

# 17. Persistence Agent

The Persistence Agent should only receive data that passed validation.

Flow:

```text
Raw Data
   ↓
Normalized Data
   ↓
Validation
   ↓
Persistence Agent
   ↓
DB transaction
```

It should perform:

* insert
* update
* upsert
* duplicate detection
* transaction management
* audit logging

Never allow the LLM to directly generate arbitrary SQL for production execution.

Use repository methods.

Example:

```typescript
instrumentRepository.upsert(instrument);
marketDataRepository.upsert(marketData);
```

---

# 18. Database Design

Use MySQL.

Design tables with future PostgreSQL migration in mind.

At minimum consider:

```text
instruments
instrument_market_data
instrument_financial_data
instrument_listing_data
scraping_runs
scraping_errors
scraping_anomalies
scraping_snapshots
```

Do not create an unnecessarily complicated schema before understanding the actual DSE data.

The schema should support:

* instrument symbol
* instrument name
* metadata
* market data
* timestamps
* source URL
* scraping run
* extraction strategy
* validation status
* raw/normalized data where appropriate

Use migrations.

---

# 19. Raw Data Storage

For debugging and recovery, preserve the original source data where practical.

For example:

```text
scraping_snapshots
```

can contain:

```text
id
scraping_run_id
symbol
source_url
source_type
raw_payload
created_at
```

This allows the system to investigate failures later without necessarily hitting DSE again.

Be careful with storage size.

Use configurable retention.

---

# 20. Scraping Run

Every execution must have a run ID.

Example:

```text
SCRAPE-2026-09-27-000001
```

Record:

```text
run_id
symbol
url
started_at
completed_at
status
strategy
recovery_attempts
records_created
records_updated
warnings
errors
```

---

# 21. Idempotency

Running:

```text
BATBC
```

multiple times must not create duplicate instrument records.

Implement idempotent operations.

Example:

```text
symbol = BATBC
```

should uniquely identify the instrument.

Use database constraints.

---

# 22. Observability

Create structured logs.

Example:

```json
{
  "timestamp": "...",
  "runId": "...",
  "symbol": "BATBC",
  "agent": "validation-agent",
  "event": "validation_failed",
  "errors": [
    "missing lastTradePrice"
  ]
}
```

Support log levels:

```text
DEBUG
INFO
WARN
ERROR
```

Never log:

* API keys
* database passwords
* secrets

---

# 23. CLI

Create a CLI.

Example:

```bash
npm run scrape -- BATBC
```

Also support:

```bash
npm run scrape -- GP
npm run scrape -- SQURPHARMA
```

And eventually:

```bash
npm run scrape:all
```

Provide options such as:

```bash
npm run scrape -- BATBC --force
npm run scrape -- BATBC --debug
npm run scrape -- BATBC --no-browser
```

Document the CLI.

---

# 24. API

Create an HTTP API.

Example:

```http
POST /api/scrape/instrument
```

Request:

```json
{
  "symbol": "BATBC"
}
```

Response:

```json
{
  "runId": "...",
  "symbol": "BATBC",
  "status": "completed",
  "recordsCreated": 1,
  "recordsUpdated": 5,
  "warnings": []
}
```

Also provide:

```http
GET /api/scrape/runs/:runId
GET /api/instruments/:symbol
GET /api/health
```

---

# 25. Scheduler

Design the system so scheduled scraping can be added.

Do not necessarily implement a distributed scheduler in the MVP.

Create an abstraction:

```text
ScrapingScheduler
```

The system should eventually support:

```text
Every 5 minutes
Every 15 minutes
Daily
On demand
```

---

# 26. Agent State Persistence

Agent state should not exist only in memory.

For important scraping runs, persist workflow state.

This allows:

```text
process crashes
     ↓
restart
     ↓
resume/recover
```

At minimum persist:

* run ID
* current state
* current strategy
* recovery attempts
* errors
* extracted data
* validation results

---

# 27. Human-in-the-loop

Do not make every anomaly automatically accepted.

Support a future human approval state:

```text
VALIDATION_WARNING
        ↓
HUMAN_REVIEW_REQUIRED
        ↓
APPROVED / REJECTED
```

For MVP, expose the state through API/logs but don't necessarily build a full admin UI.

---

# 28. Security

Follow secure coding practices.

Never:

* hard-code credentials
* expose DB credentials
* expose LLM keys
* execute arbitrary SQL from LLM output
* execute arbitrary shell commands generated by an LLM
* trust arbitrary URLs without validation

Use environment variables.

Provide:

```text
.env.example
```

---

# 29. Rate Limiting / Respectful Scraping

Do not aggressively scrape DSE.

Implement:

* configurable delay
* retry with exponential backoff
* timeout
* concurrency limit
* HTTP error handling
* 429 handling
* 5xx handling

Example:

```env
REQUEST_TIMEOUT_MS=15000
MAX_RETRIES=3
REQUEST_DELAY_MS=1000
MAX_CONCURRENCY=3
```

Do not implement mechanisms intended to bypass anti-bot/security controls.

---

# 30. Project Structure

Use a clean architecture.

Suggested structure:

```text
dse-agentic-scraper/
│
├── src/
│   ├── agents/
│   │   ├── orchestrator/
│   │   ├── source-discovery/
│   │   ├── page-analysis/
│   │   ├── extraction/
│   │   ├── validation/
│   │   ├── recovery/
│   │   └── persistence/
│   │
│   ├── tools/
│   │   ├── http/
│   │   ├── browser/
│   │   ├── html/
│   │   ├── dse/
│   │   └── database/
│   │
│   ├── workflow/
│   │   ├── state/
│   │   ├── steps/
│   │   └── workflow.ts
│   │
│   ├── providers/
│   │   └── llm/
│   │
│   ├── extraction/
│   │   ├── strategies/
│   │   ├── normalizers/
│   │   └── schemas/
│   │
│   ├── validation/
│   │
│   ├── repositories/
│   │
│   ├── database/
│   │   ├── migrations/
│   │   └── schema/
│   │
│   ├── api/
│   │
│   ├── cli/
│   │
│   ├── config/
│   │
│   ├── logging/
│   │
│   └── app.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docs/
│
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
├── TECHNICAL.md
└── docker-compose.yml
```

You may improve this structure if you have a better architecture, but document the reasoning.

---

# 31. Testing

Testing is mandatory.

Create tests for:

### Unit tests

* normalizers
* validators
* parsers
* extraction strategies
* database repositories

### Integration tests

* DSE fetch
* workflow execution
* DB persistence

### Agent tests

Test scenarios such as:

```text
1. Normal DSE page
2. Missing field
3. Changed HTML
4. API unavailable
5. Client-side rendering
6. Invalid numeric value
7. Unexpected table structure
8. DSE timeout
9. HTTP 429
10. Historical anomaly
```

Use saved fixtures whenever possible.

Do not make the entire test suite dependent on live DSE availability.

---

# 32. Mock DSE Pages

Create fixtures representing different DSE layouts.

For example:

```text
tests/fixtures/dse/
    batbc-normal.html
    batbc-layout-v2.html
    batbc-missing-field.html
    batbc-client-rendered.html
```

Use these to test recovery.

---

# 33. Agent Guardrails

Every agent must return structured output.

Do not rely on free-form text when machine-readable output is possible.

Use JSON schemas.

Example:

```typescript
type ExtractionResult = {
  success: boolean;
  strategy: string;
  data: unknown;
  warnings: string[];
  errors: string[];
};
```

LLM output must be validated before entering the next workflow step.

---

# 34. Agent Prompt Design

Keep agent prompts in separate files.

For example:

```text
src/agents/prompts/
    source-discovery.md
    page-analysis.md
    extraction.md
    validation.md
    recovery.md
```

Do not bury giant prompts inside TypeScript files.

---

# 35. Avoid Hallucination

This is extremely important.

The LLM must NEVER invent DSE data.

Every extracted value must have provenance.

For example:

```json
{
  "field": "lastTradePrice",
  "value": 123.45,
  "source": {
    "type": "html",
    "selector": "...",
    "text": "123.45"
  }
}
```

If a value cannot be found:

```json
{
  "field": "lastTradePrice",
  "value": null,
  "status": "not_found"
}
```

Never ask the LLM to guess.

---

# 36. Provenance

Every extracted field should ideally have:

```text
field
value
source
strategy
timestamp
confidence
```

Example:

```json
{
  "field": "sector",
  "value": "Tobacco",
  "source": "DSE page",
  "strategy": "nextjs-data",
  "confidence": 0.99
}
```

---

# 37. Schema Evolution

The DSE website will change.

Design the extraction system so that:

```text
DSE Layout V1
DSE Layout V2
DSE Layout V3
```

can coexist if necessary.

Avoid scattering selectors throughout the code.

Create extraction strategies/adapters.

Example:

```text
strategies/
    dse-api.strategy.ts
    nextjs-data.strategy.ts
    html.strategy.ts
    playwright.strategy.ts
```

---

# 38. Important: Do not over-agentify deterministic work

Do not create an LLM agent for:

```text
HTTP GET
SQL INSERT
JSON.parse()
number conversion
date parsing
schema validation
```

Those must remain deterministic.

The agentic layer should primarily handle:

```text
planning
source selection
schema interpretation
failure diagnosis
recovery
anomaly reasoning
```

---

# 39. Human Documentation

Create a comprehensive:

```text
README.md
```

The README is for developers/operators.

It must contain:

1. Project overview
2. Architecture
3. Features
4. Prerequisites
5. Installation
6. Environment configuration
7. MySQL setup
8. Database migrations
9. LLM configuration
10. Running the application
11. CLI usage
12. API usage
13. Scraping examples
14. Troubleshooting
15. Testing
16. Production deployment
17. Configuration
18. Security
19. Rate limiting
20. Limitations
21. Future improvements

Include architecture diagrams using Mermaid.

Example:

```mermaid
flowchart TD
    User --> Orchestrator
    Orchestrator --> SourceAgent
    SourceAgent --> FetchTool
    SourceAgent --> PageAnalysisAgent
    PageAnalysisAgent --> ExtractionAgent
    ExtractionAgent --> ValidationAgent
    ValidationAgent --> RecoveryAgent
    ValidationAgent --> PersistenceAgent
    PersistenceAgent --> MySQL
```

---

# 40. AI Technical Documentation

Create:

```text
TECHNICAL.md
```

This document is specifically for future AI coding agents.

It must explain:

## Architecture

* directory structure
* responsibilities
* dependencies
* workflow

## Agent contracts

For every agent explain:

```text
Input
Output
Tools
Responsibilities
Failure modes
Retry behavior
Guardrails
```

## Tool contracts

Document every tool.

Example:

```text
fetchDsePage(symbol)

Input:
symbol: string

Output:
PageFetchResult

Failure:
DseFetchError

Side effects:
none
```

## Workflow State

Document every state field.

## Database

Document:

* tables
* relationships
* indexes
* unique constraints
* migrations

## Extraction

Document:

* extraction strategies
* strategy priority
* fallback behavior
* provenance

## Recovery

Document:

* recovery conditions
* retry limits
* strategy selection
* failure handling

## LLM

Document:

* provider abstraction
* prompts
* structured output
* schemas
* hallucination prevention
* token considerations

## Coding conventions

Explain:

* naming
* error handling
* logging
* testing
* dependency rules

## Extension Guide

Explain exactly how a future developer/AI should add:

* a new DSE field
* a new extraction strategy
* a new agent
* a new LLM provider
* a new database
* a new validation rule

## AI Modification Rules

Include a section:

```text
Rules for AI Coding Agents
```

with rules such as:

* Do not bypass validation
* Do not write arbitrary SQL from LLM output
* Do not remove provenance
* Do not remove audit logging
* Do not hard-code secrets
* Do not replace deterministic extraction with LLM reasoning without justification
* Add tests for behavior changes
* Update TECHNICAL.md when architecture changes
* Update README.md when user-facing behavior changes

````

---

# 41. Developer Experience

Provide:

```bash
npm install
npm run dev
npm run build
npm run start
npm test
npm run lint
npm run typecheck
npm run db:migrate
npm run scrape -- BATBC
````

Make sure all commands actually work.

---

# 42. Docker

Provide:

```text
docker-compose.yml
```

for:

```text
Node.js application
MySQL
```

Do not containerize Playwright unnecessarily if it complicates local development, but document how to run it correctly.

---

# 43. Environment

Create:

```text
.env.example
```

Include:

```env
NODE_ENV=development

PORT=3000

DATABASE_URL=mysql://user:password@localhost:3306/dse_agentic

LLM_PROVIDER=
LLM_MODEL=
LLM_API_KEY=

DSE_BASE_URL=https://dse.com.bd

REQUEST_TIMEOUT_MS=15000
REQUEST_DELAY_MS=1000
MAX_RETRIES=3
MAX_RECOVERY_ATTEMPTS=3
MAX_CONCURRENCY=3

LOG_LEVEL=info
```

Do not put real credentials anywhere.

---

# 44. Initial MVP

The first working MVP MUST support:

```text
Input:
BATBC

↓

Fetch:
https://dse.com.bd/company/BATBC

↓

Discover source

↓

Extract available instrument/company data

↓

Normalize

↓

Validate

↓

Persist to MySQL

↓

Create scraping run

↓

Return structured result
```

Then verify the system with at least:

```text
BATBC
GP
SQURPHARMA
```

Do not assume these symbols necessarily have identical page structures.

---

# 45. Final Deliverables

At the end, the repository must contain:

```text
✓ Working Node.js/TypeScript application
✓ Agentic workflow
✓ DSE source discovery
✓ DSE data extraction
✓ Multiple extraction strategies
✓ Next.js-aware extraction
✓ Playwright fallback
✓ Data normalization
✓ Validation agent
✓ Recovery agent
✓ MySQL persistence
✓ Repository abstraction
✓ PostgreSQL migration-friendly architecture
✓ CLI
✓ REST API
✓ Logging
✓ Scraping runs
✓ Audit information
✓ Tests
✓ DSE fixtures
✓ Docker configuration
✓ .env.example
✓ README.md
✓ TECHNICAL.md
```

---

# 46. Development Process

Do NOT generate the entire project blindly in one step.

Work incrementally.

### Phase 1

Inspect the DSE website and determine the actual data architecture.

Do not guess.

Document findings.

### Phase 2

Create project architecture and database schema.

### Phase 3

Implement deterministic DSE fetching and source discovery.

### Phase 4

Implement extraction strategies.

### Phase 5

Implement agent orchestration.

### Phase 6

Implement validation.

### Phase 7

Implement recovery.

### Phase 8

Implement persistence.

### Phase 9

Implement API and CLI.

### Phase 10

Implement tests.

### Phase 11

Complete README.md and TECHNICAL.md.

After each phase:

* run tests
* run type checking
* fix errors
* review architecture
* update documentation

Do not move forward with known failing tests unless the failure is explicitly documented.

---

# 47. Critical Requirement

Before writing extraction selectors or assuming the page structure, inspect the current DSE Next.js application and determine how the actual data reaches the browser.

The architecture should prefer:

```text
structured API/data
        >
Next.js data
        >
HTML
        >
Playwright
```

where technically possible.

The agentic workflow must be capable of adapting when the DSE page layout changes.

The goal is NOT:

> "Build a scraper that works for BATBC today."

The goal is:

> "Build an agentic DSE instrument data ingestion platform that can discover, extract, validate, recover from layout changes, and persist instrument data reliably."

---

# 48. Start Now

Start by inspecting:

https://dse.com.bd/company/BATBC

Determine the actual technical architecture of the page.

Then create the project.

Do not fabricate fields or API endpoints.

If the DSE website cannot be accessed during development, clearly document that limitation and build the extraction layer using fixtures/mocks while keeping the real DSE integration isolated.

At every stage prefer verifiable evidence over assumptions.

Begin implementation now.
