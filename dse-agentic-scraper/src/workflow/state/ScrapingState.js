'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * ScrapingState — immutable-ish workflow state for a single scraping run.
 *
 * Every agent reads from this state and returns a new state object.
 * This makes it easy to:
 *   - Log the state at any point
 *   - Persist the state to the database
 *   - Resume from a saved state
 *
 * Status flow:
 *   pending → fetching → analyzing → extracting → validating
 *           → [recovering] → persisting → completed
 *           → failed (at any point)
 *
 * Do NOT mutate this object directly — use the update() method.
 */
class ScrapingState {
  /**
   * @param {object} init
   * @param {string} init.symbol
   */
  constructor(init) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

    this.runId = init.runId || `SCRAPE-${dateStr}-${uuidv4().slice(0, 8).toUpperCase()}`;
    this.symbol = init.symbol.trim().toUpperCase();
    this.url = init.url || '';
    this.status = init.status || 'pending';

    // Source information
    this.source = init.source || null;
    // {
    //   url: string,
    //   statusCode: number,
    //   fetchedAt: Date,
    //   html: string   (stored separately / not always in memory)
    // }

    // Page analysis
    this.pageMetadata = init.pageMetadata || null;
    this.discoveredSections = init.discoveredSections || [];

    // Extraction
    this.extractionStrategy = init.extractionStrategy || null;
    this.rawData = init.rawData || null;
    this.normalizedData = init.normalizedData || null;

    // Validation
    this.validationResult = init.validationResult || null;
    this.anomalies = init.anomalies || [];

    // Recovery
    this.recoveryAttempts = init.recoveryAttempts || 0;
    this.recoveryPlans = init.recoveryPlans || [];

    // Error tracking
    this.errors = init.errors || [];
    // Each error: { agent, message, timestamp, stack? }

    // Timing
    this.startedAt = init.startedAt || now;
    this.completedAt = init.completedAt || null;

    // Persistence result
    this.persistenceResult = init.persistenceResult || null;
    // { recordsCreated, recordsUpdated, instrumentId }
  }

  /**
   * Create a new state with updated fields (immutable pattern).
   * @param {object} updates
   * @returns {ScrapingState}
   */
  update(updates) {
    return new ScrapingState({ ...this, ...updates });
  }

  /**
   * Record an error.
   * @param {string} agent
   * @param {string|Error} error
   * @returns {ScrapingState}
   */
  addError(agent, error) {
    const err = {
      agent,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      stack: error instanceof Error ? error.stack : undefined,
    };
    return this.update({ errors: [...this.errors, err] });
  }

  /**
   * Transition to a new status.
   * @param {string} status
   * @returns {ScrapingState}
   */
  transition(status) {
    return this.update({ status });
  }

  /**
   * Serialise to a plain object (for JSON storage / logging).
   * @returns {object}
   */
  toJSON() {
    return {
      runId: this.runId,
      symbol: this.symbol,
      url: this.url,
      status: this.status,
      source: this.source
        ? {
            url: this.source.url,
            statusCode: this.source.statusCode,
            fetchedAt: this.source.fetchedAt,
          }
        : null,
      extractionStrategy: this.extractionStrategy,
      recoveryAttempts: this.recoveryAttempts,
      validationResult: this.validationResult
        ? {
            valid: this.validationResult.valid,
            errorCount: this.validationResult.businessErrors?.length || 0,
            warningCount: this.validationResult.warnings?.length || 0,
            anomalyCount: this.validationResult.anomalies?.length || 0,
          }
        : null,
      errors: this.errors,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      persistenceResult: this.persistenceResult,
    };
  }

  /**
   * Duration in milliseconds, or null if not complete.
   * @returns {number|null}
   */
  get durationMs() {
    if (!this.completedAt) return null;
    return new Date(this.completedAt).getTime() - new Date(this.startedAt).getTime();
  }
}

module.exports = ScrapingState;
