'use strict';

const express = require('express');
const config = require('./config');
const logger = require('./logging/logger');
const errorHandler = require('./api/middleware/errorHandler');

const scrapeRoutes = require('./api/routes/scrape');
const instrumentRoutes = require('./api/routes/instruments');
const healthRoutes = require('./api/routes/health');

const log = logger.createChild({ module: 'app' });

/**
 * Bootstrap the Express application.
 */
function createApp() {
  const app = express();

  // Parse JSON bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Request logging
  app.use((req, res, next) => {
    log.debug(`${req.method} ${req.url}`);
    next();
  });

  // Routes
  app.use('/api/scrape', scrapeRoutes);
  app.use('/api/instruments', instrumentRoutes);
  app.use('/api/health', healthRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use(errorHandler);

  return app;
}

/**
 * Start the HTTP server.
 */
async function main() {
  // Validate config and print warnings
  const warnings = config.validate();
  for (const w of warnings) {
    log.warn(`Config warning: ${w}`);
  }

  const app = createApp();
  const port = config.port;

  app.listen(port, () => {
    log.info(`DSE Agentic Scraper started`, {
      port,
      env: config.env,
      llmProvider: config.llm.provider,
    });
  });
}

// Only run server when executed directly, not when required in tests
if (require.main === module) {
  main().catch((err) => {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  });
}

module.exports = { createApp };
