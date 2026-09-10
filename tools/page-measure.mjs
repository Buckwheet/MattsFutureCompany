// tools/page-measure.mjs
//
// This module is BROWSER-SIDE. It is serialised by Playwright and executed inside
// the page (see page.evaluate in verify-ui.mjs), so it must stay self-contained:
// no imports, no closure over anything in the Node process. It is also why this
// file is linted with browser globals while the rest of tools/ gets Node globals.
//
// Returns a plain object of measurements for the layout invariants we care about.
export function measure() {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      left: Math.round(b.left),
      right: Math.round(b.right),
    };
  };

  const hero = document.querySelector('#hero');
  const firstSlide = document.querySelector('#hero .slide');

  return {
    nav: rect('nav'),
    hero: rect('#hero'),
    // The always-present first slide, not .slide.active — the carousel advances
    // every 7s, so asserting on .active would be timing-dependent.
    eyebrow: rect('#hero .slide .eyebrow'),
    callBtn: rect('#hero .slide .btn-secondary'),
    trust: rect('#trust'),
    dots: rect('.carousel-dots'),
    // scrollHeight > clientHeight on an overflow:hidden box means the content is
    // being CLIPPED, which is exactly what the mobile hero bug did.
    heroOverflow: hero ? hero.scrollHeight - hero.clientHeight : 0,
    heroDisplay: hero ? getComputedStyle(hero).display : null,
    firstSlideHasImg: !!firstSlide?.querySelector('img.slide-bg'),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    h1Count: document.querySelectorAll('h1').length,
    activeSlides: document.querySelectorAll('.slide.active').length,
    slidesInDom: document.querySelectorAll('.slide').length,
  };
}
