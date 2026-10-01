'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const router = express.Router();

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

  const logFile = path.join(__dirname, '../../../logs/combined.log');
  
  if (!fs.existsSync(logFile)) {
    if (!fs.existsSync(path.dirname(logFile))) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
    }
    fs.writeFileSync(logFile, '');
  }

  const tail = spawn('tail', ['-f', '-n', '50', logFile]);

  tail.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch (e) {
          res.write(`data: ${JSON.stringify({ message: line })}\n\n`);
        }
      }
    });
  });

  req.on('close', () => {
    tail.kill();
  });
});

module.exports = router;
