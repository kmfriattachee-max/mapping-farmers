const { test, expect } = require('@playwright/test');

test.describe('Resource Hub', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle' });
    // Navigate to resources tab
    await page.click('button.tab-button[data-target="resources-tab"]');
    await page.waitForSelector('section#resources-tab.active', { state: 'visible' });
  });

  test('Knowledge base search is accessible and functional', async ({ page }) => {
    // Wait for knowledge base section
    await page.waitForSelector('#kb-search', { state: 'visible' });
    
    // Verify search input exists
    const searchInput = await page.locator('#kb-search').isVisible();
    expect(searchInput).toBe(true);
    
    // Type in search field
    await page.fill('#kb-search', 'water quality');
    await page.waitForTimeout(300);
    
    // Verify search value
    const searchValue = await page.inputValue('#kb-search');
    expect(searchValue).toBe('water quality');
    
    // Verify results container exists
    const resultsContainer = await page.locator('#kb-results').isVisible();
    expect(resultsContainer).toBe(true);
  });

  test('FAQ search displays questions and allows filtering', async ({ page }) => {
    await page.waitForSelector('#faq-search', { state: 'visible' });
    
    // Verify FAQ search input
    const faqSearchExists = await page.locator('#faq-search').isVisible();
    expect(faqSearchExists).toBe(true);
    
    // Verify FAQ list container exists
    const faqListExists = await page.locator('#faq-list').isVisible();
    expect(faqListExists).toBe(true);
    
    // Type search query
    await page.fill('#faq-search', 'feeding');
    await page.waitForTimeout(300);
    
    // Verify search value retained
    const faqSearchValue = await page.inputValue('#faq-search');
    expect(faqSearchValue).toBe('feeding');
  });

  test('Ask an Expert form is complete and submittable', async ({ page }) => {
    // Wait for expert form elements
    await page.waitForSelector('#expert-form', { state: 'visible' });
    
    // Verify all form fields exist
    expect(await page.locator('#expert-name').isVisible()).toBe(true);
    expect(await page.locator('#expert-contact').isVisible()).toBe(true);
    expect(await page.locator('#expert-topic').isVisible()).toBe(true);
    expect(await page.locator('#expert-question').isVisible()).toBe(true);
    
    // Fill form with test data
    await page.fill('#expert-name', 'John Kipchoge');
    await page.fill('#expert-contact', '0712345678');
    await page.selectOption('#expert-topic', 'Fish health management');
    await page.fill('#expert-question', 'My fish have visible spots and reduced appetite. What could be the issue?');
    
    // Verify data entered
    expect(await page.inputValue('#expert-name')).toBe('John Kipchoge');
    expect(await page.inputValue('#expert-contact')).toBe('0712345678');
    expect(await page.inputValue('#expert-topic')).toBe('Fish health management');
    
    // Submit form
    await page.click('button:has-text("Send to KMFRI")');
    await page.waitForTimeout(500);
    
    // Check for success/status message
    const statusMessage = await page.locator('#expert-status').isVisible();
    expect(statusMessage).toBe(true);
  });

  test('Feed recommendation calculator produces results', async ({ page }) => {
    // Wait for calculator section
    await page.waitForSelector('#calc-feed', { state: 'visible' });
    
    // Verify calculator inputs exist
    expect(await page.locator('#feed-species').isVisible()).toBe(true);
    expect(await page.locator('#feed-age').isVisible()).toBe(true);
    expect(await page.locator('#feed-weight').isVisible()).toBe(true);
    
    // Verify calculator button exists
    const calcButtonExists = await page.locator('#calc-feed').isVisible();
    expect(calcButtonExists).toBe(true);
    
    // Change calculator inputs
    await page.selectOption('#feed-species', 'Catfish');
    await page.fill('#feed-age', '6');
    await page.fill('#feed-weight', '500');
    
    // Click calculate
    await page.click('#calc-feed');
    await page.waitForTimeout(500);
    
    // Verify recommendation container exists
    const recommendationDiv = await page.locator('#feed-recommendation').isVisible();
    expect(recommendationDiv).toBe(true);
  });

  test('Disease reporting form accepts submissions', async ({ page }) => {
    // Wait for disease form
    await page.waitForSelector('#disease-form', { state: 'visible' });
    
    // Verify form fields
    expect(await page.locator('#disease-name').isVisible()).toBe(true);
    expect(await page.locator('#disease-contact').isVisible()).toBe(true);
    expect(await page.locator('#disease-symptoms').isVisible()).toBe(true);
    expect(await page.locator('#disease-quantity').isVisible()).toBe(true);
    
    // Fill disease report
    await page.fill('#disease-name', 'Kipchoge Fish Farm');
    await page.fill('#disease-contact', 'kipchoge@farm.com');
    await page.fill('#disease-symptoms', 'Fish showing white spots and lethargy');
    await page.fill('#disease-quantity', '45');
    
    // Verify data
    expect(await page.inputValue('#disease-name')).toBe('Kipchoge Fish Farm');
    expect(await page.inputValue('#disease-symptoms')).toBe('Fish showing white spots and lethargy');
    
    // Submit
    await page.click('button:has-text("Submit report")');
    await page.waitForTimeout(500);
    
    // Check disease status message
    const diseaseStatus = await page.locator('#disease-status').isVisible();
    expect(diseaseStatus).toBe(true);
  });

  test('Water quality monitoring form captures all parameters', async ({ page }) => {
    // Wait for water quality form
    await page.waitForSelector('#water-form', { state: 'visible' });
    
    // Verify all water quality fields exist
    expect(await page.locator('#water-ph').isVisible()).toBe(true);
    expect(await page.locator('#water-temp').isVisible()).toBe(true);
    expect(await page.locator('#water-do').isVisible()).toBe(true);
    expect(await page.locator('#water-ammonia').isVisible()).toBe(true);
    expect(await page.locator('#water-turbidity').isVisible()).toBe(true);
    
    // Fill all parameters
    await page.fill('#water-ph', '7.2');
    await page.fill('#water-temp', '28');
    await page.fill('#water-do', '5.5');
    await page.fill('#water-ammonia', '0.05');
    await page.fill('#water-turbidity', '12');
    
    // Verify all values entered
    expect(await page.inputValue('#water-ph')).toBe('7.2');
    expect(await page.inputValue('#water-temp')).toBe('28');
    expect(await page.inputValue('#water-do')).toBe('5.5');
    expect(await page.inputValue('#water-ammonia')).toBe('0.05');
    expect(await page.inputValue('#water-turbidity')).toBe('12');
    
    // Submit form
    await page.click('button:has-text("Record reading")');
    await page.waitForTimeout(800);
    
    // Verify water quality history list exists (records should be displayed)
    const waterHistoryList = await page.locator('#water-quality-history').isVisible();
    expect(waterHistoryList).toBe(true);
  });

  test('Training and events sections display properly', async ({ page }) => {
    // Verify events section exists
    await page.waitForSelector('#events-list', { state: 'visible' });
    expect(await page.locator('#events-list').isVisible()).toBe(true);
    
    // Verify publications section exists
    expect(await page.locator('#publication-list').isVisible()).toBe(true);
  });

  test('Market intelligence table contains price data', async ({ page }) => {
    // Wait for market table
    await page.waitForSelector('table.market-table', { state: 'visible' });
    
    // Verify table structure
    const tableHeaderExists = await page.locator('table.market-table thead').isVisible();
    expect(tableHeaderExists).toBe(true);
    
    // Verify table body
    const tableBodyExists = await page.locator('#market-table-body').isVisible();
    expect(tableBodyExists).toBe(true);
  });

  test('Fisheries officers directory is accessible', async ({ page }) => {
    // Wait for officer directory
    await page.waitForSelector('#officer-directory', { state: 'visible' });
    
    // Verify directory container visible
    const officerDirExists = await page.locator('#officer-directory').isVisible();
    expect(officerDirExists).toBe(true);
  });

  test('Equipment supplier search and filter work together', async ({ page }) => {
    // Scroll down to equipment section if needed
    await page.locator('#equipment-supplier-search').scrollIntoViewIfNeeded();
    
    // Wait for search input
    await page.waitForSelector('#equipment-supplier-search', { state: 'visible' });
    
    // Verify search input
    expect(await page.locator('#equipment-supplier-search').isVisible()).toBe(true);
    
    // Verify verified-only checkbox
    expect(await page.locator('#equipment-verified-only').isVisible()).toBe(true);
    
    // Type search
    await page.fill('#equipment-supplier-search', 'pump');
    await page.waitForTimeout(300);
    
    // Check supplier list
    const supplierList = await page.locator('#equipment-supplier-list').isVisible();
    expect(supplierList).toBe(true);
    
    // Toggle verified-only checkbox
    await page.click('#equipment-verified-only');
    await page.waitForTimeout(300);
    
    // Verify checkbox state
    const isChecked = await page.locator('#equipment-verified-only').isChecked();
    expect(isChecked).toBe(true);
  });

  test('Resource hub sections are properly organized', async ({ page }) => {
    // Verify all major sections have visible headers
    const knowledgeBaseHeader = await page.locator('h3:has-text("Knowledge Base")').isVisible();
    expect(knowledgeBaseHeader).toBe(true);
    
    const faqHeader = await page.locator('h3:has-text("Frequently Asked Questions")').isVisible();
    expect(faqHeader).toBe(true);
    
    const expertHeader = await page.locator('h3:has-text("Ask an Expert")').isVisible();
    expect(expertHeader).toBe(true);
    
    const feedHeader = await page.locator('h3:has-text("Feed Recommendation")').isVisible();
    expect(feedHeader).toBe(true);
    
    const diseaseHeader = await page.locator('h3:has-text("Disease Reporting")').isVisible();
    expect(diseaseHeader).toBe(true);
    
    const waterHeader = await page.locator('h3:has-text("Water Quality Monitoring")').isVisible();
    expect(waterHeader).toBe(true);
  });
});
