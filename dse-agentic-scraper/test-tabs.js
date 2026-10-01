const { chromium } = require('playwright');
const url = 'https://www.dse.com.bd/company/MATINSPINN';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  
  console.log('Page loaded, getting buttons/tabs...');
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a.nav-link, .tab, [role="tab"]')).map(el => ({
      text: el.innerText.trim(),
      className: el.className,
      id: el.id
    })).filter(b => b.text.length > 0);
  });
  
  console.log(JSON.stringify(buttons, null, 2));
  await browser.close();
})();
