# Project State — Peterson Small Engine Repair

## Goal
Fix mobile hero carousel layout where content overflows and gets clipped on mobile devices (eyebrow badge cut off at the top, "Call" button cut off by overlapping `#trust` section at the bottom).

## What changed
- Identified and fixed root cause in `site/style.css`:
  - Migrated `#hero` carousel and `.slide` elements from `position: absolute` to modern CSS Grid stacking (`grid-template-areas: "hero-slide"`).
  - The hero container now naturally expands to fit the tallest slide content in the normal document flow on mobile instead of collapsing to a fixed 500px min-height.
  - Added `visibility: hidden; pointer-events: none;` to inactive slides to prevent phantom clicks.
  - Optimized mobile typography (`font-size: 1.85rem` for titles, `1rem` for description) and spacing (`padding: 36px 20px 92px` on `.slide-content`) so the top eyebrow badge is completely clear of the nav, and the bottom "Call" button is 52px above the overlapping `#trust` section.
  - Standardized mobile button sizing (`width: 100%; max-width: 290px`) and improved overlay contrast (`linear-gradient(to bottom, ...)`).
  - Positioned `.carousel-dots` at `bottom: 52px` so they sit comfortably above `#trust`'s -40px curved overlap.
  - Bumped stylesheet query version to `style.css?v=1.0.10` in `site/index.html` and `site/404.html` to bust Cloudflare Pages & mobile browser HTTP caches.

## Commands run + results
- `npm run check`: ESLint clean across backend, site, and parts-manager; Vitest 61/61 tests passed.
- `git diff site`: Confirmed all CSS changes and cache-busting version bumps.

## Files touched
- `site/style.css`
- `site/index.html`
- `site/404.html`
- `PROJECT_STATE.md`

## Next 3 actions
- [x] Refactor hero carousel layout in `site/style.css` to use CSS Grid so container height automatically grows to fit mobile content without clipping.
- [x] Update mobile typography, spacing, and button width, and bump `style.css?v=1.0.10` in `site/index.html` and `site/404.html`.
- [ ] User review and mobile device verification.
