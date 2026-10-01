'use strict';

const https = require('https');
const logger = require('../../logging/logger');

const log = logger.createChild({ strategy: 'dse-list' });

function fetchHtml() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'www.dse.com.bd',
        path: '/',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'text/html,*/*',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Timeout')); });
  });
}

function extractJsonObjectOrArray(str, start, isArray = false) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const openChar = isArray ? '[' : '{';
  const closeChar = isArray ? ']' : '}';
  
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

async function extractList() {
  log.debug('Starting DSE instrument list extraction');

  let html;
  try {
    const res = await fetchHtml();
    if (res.status !== 200) {
      log.warn('Non-200 from DSE main page', { status: res.status });
      return null;
    }
    html = res.body;
  } catch (err) {
    log.error('HTTP fetch failed', { error: err.message });
    return null;
  }

  // Collect all flight entries from the page
  const entries = html.match(/self\.__next_f\.push\(\[1,"[^"]*(?:\\.[^"]*)*"\]\)/g) || [];
  
  for (const entry of entries) {
    if (!entry.includes('tickerInitial')) continue;

    const rawContent = entry.slice('self.__next_f.push([1,"'.length, -3);

    let unescaped;
    try {
      unescaped = JSON.parse('"' + rawContent + '"');
    } catch (_) {
      unescaped = rawContent
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    const arrayKey = '"tickerInitial":';
    const keyIdx = unescaped.indexOf(arrayKey);
    if (keyIdx === -1) continue;

    const arrStart = keyIdx + arrayKey.length;
    if (unescaped[arrStart] !== '[') continue;

    const raw = extractJsonObjectOrArray(unescaped, arrStart, true);
    if (!raw) continue;

    try {
      const arr = JSON.parse(raw);
      // Clean up the list to standard { symbol, ... } format
      const instruments = arr.map(item => ({
        symbol: item.code,
        price: item.price,
        change: item.change,
        changePct: item.delta
      }));
      log.info('Instrument list extracted', { count: instruments.length });
      return { success: true, data: instruments };
    } catch (err) {
      log.warn('tickerInitial JSON parse failed', { error: err.message });
    }
  }

  return null;
}

module.exports = { extractList };
