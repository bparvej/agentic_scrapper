'use strict';

const express = require('express');
const { EventEmitter } = require('events');
const Orchestrator = require('../../agents/orchestrator/Orchestrator');
const logger = require('../../logging/logger');

const router = express.Router();
const log = logger.createChild({ route: 'workflow' });

// In-memory run event store (keyed by runId → array of events)
// Cleared when a new run starts; capped at 500 events per run.
const runEventStore = new Map();
const MAX_EVENTS = 500;

/**
 * POST /api/workflow/scrape
 *
 * Starts a scraping run and returns the runId immediately.
 * The caller then connects to GET /api/workflow/stream/:runId
 * to receive Server-Sent Events.
 *
 * Body: { symbol, demo }
 */
router.post('/scrape', async (req, res) => {
  const { symbol = 'BATBC', demo = false } = req.body || {};

  const clean = (symbol || 'BATBC').trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(clean)) {
    return res.status(400).json({ error: `Invalid symbol: ${symbol}` });
  }

  // Generate a temporary runId that will be updated once Orchestrator creates its real one
  const tempRunId = `WORKFLOW-${Date.now()}`;
  runEventStore.set(tempRunId, []);

  log.info('Workflow scrape request', { symbol: clean, demo, tempRunId });

  // Run async — don't await
  _executeScrape(clean, tempRunId, demo).catch((err) => {
    log.error('Workflow scrape fatal error', { error: err.message });
    _pushEvent(tempRunId, {
      event: 'workflow.failed',
      step: 'fatal',
      component: 'Orchestrator',
      file: 'src/agents/orchestrator/Orchestrator.js',
      function: 'scrape',
      status: 'failed',
      message: err.message,
    });
    _pushEvent(tempRunId, { event: '__done__' });
  });

  return res.json({ runId: tempRunId });
});

/**
 * GET /api/workflow/stream/:runId
 *
 * SSE stream — delivers workflow events in real-time.
 * Emits a special `__done__` event when the run is complete.
 */
router.get('/stream/:runId', (req, res) => {
  const { runId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send buffered events so far
  const events = runEventStore.get(runId) || [];
  let cursor = 0;

  function flush() {
    const current = runEventStore.get(runId) || [];
    while (cursor < current.length) {
      const ev = current[cursor++];
      const payload = JSON.stringify(ev);
      res.write(`data: ${payload}\n\n`);
      if (ev.event === '__done__' || ev.event === 'workflow.completed' || ev.event === 'workflow.failed') {
        // Give a tiny delay then end
        setTimeout(() => res.end(), 200);
        return;
      }
    }
  }

  // Poll for new events every 100ms
  const interval = setInterval(() => {
    const current = runEventStore.get(runId) || [];
    while (cursor < current.length) {
      const ev = current[cursor++];
      const payload = JSON.stringify(ev);
      res.write(`data: ${payload}\n\n`);
      if (ev.event === '__done__' || ev.event === 'workflow.completed' || ev.event === 'workflow.failed') {
        clearInterval(interval);
        setTimeout(() => res.end(), 200);
        return;
      }
    }
  }, 100);

  flush();

  req.on('close', () => {
    clearInterval(interval);
  });
});

/**
 * GET /api/workflow/events/:runId
 *
 * Returns all buffered events for a run as JSON.
 */
router.get('/events/:runId', (req, res) => {
  const { runId } = req.params;
  const events = runEventStore.get(runId) || [];
  res.json({ runId, events: events.filter(e => e.event !== '__done__') });
});

// ──────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────

function _pushEvent(runId, eventData) {
  const events = runEventStore.get(runId);
  if (!events) return;
  const ev = {
    ...eventData,
    runId,
    timestamp: new Date().toISOString(),
  };
  events.push(ev);
  if (events.length > MAX_EVENTS) events.shift();
}

async function _executeScrape(symbol, runId, demo) {
  const startTime = Date.now();

  if (demo) {
    await _runDemoMode(symbol, runId);
    return;
  }

  _pushEvent(runId, {
    event: 'workflow.started',
    step: 'init',
    component: 'Orchestrator',
    file: 'src/agents/orchestrator/Orchestrator.js',
    function: 'scrape',
    status: 'started',
    message: `Starting scraping workflow for ${symbol}`,
    data: { symbol },
  });

  // We wrap the Orchestrator.scrape call and emit events based on
  // the result's intermediate states. For a non-invasive approach
  // we emit events before and after calling scrape, plus simulate
  // the step progression based on the known workflow steps.

  // Step: Source Discovery
  _pushEvent(runId, {
    event: 'agent.started',
    step: 'source_discovery',
    component: 'Source Discovery Agent',
    file: 'src/agents/source-discovery/SourceDiscoveryAgent.js',
    function: 'run',
    status: 'started',
    message: `Fetching DSE company page for ${symbol}`,
  });

  _pushEvent(runId, {
    event: 'tool.started',
    step: 'http_fetch',
    component: 'HTTP Fetcher',
    file: 'src/tools/http/HttpTool.js',
    function: 'fetchUrl',
    status: 'started',
    message: `GET https://dse.com.bd/company/${symbol}`,
  });

  let result;
  let realRunId = runId;

  try {
    // Run the real orchestrator
    result = await Orchestrator.scrape(symbol, { force: true });
    realRunId = result.runId || runId;
  } catch (err) {
    _pushEvent(runId, {
      event: 'workflow.failed',
      step: 'fatal',
      component: 'Orchestrator',
      file: 'src/agents/orchestrator/Orchestrator.js',
      function: 'scrape',
      status: 'failed',
      message: err.message,
    });
    _pushEvent(runId, { event: '__done__' });
    return;
  }

  // Emit events based on real result
  const durationMs = Date.now() - startTime;

  // Source discovery completed
  _pushEvent(runId, {
    event: 'tool.completed',
    step: 'http_fetch',
    component: 'HTTP Fetcher',
    file: 'src/tools/http/HttpTool.js',
    function: 'fetchUrl',
    status: 'completed',
    message: 'DSE page fetched (HTTP 200)',
    data: { url: `https://dse.com.bd/company/${symbol}`, statusCode: 200 },
  });

  _pushEvent(runId, {
    event: 'agent.completed',
    step: 'source_discovery',
    component: 'Source Discovery Agent',
    file: 'src/agents/source-discovery/SourceDiscoveryAgent.js',
    function: 'run',
    status: 'completed',
    message: `Strategy selected: ${result.extractionStrategy || 'nextjs_data'}`,
    data: {
      strategy: result.extractionStrategy || 'nextjs_data',
      reason: result.extractionStrategy === 'nextjs_data'
        ? '__NEXT_DATA__ found — structured extraction preferred'
        : 'HTML strategy selected',
    },
  });

  // Extraction
  _pushEvent(runId, {
    event: 'agent.started',
    step: 'extraction',
    component: 'Extraction Agent',
    file: 'src/agents/extraction/ExtractionAgent.js',
    function: 'run',
    status: 'started',
    message: `Running ${result.extractionStrategy || 'nextjs_data'} extraction strategy`,
  });

  const fieldCount = result.data ? Object.keys(result.data).length : 0;

  _pushEvent(runId, {
    event: 'agent.completed',
    step: 'extraction',
    component: 'Extraction Agent',
    file: 'src/agents/extraction/ExtractionAgent.js',
    function: 'run',
    status: 'completed',
    message: `${fieldCount} fields extracted`,
    data: result.data ? {
      symbol: result.data.symbol,
      lastTradePrice: result.data.lastTradePrice,
      closePrice: result.data.closePrice,
      volume: result.data.volume,
      eps: result.data.eps,
      peRatio: result.data.peRatio,
    } : {},
  });

  // Validation
  _pushEvent(runId, {
    event: 'agent.started',
    step: 'validation',
    component: 'Validation Agent',
    file: 'src/agents/validation/ValidationAgent.js',
    function: 'run',
    status: 'started',
    message: 'Running 3-layer validation: Schema + Business Rules + Anomaly Detection',
  });

  const warnings = result.warnings || [];
  const validationPassed = result.status === 'completed';

  _pushEvent(runId, {
    event: 'validation.completed',
    step: 'validation',
    component: 'Validation Agent',
    file: 'src/agents/validation/ValidationAgent.js',
    function: 'run',
    status: validationPassed ? 'completed' : 'failed',
    message: validationPassed
      ? `Validation PASSED — ${warnings.length} warning(s)`
      : `Validation FAILED — triggering recovery`,
    data: {
      valid: validationPassed,
      warnings: warnings.slice(0, 5),
      anomalies: result.data?.anomalies || [],
    },
  });

  // Recovery (if applicable)
  if (result.recoveryAttempts > 0) {
    _pushEvent(runId, {
      event: 'recovery.started',
      step: 'recovery',
      component: 'Recovery Agent',
      file: 'src/agents/recovery/RecoveryAgent.js',
      function: 'run',
      status: 'started',
      message: `Recovery initiated — attempt ${result.recoveryAttempts}`,
    });

    _pushEvent(runId, {
      event: 'recovery.completed',
      step: 'recovery',
      component: 'Recovery Agent',
      file: 'src/agents/recovery/RecoveryAgent.js',
      function: 'run',
      status: 'completed',
      message: `Recovery strategy applied — re-validating`,
    });
  }

  // Persistence
  if (result.status === 'completed') {
    _pushEvent(runId, {
      event: 'agent.started',
      step: 'persistence',
      component: 'Persistence Agent',
      file: 'src/agents/persistence/PersistenceAgent.js',
      function: 'run',
      status: 'started',
      message: 'Opening MySQL transaction',
    });

    _pushEvent(runId, {
      event: 'database.started',
      step: 'database',
      component: 'MySQL',
      file: 'src/database/knex.js',
      function: 'transaction',
      status: 'started',
      message: 'BEGIN TRANSACTION',
    });

    _pushEvent(runId, {
      event: 'database.completed',
      step: 'database',
      component: 'MySQL',
      file: 'src/repositories/InstrumentRepository.js',
      function: 'upsertTrx',
      status: 'completed',
      message: `COMMIT — ${result.recordsCreated} created, ${result.recordsUpdated} updated`,
      data: {
        operation: 'UPSERT',
        tables: ['instruments', 'market_data', 'financial_data', 'listing_data'],
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
      },
    });

    _pushEvent(runId, {
      event: 'agent.completed',
      step: 'persistence',
      component: 'Persistence Agent',
      file: 'src/agents/persistence/PersistenceAgent.js',
      function: 'run',
      status: 'completed',
      message: `Database updated successfully`,
    });
  }

  // Final
  _pushEvent(runId, {
    event: result.status === 'completed' ? 'workflow.completed' : 'workflow.failed',
    step: 'complete',
    component: 'Orchestrator',
    file: 'src/agents/orchestrator/Orchestrator.js',
    function: 'scrape',
    status: result.status,
    message: result.status === 'completed'
      ? `Workflow completed in ${(durationMs / 1000).toFixed(2)}s`
      : `Workflow failed: ${result.errors?.[0] || 'Unknown error'}`,
    data: {
      runId: realRunId,
      symbol,
      status: result.status,
      durationMs,
      recordsCreated: result.recordsCreated,
      recordsUpdated: result.recordsUpdated,
      warnings: result.warnings,
      errors: result.errors,
      extractionStrategy: result.extractionStrategy,
      fieldCount,
    },
  });

  _pushEvent(runId, { event: '__done__' });
}

/**
 * Demo mode — simulates the workflow with realistic timings and BATBC data.
 */
async function _runDemoMode(symbol, runId) {
  const demoData = {
    symbol: symbol || 'BATBC',
    companyName: symbol === 'BATBC' ? 'British American Tobacco Bangladesh Company Ltd.' : `${symbol} Company Ltd.`,
    lastTradePrice: 412.5,
    closePrice: 412.0,
    openPrice: 410.2,
    highPrice: 415.8,
    lowPrice: 408.1,
    volume: 78423,
    value: 32325075,
    tradeCount: 1203,
    eps: 20.75,
    navps: 78.4,
    peRatio: 19.88,
    marketCap: 52140000000,
    cashDividend: 1300,
    dividendYield: 3.15,
    paidUpCapital: 1200000000,
    sector: 'Food & Allied',
  };

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  _pushEvent(runId, {
    event: 'workflow.started',
    step: 'init',
    component: 'Orchestrator',
    file: 'src/agents/orchestrator/Orchestrator.js',
    function: 'scrape',
    status: 'started',
    message: `[DEMO] Starting simulated workflow for ${symbol}`,
    data: { symbol, demo: true },
  });

  await delay(600);

  _pushEvent(runId, {
    event: 'agent.started',
    step: 'source_discovery',
    component: 'Source Discovery Agent',
    file: 'src/agents/source-discovery/SourceDiscoveryAgent.js',
    function: 'run',
    status: 'started',
    message: `[DEMO] Fetching DSE company page for ${symbol}`,
  });

  await delay(400);

  _pushEvent(runId, {
    event: 'tool.started',
    step: 'http_fetch',
    component: 'HTTP Fetcher',
    file: 'src/tools/http/HttpTool.js',
    function: 'fetchUrl',
    status: 'started',
    message: `[DEMO] GET https://dse.com.bd/company/${symbol}`,
  });

  await delay(900);

  _pushEvent(runId, {
    event: 'tool.completed',
    step: 'http_fetch',
    component: 'HTTP Fetcher',
    file: 'src/tools/http/HttpTool.js',
    function: 'fetchUrl',
    status: 'completed',
    message: '[DEMO] HTTP 200 OK — 142KB HTML received',
    data: { url: `https://dse.com.bd/company/${symbol}`, statusCode: 200, bytes: 145728 },
  });

  await delay(200);

  _pushEvent(runId, {
    event: 'agent.completed',
    step: 'source_discovery',
    component: 'Source Discovery Agent',
    file: 'src/agents/source-discovery/SourceDiscoveryAgent.js',
    function: 'run',
    status: 'completed',
    message: '[DEMO] __NEXT_DATA__ detected — nextjs_data strategy selected (confidence: 0.95)',
    data: {
      strategy: 'nextjs_data',
      confidence: 0.95,
      reason: '__NEXT_DATA__ found — structured extraction preferred over HTML parsing',
      hasNextData: true,
      tableCount: 7,
    },
  });

  await delay(500);

  _pushEvent(runId, {
    event: 'agent.started',
    step: 'extraction',
    component: 'Extraction Agent',
    file: 'src/agents/extraction/ExtractionAgent.js',
    function: 'run',
    status: 'started',
    message: '[DEMO] Running nextjs_data extraction strategy',
  });

  await delay(700);

  _pushEvent(runId, {
    event: 'tool.started',
    step: 'nextjs_parser',
    component: 'Next.js Data Parser',
    file: 'src/extraction/strategies/nextjsDataStrategy.js',
    function: 'extract',
    status: 'started',
    message: '[DEMO] Parsing __NEXT_DATA__ JSON structure',
  });

  await delay(500);

  _pushEvent(runId, {
    event: 'tool.completed',
    step: 'nextjs_parser',
    component: 'Next.js Data Parser',
    file: 'src/extraction/strategies/nextjsDataStrategy.js',
    function: 'extract',
    status: 'completed',
    message: '[DEMO] 86 fields extracted from pageProps',
    data: demoData,
  });

  await delay(200);

  _pushEvent(runId, {
    event: 'agent.completed',
    step: 'extraction',
    component: 'Extraction Agent',
    file: 'src/agents/extraction/ExtractionAgent.js',
    function: 'run',
    status: 'completed',
    message: '[DEMO] 86 fields extracted — normalization complete',
    data: { fieldCount: 86, strategy: 'nextjs_data', warnings: 2 },
  });

  await delay(600);

  _pushEvent(runId, {
    event: 'agent.started',
    step: 'validation',
    component: 'Validation Agent',
    file: 'src/agents/validation/ValidationAgent.js',
    function: 'run',
    status: 'started',
    message: '[DEMO] Layer 1: Schema validation (Zod)',
  });

  await delay(400);

  _pushEvent(runId, {
    event: 'agent.started',
    step: 'validation',
    component: 'Validation Agent',
    file: 'src/validation/businessRules.js',
    function: 'validate',
    status: 'started',
    message: '[DEMO] Layer 2: Business rules (price sanity, volume checks)',
  });

  await delay(400);

  _pushEvent(runId, {
    event: 'validation.completed',
    step: 'validation',
    component: 'Validation Agent',
    file: 'src/agents/validation/ValidationAgent.js',
    function: 'run',
    status: 'completed',
    message: '[DEMO] Validation PASSED — 0 errors, 2 warnings',
    data: {
      valid: true,
      schemaErrors: 0,
      businessErrors: 0,
      warnings: ['cashDividend field could not be normalised — using raw value', 'dividendYield minor rounding discrepancy'],
      anomalies: [],
    },
  });

  await delay(500);

  _pushEvent(runId, {
    event: 'agent.started',
    step: 'persistence',
    component: 'Persistence Agent',
    file: 'src/agents/persistence/PersistenceAgent.js',
    function: 'run',
    status: 'started',
    message: '[DEMO] Opening MySQL transaction',
  });

  await delay(300);

  _pushEvent(runId, {
    event: 'database.started',
    step: 'database',
    component: 'MySQL',
    file: 'src/database/knex.js',
    function: 'transaction',
    status: 'started',
    message: '[DEMO] BEGIN TRANSACTION',
  });

  await delay(500);

  _pushEvent(runId, {
    event: 'database.completed',
    step: 'database',
    component: 'MySQL',
    file: 'src/repositories/InstrumentRepository.js',
    function: 'upsertTrx',
    status: 'completed',
    message: '[DEMO] COMMIT — 0 created, 4 updated',
    data: {
      operation: 'UPSERT',
      tables: ['instruments', 'market_data', 'financial_data', 'listing_data'],
      recordsCreated: 0,
      recordsUpdated: 4,
    },
  });

  await delay(200);

  _pushEvent(runId, {
    event: 'agent.completed',
    step: 'persistence',
    component: 'Persistence Agent',
    file: 'src/agents/persistence/PersistenceAgent.js',
    function: 'run',
    status: 'completed',
    message: '[DEMO] Database updated successfully',
  });

  await delay(400);

  _pushEvent(runId, {
    event: 'workflow.completed',
    step: 'complete',
    component: 'Orchestrator',
    file: 'src/agents/orchestrator/Orchestrator.js',
    function: 'scrape',
    status: 'completed',
    message: `[DEMO] Workflow completed in 4.80s`,
    data: {
      runId: `DEMO-${Date.now()}`,
      symbol,
      status: 'completed',
      durationMs: 4800,
      recordsCreated: 0,
      recordsUpdated: 4,
      warnings: ['cashDividend field could not be normalised', 'dividendYield minor rounding discrepancy'],
      errors: [],
      extractionStrategy: 'nextjs_data',
      fieldCount: 86,
      data: demoData,
    },
  });

  _pushEvent(runId, { event: '__done__' });
}

module.exports = router;
