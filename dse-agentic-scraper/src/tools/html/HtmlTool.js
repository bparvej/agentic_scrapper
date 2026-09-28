'use strict';

const cheerio = require('cheerio');

/**
 * HTML Tool — deterministic HTML parsing using Cheerio.
 *
 * Wraps Cheerio to provide a consistent API for extracting:
 * - Tables
 * - Key-value sections
 * - Embedded JSON (__NEXT_DATA__ etc.)
 * - Text content
 * - Links
 * - Page metadata
 *
 * None of these methods call the LLM.
 * The LLM receives the structured output of these methods,
 * not raw HTML.
 */

/**
 * Load HTML into a Cheerio instance.
 * @param {string} html
 * @returns {cheerio.CheerioAPI}
 */
function load(html) {
  return cheerio.load(html);
}

/**
 * Extract all tables from the page as arrays of row objects.
 *
 * @param {string} html
 * @returns {Array<{headers: string[], rows: object[]}>}
 */
function extractTables(html) {
  const $ = load(html);
  const tables = [];

  $('table').each((_, table) => {
    const headers = [];
    const rows = [];

    // Extract headers from <thead> or first <tr>
    $(table)
      .find('thead tr th, thead tr td')
      .each((_, th) => {
        headers.push($(th).text().trim());
      });

    // If no thead, use first tr as headers
    if (headers.length === 0) {
      $(table)
        .find('tr:first-child th, tr:first-child td')
        .each((_, td) => {
          headers.push($(td).text().trim());
        });
    }

    // Extract data rows
    $(table)
      .find('tbody tr')
      .each((_, tr) => {
        const cells = [];
        $(tr)
          .find('td, th')
          .each((_, td) => {
            cells.push($(td).text().trim());
          });

        if (cells.length > 0) {
          if (headers.length > 0 && cells.length === headers.length) {
            const row = {};
            headers.forEach((h, i) => {
              row[h] = cells[i];
            });
            rows.push(row);
          } else {
            rows.push({ cells });
          }
        }
      });

    // Also try rows not inside tbody
    if (rows.length === 0) {
      $(table)
        .find('tr')
        .slice(headers.length > 0 ? 1 : 0)
        .each((_, tr) => {
          const cells = [];
          $(tr)
            .find('td')
            .each((_, td) => {
              cells.push($(td).text().trim());
            });

          if (cells.length > 0) {
            if (headers.length > 0 && cells.length === headers.length) {
              const row = {};
              headers.forEach((h, i) => {
                row[h] = cells[i];
              });
              rows.push(row);
            } else {
              rows.push({ cells });
            }
          }
        });
    }

    tables.push({ headers, rows });
  });

  return tables;
}

/**
 * Extract key-value pairs from definition lists or label-value patterns.
 *
 * Handles common DSE patterns:
 *   <tr><td>Label</td><td>Value</td></tr>
 *   <dl><dt>Label</dt><dd>Value</dd></dl>
 *
 * @param {string} html
 * @returns {object}  Flat key-value map
 */
function extractKeyValuePairs(html) {
  const $ = load(html);
  const pairs = {};

  // Pattern 1: <tr> with exactly 2 cells
  $('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 2) {
      const key = $(cells[0]).text().trim().replace(/:$/, '');
      const value = $(cells[1]).text().trim();
      if (key) pairs[key] = value;
    }
  });

  // Pattern 2: <dl><dt>/<dd>
  $('dl').each((_, dl) => {
    const dts = $(dl).find('dt');
    const dds = $(dl).find('dd');
    dts.each((i, dt) => {
      const key = $(dt).text().trim().replace(/:$/, '');
      const value = dds.eq(i).text().trim();
      if (key) pairs[key] = value;
    });
  });

  // Pattern 3: label + sibling/cousin span or div
  $('[class*="label"], [class*="title"], th').each((_, el) => {
    const key = $(el).text().trim().replace(/:$/, '');
    const sibling = $(el).next();
    if (sibling.length > 0) {
      const value = sibling.text().trim();
      if (key && value) pairs[key] = value;
    }
  });

  return pairs;
}

/**
 * Extract embedded JSON from <script> tags.
 *
 * Looks for:
 *   - __NEXT_DATA__ (Next.js server-side props)
 *   - application/json scripts
 *   - window.__DATA__ patterns
 *
 * @param {string} html
 * @returns {Array<{id: string|null, type: string, data: object}>}
 */
function extractJsonScripts(html) {
  const $ = load(html);
  const results = [];

  $('script').each((_, el) => {
    const id = $(el).attr('id') || null;
    const type = $(el).attr('type') || 'text/javascript';
    const content = $(el).html() || '';

    // __NEXT_DATA__ — this is the gold standard for Next.js pages
    if (id === '__NEXT_DATA__' || type === 'application/json') {
      try {
        const data = JSON.parse(content);
        results.push({ id, type, data });
      } catch {
        // Not valid JSON, skip
      }
      return;
    }

    // Look for inline JSON assignments: window.X = {...} or var X = {...}
    const jsonAssignPatterns = [
      /window\.__[A-Z_]+\s*=\s*(\{[\s\S]*?\});/,
      /var\s+__[A-Z_]+\s*=\s*(\{[\s\S]*?\});/,
    ];

    for (const pattern of jsonAssignPatterns) {
      const match = content.match(pattern);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          results.push({ id: id || 'inline', type: 'inline-json', data });
        } catch {
          // Not valid JSON
        }
      }
    }
  });

  return results;
}

/**
 * Extract all links from the page.
 *
 * @param {string} html
 * @param {string} [baseUrl]
 * @returns {Array<{href: string, text: string}>}
 */
function extractLinks(html, baseUrl = '') {
  const $ = load(html);
  const links = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();

    // Resolve relative URLs
    let resolved = href;
    if (baseUrl && href.startsWith('/')) {
      try {
        resolved = new URL(href, baseUrl).toString();
      } catch {
        resolved = href;
      }
    }

    links.push({ href: resolved, text });
  });

  return links;
}

/**
 * Extract page metadata: title, meta tags.
 *
 * @param {string} html
 * @returns {object}
 */
function extractMetadata(html) {
  const $ = load(html);
  const meta = {};

  meta.title = $('title').text().trim();
  meta.description = $('meta[name="description"]').attr('content') || null;
  meta.canonical = $('link[rel="canonical"]').attr('href') || null;

  $('meta[property], meta[name]').each((_, el) => {
    const key =
      $(el).attr('property') || $(el).attr('name') || '';
    const value = $(el).attr('content') || '';
    if (key && value) meta[key] = value;
  });

  return meta;
}

/**
 * Get all visible text content, whitespace-normalised.
 *
 * @param {string} html
 * @returns {string}
 */
function extractText(html) {
  const $ = load(html);
  // Remove scripts, styles, noscript
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

/**
 * Check whether the HTML looks like a fully rendered page or an empty shell.
 * A Next.js shell typically has very little text in <body>.
 *
 * @param {string} html
 * @returns {boolean}
 */
function isRenderedPage(html) {
  const text = extractText(html);
  // Heuristic: if there is meaningful textual content (>200 chars) it's rendered
  return text.length > 200;
}

module.exports = {
  load,
  extractTables,
  extractKeyValuePairs,
  extractJsonScripts,
  extractLinks,
  extractMetadata,
  extractText,
  isRenderedPage,
};
