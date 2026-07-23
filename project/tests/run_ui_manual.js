const playwright = require('playwright');

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const url = 'http://localhost:3000/app';
    console.log('Visiting', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for main elements
    await page.waitForSelector('#map', { timeout: 10000 });
    const hasRegister = await page.locator('text=Register a Farmer').count();
    const hasFarmers = await page.locator('text=Registered Farmers').count();

    const result = {
      mapVisible: await page.isVisible('#map'),
      registerVisible: hasRegister > 0,
      farmersVisible: hasFarmers > 0,
      title: await page.title()
    };

    console.log(JSON.stringify({ success: true, result }, null, 2));
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ success: false, error: String(e) }, null, 2));
    try { await browser.close(); } catch (__) {}
    process.exit(2);
  }
})();
