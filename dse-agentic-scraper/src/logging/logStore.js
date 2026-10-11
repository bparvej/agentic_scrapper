'use strict';

const fs = require('fs');
const path = require('path');
const Transport = require('winston-transport');

// Directory for persistent daily log files
const LOG_DIR = path.resolve(__dirname, '../../logs');

// Default retention configuration
let configRetention = {
  retentionDays: 90, // 3 months default
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB max file size before warning/action
};

// In-memory circular buffer (max 3,000 logs for high-speed UI queries)
const MAX_MEMORY_LOGS = 3000;
const memoryBuffer = [];
let nextLogId = 1;

// Active SSE subscribers for live streaming
const sseClients = new Set();

/**
 * Ensure the log directory exists.
 */
function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create log directory:', err.message);
  }
}

/**
 * Get date string in YYYY-MM-DD format (UTC).
 * @param {Date} date
 * @returns {string}
 */
function getDateString(date = new Date()) {
  try {
    return date.toISOString().split('T')[0];
  } catch {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Get the log filepath for a specific date.
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string}
 */
function getFilePathForDate(dateStr) {
  return path.join(LOG_DIR, `dse-${dateStr}.log`);
}

/**
 * Normalize and categorize log entry.
 */
function normalizeLogEntry(info) {
  const timestamp = info.timestamp || new Date().toISOString();
  const dateStr = timestamp.split('T')[0] || getDateString();
  
  // Detect success variant of info
  let level = (info.level || 'info').toLowerCase();
  if (level === 'info' && (info.success === true || (typeof info.message === 'string' && /(success|succeeded|completed successfully|ready)/i.test(info.message)))) {
    level = 'success';
  }

  const moduleName = info.module || info.agent || info.tool || info.route || 'system';
  
  // Extract custom meta without Winston internal symbols
  const meta = {};
  for (const [key, val] of Object.entries(info)) {
    if (!['level', 'message', 'timestamp', 'module', 'agent', 'tool', 'route'].includes(key) && typeof key === 'string') {
      meta[key] = val;
    }
  }

  return {
    id: nextLogId++,
    timestamp,
    date: dateStr,
    level,
    module: moduleName,
    message: typeof info.message === 'string' ? info.message : JSON.stringify(info.message),
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

/**
 * Append entry to in-memory buffer and write to daily file.
 */
function recordLog(entry) {
  try {
    // 1. Add to in-memory circular buffer
    memoryBuffer.push(entry);
    if (memoryBuffer.length > MAX_MEMORY_LOGS) {
      memoryBuffer.shift();
    }

    // 2. Append to daily file
    ensureLogDir();
    const filePath = getFilePathForDate(entry.date);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(filePath, line, (err) => {
      if (err) {
        // Fallback silently if disk is read-only
      }
    });

    // 3. Broadcast to active SSE clients
    if (sseClients.size > 0) {
      const payload = `data: ${JSON.stringify(entry)}\n\n`;
      for (const client of sseClients) {
        try {
          client.write(payload);
        } catch {
          sseClients.delete(client);
        }
      }
    }
  } catch (err) {
    console.error('Error recording log entry:', err.message);
  }
}

/**
 * Custom Winston Transport that pushes to logStore.
 */
class LogStoreTransport extends Transport {
  constructor(opts) {
    super(opts);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    try {
      const entry = normalizeLogEntry(info);
      recordLog(entry);
    } catch {
      // Ignore formatting issues
    }

    callback();
  }
}

/**
 * Clean up logs older than retention period (default 90 days / 3 months).
 * @returns {object} { deletedFiles: number, freedBytes: number }
 */
function cleanOldLogs(retentionDays = configRetention.retentionDays) {
  ensureLogDir();
  let deletedFiles = 0;
  let freedBytes = 0;

  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('dse-') || !file.endsWith('.log')) continue;

      const fullPath = path.join(LOG_DIR, file);
      try {
        const stats = fs.statSync(fullPath);
        
        // Check date from file name: dse-YYYY-MM-DD.log
        const match = file.match(/^dse-(\d{4}-\d{2}-\d{2})\.log$/);
        let fileAgeMs = now - stats.mtimeMs;
        if (match) {
          const fileDate = new Date(match[1]).getTime();
          if (!isNaN(fileDate)) {
            fileAgeMs = now - fileDate;
          }
        }

        if (fileAgeMs > maxAgeMs) {
          freedBytes += stats.size;
          fs.unlinkSync(fullPath);
          deletedFiles++;
        }
      } catch (e) {
        console.error(`Error deleting old log file ${file}:`, e.message);
      }
    }
  } catch (err) {
    console.error('Failed to run cleanOldLogs:', err.message);
  }

  return { deletedFiles, freedBytes, retentionDays };
}

/**
 * Delete a specific log file by date (YYYY-MM-DD).
 */
function deleteLogFileByDate(dateStr) {
  ensureLogDir();
  let success = false;
  let freedBytes = 0;

  try {
    const filePath = getFilePathForDate(dateStr);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      freedBytes = stats.size;
      fs.unlinkSync(filePath);
      success = true;
    }

    // Also remove from in-memory buffer
    for (let i = memoryBuffer.length - 1; i >= 0; i--) {
      if (memoryBuffer[i].date === dateStr) {
        memoryBuffer.splice(i, 1);
      }
    }
  } catch (err) {
    console.error(`Failed to delete log file for date ${dateStr}:`, err.message);
  }

  return { success, freedBytes, date: dateStr };
}

/**
 * Purge all log files and in-memory buffer.
 */
function purgeAllLogs() {
  ensureLogDir();
  let deletedFiles = 0;
  let freedBytes = 0;

  try {
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      if (file.startsWith('dse-') && file.endsWith('.log')) {
        const fullPath = path.join(LOG_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          freedBytes += stats.size;
          fs.unlinkSync(fullPath);
          deletedFiles++;
        } catch {}
      }
    }

    // Reset in-memory buffer
    memoryBuffer.length = 0;
  } catch (err) {
    console.error('Failed to purge all logs:', err.message);
  }

  return { deletedFiles, freedBytes };
}

/**
 * List all available log dates and file stats.
 */
function getAvailableLogFiles() {
  ensureLogDir();
  const fileList = [];
  const todayStr = getDateString();
  const foundDates = new Set();

  try {
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      const match = file.match(/^dse-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match) {
        const dateStr = match[1];
        foundDates.add(dateStr);
        const fullPath = path.join(LOG_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          fileList.push({
            date: dateStr,
            fileName: file,
            sizeBytes: stats.size,
            sizeKb: (stats.size / 1024).toFixed(1),
            sizeMb: (stats.size / (1024 * 1024)).toFixed(2),
            modifiedAt: stats.mtime.toISOString(),
            isToday: dateStr === todayStr,
          });
        } catch {}
      }
    }
  } catch (err) {
    console.error('Error reading log directory:', err.message);
  }

  // Ensure today's date is always represented even if no file on disk yet
  if (!foundDates.has(todayStr)) {
    const todayMemoryCount = memoryBuffer.filter(e => e.date === todayStr).length;
    fileList.unshift({
      date: todayStr,
      fileName: `dse-${todayStr}.log`,
      sizeBytes: 0,
      sizeKb: '0.0',
      sizeMb: '0.00',
      modifiedAt: new Date().toISOString(),
      isToday: true,
      inMemoryOnly: true,
      entryCount: todayMemoryCount,
    });
  }

  // Sort descending by date
  fileList.sort((a, b) => b.date.localeCompare(a.date));
  return fileList;
}

/**
 * Query logs with date, level, module, search term, and pagination.
 */
function queryLogs({ date, level, module, search, limit = 500, offset = 0 } = {}) {
  const targetDate = date || getDateString();
  let entries = [];

  // Check if we have logs for this date on disk
  const filePath = getFilePathForDate(targetDate);
  if (fs.existsSync(filePath)) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const lines = fileContent.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch {}
      }
    } catch (err) {
      console.error(`Failed to read log file for ${targetDate}:`, err.message);
    }
  }

  // If file has no entries or wasn't on disk, fallback to in-memory entries matching this date
  if (entries.length === 0) {
    entries = memoryBuffer.filter(e => e.date === targetDate);
  }

  // Apply filters
  if (level && level.toLowerCase() !== 'all') {
    const lvl = level.toLowerCase();
    entries = entries.filter(e => e.level === lvl);
  }

  if (module && module.toLowerCase() !== 'all') {
    const mod = module.toLowerCase();
    entries = entries.filter(e => (e.module || '').toLowerCase() === mod);
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    entries = entries.filter(e => {
      const msgMatch = (e.message || '').toLowerCase().includes(q);
      const modMatch = (e.module || '').toLowerCase().includes(q);
      const metaMatch = e.meta ? JSON.stringify(e.meta).toLowerCase().includes(q) : false;
      return msgMatch || modMatch || metaMatch;
    });
  }

  const total = entries.length;
  // Sort newest first
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Slice pagination
  const paginated = entries.slice(offset, offset + limit);

  // Compute level stats for the queried set
  const stats = {
    total,
    info: 0,
    success: 0,
    warn: 0,
    error: 0,
    debug: 0,
  };

  for (const e of entries) {
    if (stats[e.level] !== undefined) {
      stats[e.level]++;
    }
  }

  return {
    date: targetDate,
    total,
    limit,
    offset,
    stats,
    logs: paginated,
  };
}

/**
 * Subscribe an SSE response object.
 */
function addSseSubscriber(res) {
  sseClients.add(res);
}

/**
 * Unsubscribe an SSE response object.
 */
function removeSseSubscriber(res) {
  sseClients.delete(res);
}

/**
 * Update retention configuration.
 */
function updateConfig(newConfig = {}) {
  if (newConfig.retentionDays !== undefined) {
    configRetention.retentionDays = Math.max(1, parseInt(newConfig.retentionDays, 10));
  }
  if (newConfig.maxFileSizeBytes !== undefined) {
    configRetention.maxFileSizeBytes = Math.max(1024 * 1024, parseInt(newConfig.maxFileSizeBytes, 10));
  }
  return configRetention;
}

function getConfig() {
  return { ...configRetention };
}

// Initial cleanup on boot
try {
  ensureLogDir();
  cleanOldLogs();
} catch {}

module.exports = {
  LogStoreTransport,
  recordLog,
  cleanOldLogs,
  deleteLogFileByDate,
  purgeAllLogs,
  getAvailableLogFiles,
  queryLogs,
  addSseSubscriber,
  removeSseSubscriber,
  updateConfig,
  getConfig,
  getDateString,
};
