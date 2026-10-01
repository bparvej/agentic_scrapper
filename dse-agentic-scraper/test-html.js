const fs = require('fs');
const DseTool = require('./src/tools/dse/DseTool');
const HtmlTool = require('./src/tools/html/HtmlTool');
const htmlStrategy = require('./src/extraction/strategies/htmlStrategy');
const logger = require('./src/logging/logger');

// Disable noisy logs
logger.level = 'error';

async function test() {
  try {
    const symbol = 'BATBC';
    console.log(`Fetching ${symbol} financials...`);
    // Hack fetch for test
    const { fetchUrl } = require('./src/tools/http/HttpTool');
    const fetchResult = await fetchUrl(`https://dse.com.bd/company/${symbol}?tab=financials`);
    const page = { html: fetchResult.data, isRendered: true };
    console.log(`Fetched ${page.html.length} bytes.`);
    
    // Check if it's considered rendered
    console.log(`Is rendered page? ${page.isRendered}`);
    
    // Dump raw HTML to a file just in case we need to inspect it
    fs.writeFileSync('test_debug.html', page.html);
    
    const result = htmlStrategy.extract(page.html, symbol);
    
    console.log('\n--- EXTRACTION RESULT ---');
    console.log(JSON.stringify(result.data, null, 2));
    console.log('\nWarnings:', result.warnings);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
