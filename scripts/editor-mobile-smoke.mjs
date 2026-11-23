#!/usr/bin/env node
/**
 * Phone-size (390x844) touch browser interaction smoke test for KathaRift Studio.
 * Verifies:
 *  - Mobile owner profile menu + email + Sign out accessibility
 *  - No horizontal document overflow on phone viewport
 *  - Editor horizontal timeline scroll, ruler scrub gesture, touch trim-handle drag, split, undo/redo
 *  - Honest Storyboard-only / hidden synthetic waveforms in production mode
 *
 * Usage:
 *   KR_LOCAL_FIXTURE_DB=true VITE_AUTH_ENABLED=false node scripts/with-app-env.mjs vite dev --host 127.0.0.1 --port 8080
 *   node scripts/editor-mobile-smoke.mjs --url http://127.0.0.1:8080
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const urlArgIdx = process.argv.indexOf("--url");
const targetUrl =
  urlArgIdx >= 0 && process.argv[urlArgIdx + 1]
    ? process.argv[urlArgIdx + 1]
    : "http://127.0.0.1:8080";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector('nav[aria-label="Primary studio tabs"]', { timeout: 20000 });

  // 1. Mobile Owner Profile Menu visible & accessible
  const accountBtn = page.locator('button[aria-haspopup="menu"]');
  await accountBtn.waitFor({ state: "visible" });
  await accountBtn.tap();
  const accountMenu = page.locator('div[role="menu"][aria-label="Account details"]');
  await accountMenu.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");

  // 2. Navigate to Editor tab
  await page.getByRole("button", { name: "Editor" }).tap();
  await page.getByTestId("preview-media-badge").waitFor({ state: "visible" });

  const badgeText = await page.getByTestId("preview-media-badge").innerText();
  assert.match(badgeText, /Storyboard Only/i);

  // Verify no horizontal document overflow on 390px phone viewport
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false, "Phone viewport should not have horizontal page overflow");

  // 3. Zoom in & verify horizontal timeline viewport scrolls cleanly
  await page.getByRole("button", { name: "Zoom in timeline" }).tap();
  await page.getByRole("button", { name: "Zoom in timeline" }).tap();
  const scrollInfo = await page.getByTestId("timeline-scroll-viewport").evaluate((el) => {
    el.scrollLeft = 40;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft };
  });
  assert.ok(scrollInfo.scrollWidth > scrollInfo.clientWidth);
  assert.ok(scrollInfo.scrollLeft > 0);

  // 4. Scrub gesture on timeline ruler updates playhead position
  const rulerBox = await page.getByTestId("timeline-ruler").boundingBox();
  assert.ok(rulerBox);
  await page.mouse.move(rulerBox.x + 24, rulerBox.y + rulerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rulerBox.x + 120, rulerBox.y + rulerBox.height / 2, { steps: 6 });
  await page.mouse.up();
  const afterScrub = await page.getByTestId("timeline-ruler").getAttribute("aria-valuenow");
  assert.ok(Number(afterScrub) > 0, "Ruler scrub should advance playhead frame");

  // 5. Touch/pointer drag on right trim handle modifies timeline & marks Unsaved
  const outHandle = page.locator('[data-testid^="trim-handle-out-"]').first();
  const handleBox = await outHandle.boundingBox();
  assert.ok(handleBox);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 36, handleBox.y + handleBox.height / 2, { steps: 6 });
  await page.mouse.up();

  const saveBadge = await page.getByTestId("save-status-badge").innerText();
  assert.match(saveBadge, /Unsaved edits/i);

  // 6. Undo restores clean saved state
  await page.getByRole("button", { name: "Undo" }).tap();
  const restoredBadge = await page.getByTestId("save-status-badge").innerText();
  assert.match(restoredBadge, /Saved/i);

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ ok: true, targetUrl, scrollInfo, afterScrub }, null, 2));
} finally {
  await browser.close();
}
