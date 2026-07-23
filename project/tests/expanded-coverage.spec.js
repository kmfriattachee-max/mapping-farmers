const { test, expect } = require('@playwright/test');

const adminCredentials = {
  username: 'admin',
  password: 'password123'
};

test.describe('Expanded UI coverage', () => {
  test('Marketplace loads suppliers and applies filters', async ({ page }) => {
    await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });
    await page.waitForSelector('button.tab-button[data-target="marketplace-tab"]', { state: 'visible', timeout: 15000 });
    await page.click('button.tab-button[data-target="marketplace-tab"]');
    await page.waitForSelector('section#marketplace-tab.active', { timeout: 15000 });
    await page.waitForSelector('section#marketplace-tab.active #supplier-county-filter', { state: 'visible', timeout: 15000 });

    await page.waitForSelector('li.supplier-item', { timeout: 20000 });
    const supplierCount = await page.locator('li.supplier-item').count();
    expect(supplierCount).toBeGreaterThan(0);

    await page.selectOption('section#marketplace-tab.active #supplier-county-filter', 'Kisii');
    await page.waitForTimeout(600);
    const kisiiSupplierText = await page.locator('li.supplier-item').first().textContent();
    expect(kisiiSupplierText).toContain('Kisii');

    await page.selectOption('#supplier-species-filter', 'Tilapia');
    await page.waitForTimeout(600);
    const speciesText = await page.locator('li.supplier-item').first().textContent();
    expect(speciesText).toContain('Tilapia');

    await page.click('#supplier-refresh');
    await page.waitForTimeout(800);
    expect(await page.locator('li.supplier-item').count()).toBeGreaterThan(0);
  });

  test('Admin login authenticates and shows admin dashboard', async ({ page }) => {
    await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });
    await page.waitForSelector('button.tab-button[data-target="admin-tab"]', { state: 'visible', timeout: 15000 });
    await page.click('button.tab-button[data-target="admin-tab"]');
    await page.waitForSelector('section#admin-tab.active', { timeout: 15000 });
    await page.waitForSelector('#admin-login', { state: 'visible', timeout: 15000 });

    await page.fill('#admin-username', adminCredentials.username);
    await page.fill('#admin-password', adminCredentials.password);
    await page.click('#admin-login');

    await page.waitForSelector('#admin-dashboard-section', { state: 'visible', timeout: 15000 });
    await expect(page.locator('#admin-status')).toHaveText('Authenticated as admin');
    await expect(page.locator('#admin-dashboard-section')).toBeVisible();
  });

  test('Register form validation shows error when species are omitted', async ({ page }) => {
    await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });
    await page.waitForSelector('button.tab-button[data-target="register-tab"]', { state: 'visible', timeout: 15000 });
    await page.click('button.tab-button[data-target="register-tab"]');
    await page.waitForSelector('section#register-tab.active', { timeout: 15000 });
    await page.waitForSelector('#gender', { state: 'visible', timeout: 15000 });

    await page.fill('#name', 'Validation Farmer');
    await page.selectOption('#county', 'Homa Bay');
    await page.selectOption('#gender', 'Female');
    await page.fill('#latitude', '-0.528');
    await page.fill('#longitude', '34.453');
    await page.selectOption('#culture_system', 'Pond');
    await page.selectOption('#production_scale', 'Medium');
    await page.fill('#equipment-input', 'Nets');
    await page.click('#add-equipment');
    await page.fill('#contact', '0722000000');

    await page.click('button[type="submit"]');

    await expect(page.locator('#status')).toContainText('Please select at least one species.', { timeout: 10000 });
    await expect(page.locator('#species-error')).toContainText('Select at least one species to continue.', { timeout: 10000 });
  });
});
