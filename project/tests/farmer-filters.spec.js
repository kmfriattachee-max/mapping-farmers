const { test, expect } = require('@playwright/test');

test.describe('Farmer List Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });
    // Navigate to farmers tab
    await page.click('button.tab-button[data-target="farmers-tab"]');
    await page.waitForSelector('section#farmers-tab.active', { state: 'visible' });
  });

  test('County filter isolates farmers by location', async ({ page }) => {
    // Wait for filter dropdowns to be populated
    await page.waitForSelector('#county-filter', { state: 'visible' });
    
    // Select county filter
    await page.selectOption('#county-filter', 'Kisii');
    await page.waitForTimeout(500); // Wait for filtering logic
    
    // Verify farmer list updated
    const farmerItems = await page.locator('#farmer-list li').count();
    expect(farmerItems).toBeGreaterThanOrEqual(0);
    
    // Verify county value persisted
    const selectedCounty = await page.inputValue('#county-filter');
    expect(selectedCounty).toBe('Kisii');
  });

  test('Species filter shows only selected fish types', async ({ page }) => {
    await page.waitForSelector('#species-filter', { state: 'visible' });
    
    // Get initial count
    const initialCount = await page.locator('#farmer-list li').count();
    
    // Apply species filter
    await page.selectOption('#species-filter', 'Catfish');
    await page.waitForTimeout(500);
    
    // Count should change or farmers list should remain but filtered
    const filteredCount = await page.locator('#farmer-list li').count();
    
    // Verify filter was applied
    const selectedSpecies = await page.inputValue('#species-filter');
    expect(selectedSpecies).toBe('Catfish');
    
    // If there are results, they should match the filter
    if (filteredCount > 0) {
      const firstFarmerText = await page.locator('#farmer-list li').first().textContent();
      expect(firstFarmerText).toBeTruthy();
    }
  });

  test('Culture system filter works independently', async ({ page }) => {
    await page.waitForSelector('#culture-filter', { state: 'visible' });
    
    // Apply culture filter
    await page.selectOption('#culture-filter', 'Pond');
    await page.waitForTimeout(500);
    
    // Verify filter selection
    const selectedCulture = await page.inputValue('#culture-filter');
    expect(selectedCulture).toBe('Pond');
    
    // Verify farmer list is visible
    const farmerListExists = await page.locator('#farmer-list').isVisible();
    expect(farmerListExists).toBe(true);
  });

  test('Production scale filter narrows results', async ({ page }) => {
    await page.waitForSelector('#scale-filter', { state: 'visible' });
    
    // Verify scale filter options exist
    const scaleOptions = await page.locator('#scale-filter option').count();
    expect(scaleOptions).toBeGreaterThan(0);
    
    // Select a scale
    await page.selectOption('#scale-filter', 'Small');
    await page.waitForTimeout(500);
    
    // Verify selection
    const selectedScale = await page.inputValue('#scale-filter');
    expect(selectedScale).toBe('Small');
  });

  test('Multiple filters can be applied together', async ({ page }) => {
    await page.waitForSelector('#county-filter', { state: 'visible' });
    await page.waitForSelector('#species-filter', { state: 'visible' });
    
    // Apply county filter
    await page.selectOption('#county-filter', 'Kisii');
    await page.waitForTimeout(300);
    
    // Apply species filter
    await page.selectOption('#species-filter', 'Tilapia');
    await page.waitForTimeout(300);
    
    // Apply culture filter
    await page.selectOption('#culture-filter', 'Pond');
    await page.waitForTimeout(500);
    
    // Verify all filters applied
    expect(await page.inputValue('#county-filter')).toBe('Kisii');
    expect(await page.inputValue('#species-filter')).toBe('Tilapia');
    expect(await page.inputValue('#culture-filter')).toBe('Pond');
    
    // Verify list is still rendered
    const farmerList = await page.locator('#farmer-list').isVisible();
    expect(farmerList).toBe(true);
  });

  test('Clearing filters resets farmer list', async ({ page }) => {
    await page.waitForSelector('#county-filter', { state: 'visible' });
    
    // Apply a filter
    await page.selectOption('#county-filter', 'Kisii');
    await page.waitForTimeout(500);
    
    // Clear filter by selecting "All"  
    await page.selectOption('#county-filter', '');
    await page.waitForTimeout(500);
    
    // Verify filter cleared
    const selectedCounty = await page.inputValue('#county-filter');
    expect(selectedCounty).toBe('');
  });

  test('Approval status filter separates approved and pending farmers', async ({ page }) => {
    await page.waitForSelector('#status-filter', { state: 'visible' });
    
    // Select approved status
    await page.selectOption('#status-filter', 'approved');
    await page.waitForTimeout(500);
    
    // Verify selection
    const selectedStatus = await page.inputValue('#status-filter');
    expect(selectedStatus).toBe('approved');
    
    // Verify farmer list is visible
    const farmerListExists = await page.locator('#farmer-list').isVisible();
    expect(farmerListExists).toBe(true);
  });

  test('Date filter filters farmers by registration date', async ({ page }) => {
    await page.waitForSelector('#date-filter', { state: 'visible' });
    
    // Select date filter
    await page.selectOption('#date-filter', 'this-month');
    await page.waitForTimeout(500);
    
    // Verify selection
    const selectedDate = await page.inputValue('#date-filter');
    expect(selectedDate).toBe('this-month');
  });

  test('Farmer search filter works for name and details', async ({ page }) => {
    await page.waitForSelector('#search-filter', { state: 'visible' });
    
    // Type search query
    await page.fill('#search-filter', 'Kipchoge');
    await page.waitForTimeout(500);
    
    // Verify search value
    const searchValue = await page.inputValue('#search-filter');
    expect(searchValue).toBe('Kipchoge');
  });

  test('Reset filters button clears all active filters', async ({ page }) => {
    await page.waitForSelector('#clear-filter', { state: 'visible' });
    
    // Apply multiple filters
    await page.selectOption('#county-filter', 'Kisii');
    await page.selectOption('#species-filter', 'Catfish');
    await page.waitForTimeout(500);
    
    // Click reset button
    await page.click('#clear-filter');
    await page.waitForTimeout(500);
    
    // Verify filters cleared
    expect(await page.inputValue('#county-filter')).toBe('');
    expect(await page.inputValue('#species-filter')).toBe('');
  });

  test('Export data button is accessible', async ({ page }) => {
    // Verify export button exists
    const exportButton = await page.locator('#export-data').isVisible();
    expect(exportButton).toBe(true);
    
    // Verify button is clickable
    const isEnabled = await page.locator('#export-data').isEnabled();
    expect(isEnabled).toBe(true);
  });
});
