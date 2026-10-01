const fs = require('fs');
const path = require('path');
const HtmlTool = require('./src/tools/html/HtmlTool');
const DseTool = require('./src/tools/dse/DseTool');

const htmlPath = path.join('/Users/mac/.gemini/antigravity-ide/brain/3601ca51-32da-484a-8c30-1ca3f00e0946/.system_generated/steps/51/content.md');
let html = fs.readFileSync(htmlPath, 'utf8');

const nextData = DseTool.extractNextData(html);
if (nextData) {
  fs.writeFileSync('nextdata.json', JSON.stringify(nextData, null, 2));
  console.log('Next Data saved to nextdata.json');
} else {
  console.log('No next data found');
}
