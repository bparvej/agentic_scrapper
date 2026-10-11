'use strict';

const express = require('express');
const router = express.Router();
const logStore = require('../../logging/logStore');
const logger = require('../../logging/logger');

const log = logger.createChild({ route: 'api/logs' });

/**
 * GET /api/logs
 * Query logs with date, level, module, search term, and pagination.
 */
router.get('/', (req, res) => {
  try {
    const { date, level, module, search, limit, offset } = req.query;
    const result = logStore.queryLogs({
      date,
      level,
      module,
      search,
      limit: limit ? parseInt(limit, 10) : 500,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (err) {
    log.error('Failed to query logs', { error: err.message });
    res.status(500).json({ error: 'Failed to query logs', details: err.message });
  }
});

/**
 * GET /api/logs/dates
 * Get list of available log dates with file metadata.
 */
router.get('/dates', (req, res) => {
  try {
    const files = logStore.getAvailableLogFiles();
    res.json({ dates: files });
  } catch (err) {
    log.error('Failed to get log dates', { error: err.message });
    res.status(500).json({ error: 'Failed to get log dates', details: err.message });
  }
});

/**
 * GET /api/logs/files
 * Detailed list of log files on disk.
 */
router.get('/files', (req, res) => {
  try {
    const files = logStore.getAvailableLogFiles();
    const config = logStore.getConfig();
    res.json({ files, config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get log files', details: err.message });
  }
});

/**
 * GET /api/logs/config
 * Get current retention policy.
 */
router.get('/config', (req, res) => {
  try {
    res.json(logStore.getConfig());
  } catch (err) {
    res.status(500).json({ error: 'Failed to get config' });
  }
});

/**
 * POST /api/logs/config
 * Update retention configuration (e.g. change retention days, max file size).
 */
router.post('/config', (req, res) => {
  try {
    const { retentionDays, maxFileSizeBytes } = req.body;
    const updated = logStore.updateConfig({ retentionDays, maxFileSizeBytes });
    log.info('Updated log retention configuration', updated);
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update config', details: err.message });
  }
});

/**
 * POST /api/logs/cleanup
 * Manually trigger retention policy cleanup (auto-delete logs older than 90 days).
 */
router.post('/cleanup', (req, res) => {
  try {
    const { days } = req.body || {};
    const result = logStore.cleanOldLogs(days);
    log.info(`Manual log cleanup completed: deleted ${result.deletedFiles} files, freed ${result.freedBytes} bytes`);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger cleanup', details: err.message });
  }
});

/**
 * DELETE /api/logs/file
 * Instantly delete a specific log file by date (YYYY-MM-DD).
 */
router.delete('/file', (req, res) => {
  try {
    const date = req.query.date || (req.body && req.body.date);
    if (!date) {
      return res.status(400).json({ error: 'Date query parameter is required (YYYY-MM-DD)' });
    }
    const result = logStore.deleteLogFileByDate(date);
    log.info(`Deleted log file for date ${date}`);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete log file', details: err.message });
  }
});

/**
 * POST /api/logs/purge
 * Instantly delete all log files.
 */
router.post('/purge', (req, res) => {
  try {
    const result = logStore.purgeAllLogs();
    log.warn('Purged all application log files');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to purge logs', details: err.message });
  }
});

/**
 * GET /api/logs/stream
 * Server-Sent Events (SSE) live log streamer.
 */
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Initial ping
  res.write(`data: ${JSON.stringify({ type: 'ping', message: 'SSE log stream connected' })}\n\n`);

  logStore.addSseSubscriber(res);

  req.on('close', () => {
    logStore.removeSseSubscriber(res);
  });
});

module.exports = router;
