'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { extract } = require('../../../src/extraction/strategies/htmlStrategy');
const HtmlTool = require('../../../src/tools/html/HtmlTool');

const FIXTURE_DIR = path.join(__dirname, '../../fixtures/dse');

describe('htmlStrategy.extract', () => {
  it('extracts data from normal BATBC fixture', () => {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-normal.html'), 'utf8');
    const result = extract(html, 'BATBC');

    assert.ok(result, 'result should not be null');
    assert.equal(result.success, true);
    assert.equal(result.strategy, 'html');
    assert.equal(result.data.symbol, 'BATBC');
    assert.equal(result.data.companyName, 'British American Tobacco Bangladesh Company Limited');
    assert.equal(result.data.lastTradePrice, 680.40);
    assert.equal(result.data.highPrice, 685.00);
    assert.equal(result.data.lowPrice, 671.50);
    assert.equal(result.data.volume, 12450);
    assert.equal(result.data.eps, 68.45);
    assert.equal(result.data.faceValue, 10);
    assert.equal(result.data.sector, 'Food & Allied');
    assert.equal(result.data.category, 'A');
  });

  it('returns null for an empty JS shell', () => {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-shell.html'), 'utf8');
    const result = extract(html, 'BATBC');
    // Shell has no tables with meaningful data
    assert.ok(result === null || (result && result.data.companyName === null));
  });

  it('handles missing fields gracefully', () => {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-missing-field.html'), 'utf8');
    const result = extract(html, 'BATBC');

    // The fixture has minimal data (only Trading Code + Company Name).
    // With the threshold of 2 meaningful fields the result should either be:
    //   - a valid result with symbol + companyName, or
    //   - null (not enough data to extract)
    // Either outcome is acceptable — we just verify no exception is thrown.
    if (result !== null) {
      assert.equal(result.data.symbol, 'BATBC');
      assert.equal(result.data.lastTradePrice, null);  // not present
      assert.equal(result.data.eps, null);              // not present
    }
  });
});

describe('HtmlTool.extractTables', () => {
  it('extracts tables from normal fixture', () => {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-normal.html'), 'utf8');
    const tables = HtmlTool.extractTables(html);
    assert.ok(tables.length > 0);
  });

  it('extracts JSON scripts', () => {
    const html = `<html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"foo":"bar"}}}</script></head><body></body></html>`;
    const scripts = HtmlTool.extractJsonScripts(html);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].id, '__NEXT_DATA__');
    assert.equal(scripts[0].data.props.pageProps.foo, 'bar');
  });

  it('detects unrendered page', () => {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-shell.html'), 'utf8');
    assert.equal(HtmlTool.isRenderedPage(html), false);
  });

  it('detects rendered page', () => {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-normal.html'), 'utf8');
    assert.equal(HtmlTool.isRenderedPage(html), true);
  });
});

describe('nextjsDataStrategy.extract', () => {
  it('extracts data from embedded __NEXT_DATA__', () => {
    const { extract: nextExtract } = require('../../../src/extraction/strategies/nextjsDataStrategy');
    const fixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, 'batbc-nextjs-data.json'), 'utf8')
    );

    // Wrap it in a <script> tag to simulate a real page
    const html = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script></head><body><p>Loading...</p></body></html>`;

    const result = nextExtract(html, 'BATBC');
    assert.ok(result, 'result should not be null');
    assert.equal(result.success, true);
    assert.equal(result.strategy, 'nextjs_data');
    assert.equal(result.data.symbol, 'BATBC');
    assert.equal(result.data.lastTradePrice, 680.40);
    assert.equal(result.data.eps, 68.45);
    assert.equal(result.data.volume, 12450);
  });
});
