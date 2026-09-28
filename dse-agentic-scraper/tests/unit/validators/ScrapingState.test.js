'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ScrapingState = require('../../../src/workflow/state/ScrapingState');

describe('ScrapingState', () => {
  it('creates a state with a runId', () => {
    const state = new ScrapingState({ symbol: 'BATBC' });
    assert.ok(state.runId.startsWith('SCRAPE-'));
    assert.equal(state.symbol, 'BATBC');
    assert.equal(state.status, 'pending');
    assert.equal(state.recoveryAttempts, 0);
  });

  it('uppercases the symbol', () => {
    const state = new ScrapingState({ symbol: 'batbc' });
    assert.equal(state.symbol, 'BATBC');
  });

  it('transitions status immutably', () => {
    const s1 = new ScrapingState({ symbol: 'GP' });
    const s2 = s1.transition('fetching');
    assert.equal(s1.status, 'pending');
    assert.equal(s2.status, 'fetching');
  });

  it('adds an error immutably', () => {
    const s1 = new ScrapingState({ symbol: 'GP' });
    const s2 = s1.addError('test-agent', 'something failed');
    assert.equal(s1.errors.length, 0);
    assert.equal(s2.errors.length, 1);
    assert.equal(s2.errors[0].agent, 'test-agent');
    assert.equal(s2.errors[0].message, 'something failed');
  });

  it('calculates durationMs after completion', () => {
    const s = new ScrapingState({
      symbol: 'GP',
      startedAt: new Date(Date.now() - 5000),
      completedAt: new Date(),
    });
    assert.ok(s.durationMs > 0);
  });

  it('serialises to JSON cleanly', () => {
    const s = new ScrapingState({ symbol: 'GP' });
    const json = s.toJSON();
    assert.ok(json.runId);
    assert.equal(json.symbol, 'GP');
    assert.ok(!json.source || json.source === null);
  });
});
