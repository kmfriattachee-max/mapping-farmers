const { test, expect } = require('@playwright/test');

const sampleFarmer = {
  name: 'Test Farmer UI',
  county: 'Kisii',
  gender: 'Male',
  latitude: '-0.670000',
  longitude: '34.770000',
  cultureSystem: 'Pond',
  productionScale: 'Small',
  equipment: 'Pumps, Nets',
  contact: '0712345678'
};

test('Register farmer form is submittable and shows success', async ({ page }) => {
  await page.goto('http://localhost:3000/app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button.tab-button[data-target="register-tab"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.click('button.tab-button[data-target="register-tab"]');
  await page.waitForSelector('section#register-tab.active', { timeout: 10000 });
  await page.waitForSelector('#name:visible', { timeout: 10000 });

  await page.locator('#name').fill(sampleFarmer.name);
  await page.selectOption('#county', sampleFarmer.county);
  await page.selectOption('#gender', sampleFarmer.gender);
  await page.fill('#latitude', sampleFarmer.latitude);
  await page.fill('#longitude', sampleFarmer.longitude);
  await page.check('input[name="species"][value="Tilapia"]');
  await page.selectOption('#culture_system', sampleFarmer.cultureSystem);
  await page.selectOption('#production_scale', sampleFarmer.productionScale);
  await page.fill('#equipment-input', sampleFarmer.equipment);
  await page.click('#add-equipment');
  await page.fill('#contact', sampleFarmer.contact);

  const registerButton = page.locator('button[type="submit"]', { hasText: 'Register Farmer' });
  await expect(registerButton).toBeVisible();

  await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/farmers') && res.status() >= 200 && res.status() < 300, { timeout: 20000 }),
    registerButton.click(),
  ]);

  await expect(page.locator('#status')).toContainText('Farmer registered', { timeout: 20000 });
});
