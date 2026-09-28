'use strict';

/**
 * Value normalizers — deterministic, LLM-free.
 *
 * All raw string values extracted from DSE pages pass through these
 * functions before entering the validation or persistence layer.
 *
 * Rules:
 *   - Never silently drop a value; return { value, warning } tuples
 *   - Never guess when a value is ambiguous
 *   - Preserve the original raw string for audit purposes
 */

const NULL_VALUES = new Set([
  'n/a', 'na', 'nil', '-', '--', '---', 'n.a.', 'not available',
  'not applicable', '', 'none', 'null', '0.00', '0',
]);

/**
 * Normalise a numeric string.
 *
 * Handles:
 *   "1,245.50"  → 1245.50
 *   "5.25%"     → 5.25   (percentage flag = true)
 *   "(123.45)"  → -123.45 (accounting negatives)
 *   "Tk. 10"    → 10
 *
 * @param {string|number} raw
 * @returns {{ value: number|null, warning: string|null, isPercentage: boolean }}
 */
function normalizeNumber(raw) {
  if (raw === null || raw === undefined) {
    return { value: null, warning: null, isPercentage: false };
  }

  const str = String(raw).trim();

  if (NULL_VALUES.has(str.toLowerCase())) {
    return { value: null, warning: null, isPercentage: false };
  }

  let isPercentage = false;
  let working = str;

  // Strip currency symbols and unit prefixes
  working = working.replace(/^(Tk\.?|BDT|৳|\$|€|£)\s*/i, '');
  working = working.replace(/\s*(mn|cr|lakh|million|billion|crore)$/i, '');

  // Detect percentage
  if (working.endsWith('%')) {
    isPercentage = true;
    working = working.slice(0, -1);
  }

  // Handle accounting negative: (123.45)
  if (working.startsWith('(') && working.endsWith(')')) {
    working = '-' + working.slice(1, -1);
  }

  // Remove thousands separators (commas)
  working = working.replace(/,/g, '');

  // Strip trailing/leading whitespace again
  working = working.trim();

  const num = parseFloat(working);

  if (isNaN(num)) {
    return {
      value: null,
      warning: `Cannot parse numeric value from: "${str}"`,
      isPercentage,
    };
  }

  return { value: num, warning: null, isPercentage };
}

/**
 * Normalise a percentage string.
 *
 * @param {string|number} raw
 * @returns {{ value: number|null, warning: string|null }}
 */
function normalizePercentage(raw) {
  const { value, warning, isPercentage } = normalizeNumber(raw);
  if (value === null) return { value: null, warning };

  // If it's already extracted as percentage, keep it
  if (isPercentage) return { value, warning: null };

  // Some fields are stored as 0-100 range, others as 0-1 decimal
  // We always return 0-100 form for percentages
  if (value > 0 && value < 1) {
    return { value: value * 100, warning: 'Converted from decimal to percentage' };
  }

  return { value, warning: null };
}

/**
 * Normalise a date string into an ISO date string (YYYY-MM-DD) or null.
 *
 * Handles common DSE date formats:
 *   "28 Sep 2026"
 *   "2026-09-28"
 *   "28/09/2026"
 *   "September 28, 2026"
 *
 * @param {string} raw
 * @returns {{ value: string|null, warning: string|null }}
 */
function normalizeDate(raw) {
  if (!raw) return { value: null, warning: null };

  const str = String(raw).trim();
  if (NULL_VALUES.has(str.toLowerCase())) {
    return { value: null, warning: null };
  }

  // DD/MM/YYYY — try this before native parsing to avoid ambiguity
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return {
      value: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
      warning: null,
    };
  }

  // YYYY-MM-DD (already ISO)
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return { value: str, warning: null };
  }

  // "28 Sep 2026" or "September 28, 2026" — parse and use UTC to avoid TZ shift
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    // Use UTC date parts to avoid timezone off-by-one
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return { value: `${y}-${m}-${day}`, warning: null };
  }

  return {
    value: null,
    warning: `Cannot parse date from: "${str}"`,
  };
}

/**
 * Normalise a string value — trim whitespace, normalise null sentinels.
 *
 * @param {string} raw
 * @returns {{ value: string|null, warning: string|null }}
 */
function normalizeString(raw) {
  if (raw === null || raw === undefined) {
    return { value: null, warning: null };
  }

  const str = String(raw).trim();

  if (NULL_VALUES.has(str.toLowerCase())) {
    return { value: null, warning: null };
  }

  // Collapse internal whitespace
  return { value: str.replace(/\s+/g, ' '), warning: null };
}

/**
 * Normalise a volume or integer count.
 *
 * @param {string|number} raw
 * @returns {{ value: number|null, warning: string|null }}
 */
function normalizeInteger(raw) {
  const { value, warning } = normalizeNumber(raw);
  if (value === null) return { value: null, warning };
  return { value: Math.round(value), warning };
}

module.exports = {
  normalizeNumber,
  normalizePercentage,
  normalizeDate,
  normalizeString,
  normalizeInteger,
};
