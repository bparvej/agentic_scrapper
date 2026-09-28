'use strict';

/**
 * Business validation rules for DSE instrument data.
 *
 * These are deterministic, configurable rules.
 * They do NOT call the LLM.
 *
 * Rules are designed to be:
 *   - Conservative (avoid false positives)
 *   - Configurable (thresholds in config)
 *   - Explainable (clear error messages)
 */

/**
 * Run all business rules on a normalised instrument object.
 *
 * @param {object} data  - Normalised instrument data
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validate(data) {
  const errors = [];
  const warnings = [];

  // --- Required fields ---
  if (!data.symbol || data.symbol.trim().length === 0) {
    errors.push('symbol is required');
  }

  // --- Price sanity ---
  if (data.lastTradePrice !== null && data.lastTradePrice !== undefined) {
    if (data.lastTradePrice < 0) {
      errors.push(`lastTradePrice is negative: ${data.lastTradePrice}`);
    }
  }

  if (data.highPrice !== null && data.highPrice !== undefined &&
      data.lowPrice !== null && data.lowPrice !== undefined) {
    if (data.highPrice < data.lowPrice) {
      errors.push(`highPrice (${data.highPrice}) < lowPrice (${data.lowPrice})`);
    }
  }

  if (data.openPrice !== null && data.openPrice !== undefined && data.openPrice < 0) {
    errors.push(`openPrice is negative: ${data.openPrice}`);
  }

  if (data.closePrice !== null && data.closePrice !== undefined && data.closePrice < 0) {
    errors.push(`closePrice is negative: ${data.closePrice}`);
  }

  // --- Volume sanity ---
  if (data.volume !== null && data.volume !== undefined && data.volume < 0) {
    errors.push(`volume is negative: ${data.volume}`);
  }

  if (data.tradeCount !== null && data.tradeCount !== undefined && data.tradeCount < 0) {
    errors.push(`tradeCount is negative: ${data.tradeCount}`);
  }

  // --- Percentage sanity ---
  if (data.changePercent !== null && data.changePercent !== undefined) {
    if (Math.abs(data.changePercent) > 500) {
      warnings.push(`changePercent (${data.changePercent}%) seems extreme`);
    }
  }

  if (data.dividendYield !== null && data.dividendYield !== undefined) {
    if (data.dividendYield < 0) {
      errors.push(`dividendYield is negative: ${data.dividendYield}`);
    }
    if (data.dividendYield > 100) {
      warnings.push(`dividendYield (${data.dividendYield}%) is > 100%`);
    }
  }

  // Ownership percentages should sum to ~100 (if all are present)
  const ownershipFields = [
    data.sponsorDirectorPercent,
    data.institutionalPercent,
    data.foreignPercent,
    data.publicPercent,
  ];
  const presentOwnership = ownershipFields.filter(v => v !== null && v !== undefined);
  if (presentOwnership.length === 4) {
    const sum = presentOwnership.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 5) {
      warnings.push(`Ownership percentages sum to ${sum.toFixed(2)}% (expected ~100%)`);
    }
  }

  // --- EPS sanity ---
  if (data.eps !== null && data.eps !== undefined) {
    if (Math.abs(data.eps) > 10000) {
      warnings.push(`EPS (${data.eps}) seems extreme — possible parsing error`);
    }
  }

  // --- P/E ratio ---
  if (data.peRatio !== null && data.peRatio !== undefined) {
    if (data.peRatio < 0) {
      warnings.push(`P/E ratio is negative (${data.peRatio}) — company may be loss-making`);
    }
    if (data.peRatio > 1000) {
      warnings.push(`P/E ratio (${data.peRatio}) is extremely high`);
    }
  }

  // --- Capital ---
  if (data.paidUpCapital !== null && data.paidUpCapital !== undefined && data.paidUpCapital < 0) {
    errors.push(`paidUpCapital is negative: ${data.paidUpCapital}`);
  }

  if (data.faceValue !== null && data.faceValue !== undefined) {
    if (data.faceValue <= 0) {
      errors.push(`faceValue must be positive: ${data.faceValue}`);
    }
    const validFaceValues = [1, 2, 5, 10, 100];
    if (!validFaceValues.includes(data.faceValue)) {
      warnings.push(`faceValue (${data.faceValue}) is not a standard DSE face value (1, 2, 5, 10, 100)`);
    }
  }

  return { errors, warnings };
}

module.exports = { validate };
