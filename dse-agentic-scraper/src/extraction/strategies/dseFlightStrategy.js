'use strict';

const https = require('https');
const logger = require('../../logging/logger');

const log = logger.createChild({ strategy: 'dse-flight' });

/**
 * DSE Flight Data Extraction Strategy
 *
 * Extracts all financial data from the React Server Components (RSC) flight
 * payload embedded in the HTML of DSE company pages.
 *
 * The flight entry format is:  self.__next_f.push([1, "ESCAPED_JSON_STRING"])
 * The nested JSON contains the full company object including:
 *   - market snapshot (price, eps, nav, pe, dividendYield, etc.)
 *   - interimFinancials  { periodEnds, rows[] }   → Card 2
 *   - multiYearFinancials []                       → Card 3 & 4
 *   - peUnauditedTable { dates, basic, diluted }   → Card 5
 *   - peAuditedTable   { dates, basic, diluted }   → Card 6
 *   - dividendHistory, sharePattern, loanStatus, etc.
 */

function fetchHtml(symbol) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'www.dse.com.bd',
        path: `/company/${symbol}?tab=financials`,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
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

/**
 * Walk a JSON string character-by-character to extract the balanced {} object
 * starting at position `start`.
 */
function extractJsonObject(str, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

async function extract(symbol) {
  log.debug('Starting DSE flight extraction', { symbol });

  let html;
  try {
    const res = await fetchHtml(symbol.toUpperCase());
    if (res.status !== 200) {
      log.warn('Non-200 from DSE', { symbol, status: res.status });
      return null;
    }
    html = res.body;
  } catch (err) {
    log.error('HTTP fetch failed', { symbol, error: err.message });
    return null;
  }

  // Collect all flight entries from the page
  const entries = html.match(/self\.__next_f\.push\(\[1,"[^"]*(?:\\.[^"]*)*"\]\)/g) || [];
  log.debug('Flight entries', { symbol, count: entries.length });

  let companyData = null;

  for (const entry of entries) {
    if (!entry.includes('multiYearFinancials')) continue;

    // Strip the outer push([1,"..."])
    const rawContent = entry.slice('self.__next_f.push([1,"'.length, -3);

    // Use JSON.parse to properly unescape the doubly-escaped string
    let unescaped;
    try {
      unescaped = JSON.parse('"' + rawContent + '"');
    } catch (_) {
      // Fallback manual unescape
      unescaped = rawContent
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    const companyKey = '"company":';
    const keyIdx = unescaped.indexOf(companyKey);
    if (keyIdx === -1) continue;

    const objStart = keyIdx + companyKey.length;
    if (unescaped[objStart] !== '{') continue;

    const raw = extractJsonObject(unescaped, objStart);
    if (!raw) continue;

    try {
      companyData = JSON.parse(raw);
      log.info('Company data extracted', { symbol, keys: Object.keys(companyData).length });
      break;
    } catch (err) {
      log.warn('Company JSON parse failed', { symbol, error: err.message });
    }
  }

  if (!companyData) {
    log.warn('DSE flight extraction yielded nothing', { symbol });
    return null;
  }

  return { success: true, strategy: 'dse_flight', data: normalise(companyData, symbol) };
}

function normalise(c, symbol) {
  /* -------- Interim Financials (Card 2) -------- */
  let interimFinancials = null;
  if (c.interimFinancials && c.interimFinancials.rows) {
    const pe = c.interimFinancials.periodEnds || {};
    const periods = [];
    if (pe.q1)     periods.push({ label: 'Q1',         ending: pe.q1,  key: 'q1'   });
    if (pe.q2)     periods.push({ label: 'Q2',         ending: pe.q2,  key: 'q2'   });
    if (pe.half)   periods.push({ label: 'Half Yearly',ending: pe.half,key: 'half' });
    if (pe.q3)     periods.push({ label: 'Q3',         ending: pe.q3,  key: 'q3'   });
    if (pe.nine)   periods.push({ label: '9 Months',   ending: pe.nine,key: 'nine' });
    if (pe.annual) periods.push({ label: 'Annual',     ending: pe.annual,key:'annual'});

    interimFinancials = {
      periods: periods.map((p) => p.label + '\nEnding on ' + p.ending),
      rows: c.interimFinancials.rows.map((row) => ({
        particulars: row.metric || '-',
        values: periods.map((p) => {
          const v = row[p.key];
          return v != null ? String(v) : '-';
        }),
      })),
    };
  }

  /* -------- Audited Multi-Year (Card 3) -------- */
  const auditedFinancials = (c.multiYearFinancials || []).slice(-6).reverse().map((y) => ({
    year:           String(y.year || '-'),
    epsBasic:       y.epsBasic        != null ? String(y.epsBasic)        : '-',
    epsContBasic:   y.epsContBasicOriginal != null ? String(y.epsContBasicOriginal) : '-',
    epsDiluted:     y.epsDiluted      != null ? String(y.epsDiluted)      : '-',
    epsContDiluted: y.epsContDiluted  != null ? String(y.epsContDiluted)  : '-',
    nav:            y.nav             != null ? String(y.nav)             : '-',
    profit:         y.profit          != null ? String(y.profit)          : '-',
    pe:             y.pe              != null ? String(y.pe)              : '-',
    dividendPct:    y.dividendPct     != null ? String(y.dividendPct)     : '-',
    dividendYield:  y.dividendYield   != null ? String(y.dividendYield)   : '-',
  }));

  /* -------- Continued (Card 4) -------- */
  const financialContinued = (c.multiYearFinancials || []).slice(-6).reverse().map((y) => ({
    year:          String(y.year || '-'),
    comprehensive: y.comprehensive  != null ? String(y.comprehensive)  : '-',
    profitForYear: y.profitForYear  != null ? String(y.profitForYear)  : '-',
    oci:           y.oci            != null ? String(y.oci)            : '-',
    reserve:       y.reserve        != null ? String(y.reserve)        : '-',
    peContBasic:   y.peContBasicOriginal != null ? String(y.peContBasicOriginal) : '-',
  }));

  /* -------- P/E tables (Cards 5 & 6) -------- */
  // DSE uses RSC cross-references: peAuditedTable.dates is a string reference
  // pointing to peUnauditedTable.dates — we resolve it here.
  const rawPeUnaudited = c.peUnauditedTable || null;
  const rawPeAudited   = c.peAuditedTable   || null;

  // Resolve the shared dates array (peAuditedTable.dates is a reference string)
  const sharedDates = Array.isArray(rawPeUnaudited?.dates)
    ? rawPeUnaudited.dates
    : null;

  // Build normalised unaudited table: dates + basic + diluted + trailing
  let peUnauditedTable = null;
  if (rawPeUnaudited && Array.isArray(rawPeUnaudited.basic)) {
    const dates   = sharedDates || rawPeUnaudited.dates || [];
    const basic   = rawPeUnaudited.basic   || [];
    const diluted = rawPeUnaudited.diluted || [];
    const trailing= rawPeUnaudited.trailing|| [];
    peUnauditedTable = {
      dates,
      rows: dates.map((d, i) => ({
        date:     d                                            ?? '-',
        basic:    basic[i]    != null ? basic[i].toFixed(2)   : '-',
        diluted:  diluted[i]  != null ? diluted[i].toFixed(2) : '-',
        trailing: trailing[i] != null ? trailing[i].toFixed(2): '-',
      })),
      latestBasic:    basic.length   ? (basic[basic.length - 1]     ?? null) : null,
      latestDiluted:  diluted.length ? (diluted.filter(v => v != null).pop() ?? null) : null,
      latestDate:     dates.length   ? dates[dates.length - 1]                : '-',
    };
  }

  // Build normalised audited table using the same shared dates
  let peAuditedTable = null;
  if (rawPeAudited && Array.isArray(rawPeAudited.basic)) {
    const dates   = sharedDates || [];
    const basic   = rawPeAudited.basic   || [];
    const diluted = rawPeAudited.diluted || [];
    peAuditedTable = {
      dates,
      rows: dates.map((d, i) => ({
        date:    d                                           ?? '-',
        basic:   basic[i]   != null ? basic[i].toFixed(2)   : '-',
        diluted: diluted[i] != null ? diluted[i].toFixed(2) : '-',
      })),
      latestBasic:   basic.length   ? (basic[basic.length - 1]      ?? null) : null,
      latestDiluted: diluted.length ? (diluted.filter(v => v != null).pop() ?? null) : null,
      latestDate:    sharedDates?.length ? sharedDates[sharedDates.length - 1] : '-',
    };
  }

  // Also include peTrend (30-day historical audited vs unaudited)
  // Format: [{ date, audited, unaudited }, ...]
  const peTrend = (c.peTrend || []).map(t => ({
    date:      t.date      ?? '-',
    audited:   t.audited   != null ? Number(t.audited).toFixed(2)   : '-',
    unaudited: t.unaudited != null ? Number(t.unaudited).toFixed(2) : '-',
  }));

  const latestPeUnaudited = peUnauditedTable?.latestBasic ?? null;
  const latestPeAudited   = peAuditedTable?.latestBasic   ?? null;

  /* -------- Share ownership -------- */
  const latestPattern = (c.sharePattern || []).slice(-1)[0]?.pattern || {};

  return {
    symbol:           symbol.toUpperCase(),
    // === Card 1: Snapshot ===
    companyName:      c.name               || null,
    sector:           c.sector             || null,
    category:         c.category           || null,
    instrumentType:   c.instrumentType     || null,
    market:           c.board              || null,
    lastTradePrice:   c.price              ?? null,
    eps:              c.eps                ?? null,
    nav:              c.nav                ?? null,
    bookValue:        c.bookValue          ?? null,
    peRatio:          c.pe                 ?? null,
    dividendYield:    c.dividendYield      ?? null,
    faceValue:        c.faceValue          ?? null,
    marketCap:        c.marketCap          ?? null,
    paidUpCapital:    c.paidUpCapital      ?? null,
    weekHigh52:       c.weekHigh52         ?? null,
    weekLow52:        c.weekLow52          ?? null,
    freeFloat:        c.freeFloat          ?? null,
    volume:           c.volume             ?? null,
    change:           c.change             ?? null,
    changePct:        c.changePct          ?? null,
    open:             c.open               ?? null,
    high:             c.high               ?? null,
    low:              c.low                ?? null,
    prevClose:        c.prevClose          ?? null,
    listingYear:      c.listingYear        ?? null,
    scripCode:        c.scripCode          ?? null,
    website:          c.website            || null,
    hq:               c.hq                 || null,
    agmDate:          c.agmDate            || null,
    yearEnd:          c.yearEnd            || null,
    authorizedCapital:c.authorizedCapital  ?? null,
    reserveWithoutOci:c.reserveWithoutOci  ?? null,
    shortTermLoan:    c.loanStatus?.shortTerm ?? null,
    longTermLoan:     c.loanStatus?.longTerm  ?? null,
    sponsorPercent:   latestPattern.sponsor   ?? null,
    institutionPercent: latestPattern.institution ?? null,
    foreignPercent:   latestPattern.foreign   ?? null,
    publicPercent:    latestPattern.public     ?? null,
    // === Card 2 ===
    interimFinancials,
    // === Card 3 ===
    auditedFinancials,
    // === Card 4 ===
    financialContinued,
    // === Card 5 ===
    peUnauditedTable,
    latestPeUnaudited,
    // === Card 6 ===
    peAuditedTable,
    latestPeAudited,
    // === Shared P/E History (used in both Cards 5 & 6) ===
    peTrend,
    // Extra
    dividendHistory:  c.dividendHistory   || [],
    description:      c.description       || null,
    metadata: {
      extractedAt: new Date().toISOString(),
      strategy: 'dse_flight',
    },
  };
}

module.exports = { extract };
