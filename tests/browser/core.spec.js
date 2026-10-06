const { test: base, expect, chromium } = require('@playwright/test');
const { fixtureResponse } = require('../fixture-server');

// Default: Playwright launches its own standalone headless Chromium. The suite never
// attaches to a user-visible shared browser (e.g. the Factory Desktop pane), even when
// AGENT_BROWSER_CDP is present in the environment.
// Escape hatch: set PW_USE_CDP=1 to run against a CDP endpoint from AGENT_BROWSER_CDP.
// That path opens a fresh isolated context (browser.newContext) and never touches
// existing contexts, tabs, or pages owned by the host browser.
const test = process.env.PW_USE_CDP === '1' && process.env.AGENT_BROWSER_CDP
  ? base.extend({
    page: async ({}, use) => {
      const browser = await chromium.connectOverCDP(process.env.AGENT_BROWSER_CDP);
      const context = await browser.newContext();
      const page = await context.newPage();
      await use(page);
      await context.close();
      // Never close the host-owned browser.
    }
  })
  : base;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('campin.saved.v1'));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.runSearch === 'function');
});

async function search(page, query = 'tent campground near Seattle for 2 guests') {
  await page.locator('#main-search').fill(query);
  await page.locator('#main-search').press('Enter');
  await expect(page.locator('#results-count')).toHaveText('1 campground listings found');
}

test('search, full-stay availability, accessible detail, and provider handoff', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const months = new Set();
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/availability/')) months.add(url.searchParams.get('start_date'));
  });
  await page.locator('#trip-checkin').fill('2099-01-31');
  await page.locator('#trip-checkout').fill('2099-02-02');
  await search(page);
  await expect(page.locator('#results-grid')).toContainText('available for the full stay');
  await expect(page.locator('#results-grid')).toContainText('From $22.75');
  await expect(page.locator('#results-grid')).toContainText('Rating unavailable');
  expect([...months].sort()).toEqual(['2099-01-01T00:00:00.000Z', '2099-02-01T00:00:00.000Z']);
  const card = page.getByRole('button', { name: 'Fixture Creek Campground', exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-detail')).toHaveClass(/active/);
  await expect(page.locator('#d-booking-price')).toContainText('22.75');
  await expect(page.locator('#availability-check-note')).toContainText('Checked');
  await expect(page.locator('#d-reviews')).toContainText('Google Reviews unavailable');
  // Capture the handoff without navigating or submitting a real reservation.
  await page.evaluate(() => { window.open = url => { window.__bookingTarget = url; return {}; }; });
  await page.getByRole('button', { name: 'Book on Recreation.gov' }).click();
  const target = new URL(await page.evaluate(() => window.__bookingTarget));
  expect(target.origin).toBe('https://www.recreation.gov');
  expect(target.searchParams.get('checkin')).toBe('2099-01-31');
  expect(target.searchParams.get('checkout')).toBe('2099-02-02');
  await page.getByRole('button', { name: 'Back to listings' }).click();
  await expect(page.locator('#view-results')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('hard requirements are explained separately and saves survive reload', async ({ page }) => {
  await search(page, 'dog-friendly tent campground near Seattle for 2 guests');
  await expect(page.locator('#results-grid')).toContainText('Alternatives, requirements unmet or unverified');
  await expect(page.locator('#results-grid')).toContainText('dogs allowed: not verified');
  await page.getByRole('button', { name: 'Save Fixture Creek Campground', exact: true }).click();
  await page.goto('/');
  await search(page);
  await expect(page.getByRole('button', { name: 'Unsave Fixture Creek Campground', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('changing dates invalidates old availability and rejects reversed stays', async ({ page }) => {
  await search(page);
  await page.getByRole('button', { name: 'Fixture Creek Campground', exact: true }).click();
  await page.locator('#checkin-date').fill('2099-02-04');
  await page.locator('#checkout-date').fill('2099-02-03');
  await expect(page.locator('#detail-book-btn')).toBeDisabled();
  await expect(page.locator('#detail-book-note')).toContainText('Check-out must be after check-in');
  await expect(page.locator('#d-alert-banner')).toContainText('Choose dates');
  await page.locator('#checkout-date').fill('2099-02-06');
  await page.getByRole('button', { name: 'Recheck availability' }).click();
  await expect(page.locator('#d-alert-banner')).toContainText('2099-02-04 to 2099-02-06');
  await expect(page.locator('#trip-checkin')).toHaveValue('2099-02-04');
});

test('provider outages show retry rather than fabricated demo listings', async ({ page }) => {
  await page.route('**/api/ridb/facilities?*', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.route('**/api/nps/campgrounds?*', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.locator('#main-search').fill('tent near Seattle');
  await page.locator('#main-search').press('Enter');
  await expect(page.getByRole('button', { name: 'Retry search' })).toBeVisible();
  await expect(page.locator('#results-grid .camp-card')).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.locator('#results-count')).toHaveText('1 campground listings found');
});

test('superseded searches cannot overwrite newer requests', async ({ page }) => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let intentRequests = 0;
  await page.route('**/api/intent/parse', async route => {
    intentRequests += 1;
    // Hold only the first search's request. Later re-searches carry composed queries
    // ("<old>. Updated request: <new>"), so blocking by query text would stall them too.
    if (intentRequests === 1) await blocked;
    await route.fulfill({ json: fixtureResponse(new URL(route.request().url())) }).catch(() => {});
  });
  await page.locator('#main-search').fill('slow request near Seattle');
  await page.locator('#main-search').press('Enter');
  await expect(page.locator('#view-results')).toHaveClass(/active/);
  await page.locator('#results-search-input').fill('tent campground near Seattle');
  await page.locator('#results-search-input').press('Enter');
  await expect(page.locator('#results-count')).toHaveText('1 campground listings found');
  release();
  await expect(page.locator('#results-grid .camp-card')).toHaveCount(1);
  await page.unrouteAll({ behavior: 'wait' });
});

test('Explore loads enriched inventory and returns to its own listings with mobile layout intact', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.locator('#explore-grid .camp-card')).toHaveCount(30);
  await expect(page.locator('#explore-grid')).toContainText('Tent-friendly');
  await expect(page.locator('#explore-grid')).toContainText('RV-friendly');
  await expect(page.locator('#explore-grid')).toContainText('From $24.5');
  await page.getByRole('button', { name: 'Yosemite Creek Campground', exact: true }).click();
  await page.getByRole('button', { name: 'Back to listings' }).click();
  await expect(page.locator('#view-explore')).toHaveClass(/active/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
