'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../../../src/validation/businessRules');

const BASE = {
  symbol: 'BATBC',
  lastTradePrice: 680.40,
  highPrice: 685.00,
  lowPrice: 671.50,
  openPrice: 675.00,
  closePrice: 678.00,
  volume: 12450,
  tradeCount: 245,
  changePercent: 1.21,
  dividendYield: 7.35,
  eps: 68.45,
  peRatio: 9.93,
  paidUpCapital: 181400000,
  faceValue: 10,
  sponsorDirectorPercent: 72.91,
  institutionalPercent: 14.23,
  foreignPercent: 2.15,
  publicPercent: 10.71,
};

describe('businessRules.validate', () => {
  it('passes a valid instrument', () => {
    const { errors, warnings } = validate(BASE);
    assert.equal(errors.length, 0);
  });

  it('fails when symbol is empty', () => {
    const { errors } = validate({ ...BASE, symbol: '' });
    assert.ok(errors.some(e => e.includes('symbol is required')));
  });

  it('fails when highPrice < lowPrice', () => {
    const { errors } = validate({ ...BASE, highPrice: 660, lowPrice: 680 });
    assert.ok(errors.some(e => e.includes('highPrice')));
  });

  it('fails when price is negative', () => {
    const { errors } = validate({ ...BASE, lastTradePrice: -10 });
    assert.ok(errors.some(e => e.includes('lastTradePrice is negative')));
  });

  it('fails when volume is negative', () => {
    const { errors } = validate({ ...BASE, volume: -1 });
    assert.ok(errors.some(e => e.includes('volume is negative')));
  });

  it('warns on extreme changePercent', () => {
    const { warnings } = validate({ ...BASE, changePercent: 600 });
    assert.ok(warnings.some(w => w.includes('changePercent')));
  });

  it('warns when ownership does not sum to 100', () => {
    const { warnings } = validate({
      ...BASE,
      sponsorDirectorPercent: 50,
      institutionalPercent: 10,
      foreignPercent: 2,
      publicPercent: 5,   // sum = 67, not 100
    });
    assert.ok(warnings.some(w => w.includes('sum to')));
  });

  it('fails when dividendYield is negative', () => {
    const { errors } = validate({ ...BASE, dividendYield: -1 });
    assert.ok(errors.some(e => e.includes('dividendYield is negative')));
  });

  it('warns on extreme EPS', () => {
    const { warnings } = validate({ ...BASE, eps: 99999 });
    assert.ok(warnings.some(w => w.includes('EPS')));
  });

  it('fails when paidUpCapital is negative', () => {
    const { errors } = validate({ ...BASE, paidUpCapital: -1 });
    assert.ok(errors.some(e => e.includes('paidUpCapital is negative')));
  });

  it('warns on non-standard face value', () => {
    const { warnings } = validate({ ...BASE, faceValue: 7 });
    assert.ok(warnings.some(w => w.includes('faceValue')));
  });
});
