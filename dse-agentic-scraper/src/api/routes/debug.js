const express = require('express');
const router = express.Router();
const logStore = require('../../logging/logStore');

/**
 * GET /api/debug/stream
 *
 * Server-Sent Events (SSE) endpoint to stream application logs in real-time.
 */
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write(`data: ${JSON.stringify({ type: 'ping', message: 'Log stream connected' })}\n\n`);

  logStore.addSseSubscriber(res);

  req.on('close', () => {
    logStore.removeSseSubscriber(res);
  });
});

module.exports = router;
