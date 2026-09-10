// tools/verify-ui.mjs — geometry verification harness for site/
//
// Why this exists: we shipped a mobile hero bug (the eyebrow badge was hidden
// behind the fixed nav and the "Call" button was sliced by #trust) that no lint,
// unit test, or curl check could see. Screenshots are not enough either, because
// the agent cannot interpret images in this environment.
//
// So this measures the DOM instead: it drives a real browser at real mobile
// viewports and asserts the layout invariants that bug violated. Failures print
// the actual pixel values, so the output is readable by a human and an agent.
//
// Usage:
//   npm run verify:ui                          # against production
//   npm run verify:ui -- http://localhost:8788 # against a local server
//   npm run verify:ui -- <url> --shots ./ui-shots
//
// Deliberately NOT part of `npm run check`: it needs a browser and network, and
// the pre-commit hook must keep passing offline.
//
// It drives the system-installed Chrome (or set UI_BROWSER=msedge) via a
// Playwright "channel", so no browser binaries are downloaded.

import { chromium } from 'playwright-core';
import { measure } from './page-measure.mjs';

const DEFAULT_URL = 'https://petersonsmallenginerepair.com/';
const CHANNEL = process.env.UI_BROWSER || 'chrome';

const args = process.argv.slice(2);
const shotsIndex = args.indexOf('--shots');
const shotsDir = shotsIndex !== -1 ? args[shotsIndex + 1] : null;
const url = args.find((a) => !a.startsWith('--') && a !== shotsDir) || DEFAULT_URL;

// Mobile widths worth covering: iPhone 13/14, iPhone SE, and a small Android.
const VIEWPORTS = [
  { name: 'iPhone-13', width: 390, height: 844, mobile: true },
  { name: 'iPhone-SE', width: 375, height: 667, mobile: true },
  { name: 'Android-small', width: 360, height: 740, mobile: true },
  { name: 'Desktop-1440', width: 1440, height: 900, mobile: false },
];

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ channel: CHANNEL });
  } catch (e) {
    console.error(`Could not launch browser channel "${CHANNEL}": ${e.message}`);
    console.error('Install Chrome/Edge, or set UI_BROWSER=msedge. No browser download is needed.');
    process.exit(2);
  }

  let failures = 0;
  console.log(`verify-ui: ${url}  (browser channel: ${CHANNEL})`);

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    // Turnstile holds a connection open, so 'networkidle' never settles.
    await page.waitForTimeout(Number(process.env.UI_SETTLE_MS || 2500));

    const m = await page.evaluate(measure);
    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok, detail });

    if (vp.mobile) {
      // Bug 1: the eyebrow badge was clipped behind the fixed nav.
      check('eyebrow clears the fixed nav', m.eyebrow.top >= m.nav.bottom,
        `eyebrow.top=${m.eyebrow.top} nav.bottom=${m.nav.bottom} gap=${m.eyebrow.top - m.nav.bottom}px`);
      // Bug 2: #trust (margin-top:-40px) sliced through the Call button.
      check('Call button clear of #trust', m.callBtn.bottom <= m.trust.top,
        `callBtn.bottom=${m.callBtn.bottom} trust.top=${m.trust.top} gap=${m.trust.top - m.callBtn.bottom}px`);
      check('dots clear of #trust', m.dots.bottom <= m.trust.top,
        `dots.bottom=${m.dots.bottom} trust.top=${m.trust.top} gap=${m.trust.top - m.dots.bottom}px`);
      // Bug 3 (the general form): #hero is overflow:hidden, so content taller
      // than the box is silently clipped rather than reported.
      check('hero content is not clipped', m.heroOverflow <= 1,
        `hero scrollHeight exceeds clientHeight by ${m.heroOverflow}px`);
    }

    check('no horizontal overflow', m.scrollWidth <= m.innerWidth + 1,
      `scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth}`);
    check('hero uses the grid carousel', m.heroDisplay === 'grid', `#hero display=${m.heroDisplay}`);
    check('first slide has a real background <img>', m.firstSlideHasImg, 'img.slide-bg');
    check('exactly one h1', m.h1Count === 1, `h1=${m.h1Count}`);
    check('exactly one active slide', m.activeSlides === 1,
      `${m.activeSlides} active of ${m.slidesInDom} in DOM`);

    failures += checks.filter((c) => !c.ok).length;
    console.log(`\n  ${vp.name} (${vp.width}x${vp.height})`);
    for (const c of checks) console.log(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);

    if (shotsDir) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(shotsDir, { recursive: true });
      const file = `${shotsDir}/${vp.name}-${vp.width}x${vp.height}.png`;
      await page.screenshot({ path: file });
      console.log(`    shot  ${file}`);
    }
    await page.close();
  }

  await browser.close();
  console.log(failures === 0 ? '\nverify-ui: ALL CHECKS PASSED' : `\nverify-ui: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
