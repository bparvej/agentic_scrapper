# Developer Guide — DSE Agentic Scraper

Welcome! This guide walks you through everything you need to know to run,
understand, and contribute to this project — whether you are a seasoned
Node.js developer or building your first backend application.

---

## Who Is This Guide For?

- **New developers** who want to understand what the project does and how to run it
- **Experienced developers** who want to jump straight into the code
- **Non-technical operators** who want to run the scraper without understanding every detail

We will start simple and go deeper as we go.

---

## Part 1 — What Does This Project Do?

This project automatically collects company/instrument data from the
Dhaka Stock Exchange (DSE) website (`dse.com.bd`) and stores it in a database.

Instead of a simple script that grabs data once, it uses an **agentic workflow** —
a chain of intelligent steps that can:

- Decide how to best extract the data
- Validate what was extracted
- Recover from failures automatically
- Store a complete audit trail

Think of it as a smart, self-healing data pipeline for stock market data.

### What data does it collect?

For each DSE company (e.g. `BATBC`, `GP`, `SQURPHARMA`) it collects:

- Company name, sector, trading code, ISIN
- Price data: last traded price, open, high, low, close
- Volume and turnover
- Market capitalisation, paid-up capital, face value
- EPS, NAVPS, P/E ratio
- Dividends, AGM dates
- Ownership percentages

---

## Part 2 — Prerequisites

Before running anything, you need:

### 1. Node.js (version 20 or newer)

Node.js is the runtime that executes the JavaScript code.

**Download:** https://nodejs.org/en/download

Check if you have it:
```bash
node --version
# Should print something like: v22.19.0
```

### 2. npm (comes with Node.js)

npm is the package manager used to install libraries.

```bash
npm --version
# Should print: 9.x or higher
```

### 3. MySQL (version 8.0 or newer)

MySQL is the database where extracted data is stored.

**Download:** https://dev.mysql.com/downloads/mysql/

Or on Windows, use XAMPP (includes MySQL): https://www.apachefriends.org/

Check if MySQL is running:
```bash
mysql --version
```

### 4. Git (optional, for cloning the repo)

**Download:** https://git-scm.com/downloads

---

## Part 3 — Getting the Code

```bash
git clone <repository-url>
cd dse-agentic-scraper
```

Or download the ZIP file and extract it.

---

## Part 4 — Installing Dependencies

Dependencies are libraries the project uses (like tools in a toolbox).

```bash
npm install
```

This will download ~270 packages and put them in a `node_modules` folder.
This folder is large but is automatically ignored by Git.

**Tip:** If you see warnings during `npm install`, that is usually fine.
Only `error` messages need attention.

### Optional: Install Playwright browser

Playwright is the headless browser used as a fallback when simple
HTTP scraping does not work.

```bash
npx playwright install chromium
```

**Note for beginners:** If you skip this, the scraper still works —
it just cannot use the browser fallback strategy. For most symbols
it will find another way.

---

## Part 5 — Configuration

The project uses a `.env` file to store settings (database passwords,
API keys, etc.). This file is never committed to Git (for security).

### Step 1: Create your `.env` file

```bash
# On Mac/Linux:
cp .env.example .env

# On Windows Command Prompt:
copy .env.example .env

# On Windows PowerShell:
Copy-Item .env.example .env
```

### Step 2: Edit `.env`

Open `.env` in any text editor (Notepad, VS Code, etc.) and fill in:

```env
# Leave these as-is for development
NODE_ENV=development
PORT=3000

# Your MySQL settings
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_NAME=dse_agentic
DATABASE_USER=dse_user
DATABASE_PASSWORD=your_password_here

# LLM settings — use "mock" if you don't have an API key
LLM_PROVIDER=mock

# Leave the rest as defaults for now
DSE_BASE_URL=https://dse.com.bd
REQUEST_TIMEOUT_MS=15000
REQUEST_DELAY_MS=1000
LOG_LEVEL=info
```

> **Security tip:** Never share your `.env` file. It contains passwords.
> Never commit it to GitHub. The `.gitignore` file already prevents this.

---

## Part 6 — MySQL Setup

### Step 1: Log in to MySQL

```bash
mysql -u root -p
# Enter your MySQL root password when prompted
```

### Step 2: Create the database and user

Copy and paste these commands into the MySQL prompt:

```sql
CREATE DATABASE dse_agentic
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'dse_user'@'localhost'
  IDENTIFIED BY 'your_password_here';

GRANT ALL PRIVILEGES ON dse_agentic.*
  TO 'dse_user'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```

Replace `your_password_here` with a real password. Use the same password in your `.env` file.

### Step 3: Verify

```bash
mysql -u dse_user -p dse_agentic
# Should connect without errors
# Type EXIT to leave
```

**Tip for beginners:** If you see `Access denied`, double-check that the
password in `.env` matches what you used in `CREATE USER`.

---

## Part 7 — Run Database Migrations

Migrations create the database tables. You must run this before using the scraper.

```bash
npm run db:migrate
```

You should see output like:
```
info: Running pending migrations...
info: Ran batch 1 { migrations: [ '001_create_instruments.js', '002_create_scraping_runs.js' ] }
```

**What this does:** Creates 8 tables in your `dse_agentic` database.

---

## Part 8 — Running the Application

### Start the web server

```bash
npm start
```

You should see:
```
info: DSE Agentic Scraper started { "port": 3000, "env": "development" }
```

The API is now available at `http://localhost:3000`.

### Check it is running

Open your browser or run:
```bash
curl http://localhost:3000/api/health
```

You should see:
```json
{ "status": "ok", "services": { "database": "ok" } }
```

---

## Part 9 — Scraping Your First Instrument

### Using the CLI (command line)

In a terminal (while the server is NOT running, or in a separate terminal):

```bash
npm run scrape -- BATBC
```

This will:
1. Fetch the BATBC company page from `dse.com.bd`
2. Extract company and market data
3. Validate the data
4. Store it in your MySQL database
5. Print a summary

Expected output:
```
============================================================
  DSE Agentic Scraper — Run Summary
============================================================
  Run ID:           SCRAPE-20260928-A1B2C3D4
  Symbol:           BATBC
  Status:           completed
  Strategy:         playwright
  Records Created:  4
  Records Updated:  0
  Recovery Attempts:0
  Duration:         5.23s
============================================================
```

### Try other symbols

```bash
npm run scrape -- GP
npm run scrape -- SQURPHARMA
npm run scrape -- BEXIMCO
```

### With debug output

```bash
npm run scrape -- BATBC --debug
```

This shows every step in detail — useful for understanding what the system is doing.

---

## Part 10 — Using the API

Start the server first:
```bash
npm start
```

### Scrape via API

```bash
curl -X POST http://localhost:3000/api/scrape/instrument \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BATBC"}'
```

### Get instrument data

```bash
curl http://localhost:3000/api/instruments/BATBC
```

### Get scraping history

```bash
curl http://localhost:3000/api/scrape/history/BATBC
```

---

## Part 11 — Understanding the Output

After a successful scrape, the database contains:

| Table | What is stored |
|---|---|
| `instruments` | Company name, sector, code, category |
| `instrument_market_data` | Prices, volume, market cap |
| `instrument_financial_data` | EPS, dividends, capital structure |
| `instrument_listing_data` | Ownership percentages |
| `scraping_runs` | Run ID, status, strategy, timing |

You can view this in MySQL:
```sql
mysql -u dse_user -p dse_agentic

SELECT symbol, company_name, sector, category FROM instruments;
SELECT symbol, last_trade_price, eps, navps FROM instrument_market_data NATURAL JOIN instrument_financial_data LIMIT 10;
```

---

## Part 12 — Common Issues and Fixes

### "Cannot find module"

```bash
npm install
```

### "Access denied" to MySQL

Check that:
1. MySQL is running
2. The password in `.env` matches your database user password
3. The user has privileges on the correct database

### "All extraction strategies failed"

The DSE website may be:
- Down temporarily — wait and try again
- Rate-limiting — increase `REQUEST_DELAY_MS` in `.env`
- Requiring JavaScript — install Playwright: `npx playwright install chromium`

### "LLM_API_KEY is not set"

This is a warning, not an error. The system runs in mock mode.
If you want real LLM-powered anomaly detection and recovery, set:
```env
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
```

### Playwright install fails on Windows (proxy/firewall)

```bash
# Try setting a direct download host
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://playwright.azureedge.net"
npx playwright install chromium
```

### Tests fail with database errors

Unit tests do not need a database. If you see DB errors in unit tests,
check that the test file is under `tests/unit/` not `tests/integration/`.

---

## Part 13 — Running Tests

```bash
# All unit tests
npm test

# Specific test file
node --test tests/unit/normalizers/valueNormalizer.test.js

# With verbose output
node --test --reporter spec tests/unit/normalizers/valueNormalizer.test.js
```

Tests use saved HTML fixture files — they do NOT hit the live DSE website.
This means tests work offline and are fast.

---

## Part 14 — Project Structure (Simplified)

```
dse-agentic-scraper/
│
├── src/
│   ├── agents/           ← The "brain" — smart workflow steps
│   ├── tools/            ← Low-level utilities (HTTP, HTML, browser)
│   ├── extraction/       ← How data is pulled from DSE pages
│   ├── validation/       ← Rules that data must pass
│   ├── repositories/     ← Database read/write operations
│   ├── database/         ← Schema migrations
│   ├── api/              ← Web API endpoints
│   ├── cli/              ← Command-line interface
│   ├── config/           ← Settings (reads from .env)
│   ├── logging/          ← Structured logging
│   └── app.js            ← Application entry point
│
├── tests/
│   ├── unit/             ← Fast tests (no network, no database)
│   └── fixtures/dse/     ← Sample DSE page HTML files for testing
│
├── .env.example          ← Template for your .env file
├── .env                  ← Your local settings (never committed to Git)
├── package.json          ← Project info and dependencies
├── README.md             ← User documentation
├── TECHNICAL.md          ← Architecture for developers
└── DEVELOPER.md          ← This file
```

---

## Part 15 — How the Agentic Workflow Works

Here is what happens when you run `npm run scrape -- BATBC`:

```
1. Orchestrator starts
   Creates a ScrapingState with runId and symbol

2. Source Discovery Agent
   → Fetches https://dse.com.bd/company/BATBC
   → Checks: is there __NEXT_DATA__ JSON in the page?
   → Checks: is the page fully rendered HTML?
   → Decides: use "nextjs_data", "html", or "browser" strategy

3. Extraction Agent
   → Tries the chosen strategy
   → If it fails, tries the next one in the priority list
   → Returns normalised data (numbers, dates cleaned up)

4. Validation Agent
   → Checks the schema: are required fields present?
   → Checks business rules: is highPrice >= lowPrice?
   → Checks history: is EPS suddenly 100x bigger than last time?
   → If anomalies found, asks the LLM: is this normal, a warning, or critical?

5. Recovery Agent (only if validation fails)
   → Asks the LLM: why did this fail? what should we try instead?
   → Executes the recovery plan
   → Goes back to step 4

6. Persistence Agent
   → Saves data to MySQL in a single transaction
   → Updates the scraping_runs record

7. Summary printed to console/returned via API
```

---

## Part 16 — Quick Reference Commands

| Task | Command |
|---|---|
| Install dependencies | `npm install` |
| Start server | `npm start` |
| Start server (dev, auto-restart) | `npm run dev` |
| Run migrations | `npm run db:migrate` |
| Scrape a symbol | `npm run scrape -- BATBC` |
| Scrape with debug | `npm run scrape -- BATBC --debug` |
| Scrape all symbols | `npm run scrape:all` |
| Run tests | `npm test` |
| Health check | `curl http://localhost:3000/api/health` |

---

## Part 17 — Tips for New Developers

**Start with mock mode.** Set `LLM_PROVIDER=mock` in your `.env`.
You don't need an API key to run the full workflow.

**Read the logs.** Set `LOG_LEVEL=debug` to see exactly what every agent is doing.

**Use the fixtures.** The test fixtures in `tests/fixtures/dse/` are sample
DSE pages. You can examine `batbc-normal.html` to understand the data structure.

**Check the database.** After a successful scrape, look at the tables in MySQL.
Understanding the schema helps you understand the whole system.

**Don't scrape too fast.** The DSE website is a real, public service.
Keep `REQUEST_DELAY_MS` at 1000ms or higher. Be a good citizen.

**Ask the health endpoint.** `GET /api/health` tells you if the server
and database are both working before you try anything else.

---

## Part 18 — Getting an LLM API Key (Optional)

The LLM (Large Language Model) is used for intelligent reasoning tasks.
The system works without one (using mock mode), but with a real LLM you get:

- Better source strategy decisions
- More accurate anomaly classification
- Smarter recovery plans

### Option A: OpenAI

1. Sign up at https://platform.openai.com
2. Create an API key at https://platform.openai.com/api-keys
3. Set in `.env`:
   ```env
   LLM_PROVIDER=openai
   LLM_MODEL=gpt-4o-mini
   LLM_API_KEY=sk-...
   ```

`gpt-4o-mini` is cheap — a full day of scraping all DSE symbols costs
approximately $0.01–$0.10 USD.

### Option B: OpenRouter (access many models)

1. Sign up at https://openrouter.ai
2. Get an API key
3. Set in `.env`:
   ```env
   LLM_PROVIDER=openrouter
   LLM_MODEL=openai/gpt-4o-mini
   LLM_API_KEY=sk-or-...
   ```

---

## Part 19 — Docker Setup (Optional)

If you prefer Docker over a local MySQL installation:

### Prerequisites

- Docker Desktop: https://www.docker.com/products/docker-desktop/

### Start everything

```bash
docker compose up
```

This starts:
- A MySQL 8 container (port 3306)
- The Node.js application (port 3000)

### Run migrations inside Docker

```bash
docker compose exec app npm run db:migrate
```

### Stop everything

```bash
docker compose down
```

### Reset the database (destructive!)

```bash
docker compose down -v
docker compose up
```

---

## Part 20 — Contributing

If you want to improve the project:

1. Read `TECHNICAL.md` for the architecture rules
2. Write a test for your change
3. Run `npm test` and make sure everything passes
4. Update `README.md` or `TECHNICAL.md` if behaviour changes

The key rule: **don't break the validation pipeline**.
Data that fails validation must never reach the database.
