const { test, expect } = require('@playwright/test');

test('App page loads and main UI elements are visible', async ({ page }) => {
  await page.goto('http://localhost:3000/app', { waitUntil: 'domcontentloaded' });

  // Basic title check
  const title = await page.title();
  expect(title).toBe('Fish Farmers Map');

  // Map container should be present and visible
  const map = page.locator('#map');
  await expect(map).toBeVisible({ timeout: 10000 });

  // Wait for the register tab button and open the register panel
  await page.waitForSelector('button.tab-button[data-target="register-tab"]', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.click('button.tab-button[data-target="register-tab"]');
  await page.waitForSelector('section#register-tab.active', { timeout: 10000 });
  await expect(page.locator('h2', { hasText: 'Register a Farmer' })).toBeVisible();

  // Check farmers tab separately
  await page.click('button.tab-button[data-target="farmers-tab"]');
  await page.waitForSelector('section#farmers-tab.active', { timeout: 10000 });
  await expect(page.locator('h2', { hasText: 'Registered Farmers' })).toBeVisible();
});
