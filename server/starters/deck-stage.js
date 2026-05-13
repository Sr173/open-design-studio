/* deck-stage — slide deck scaffolding (auto-fit + keyboard nav + print)
 *
 * Usage:
 *   <link rel="stylesheet" href="../shared/deck.css">
 *   <body>
 *     <section class="slide"> ... slide 1 ... </section>
 *     <section class="slide"> ... slide 2 ... </section>
 *     ...
 *     <script src="../shared/deck-stage.js"></script>
 *   </body>
 *
 * Each <section class="slide"> is designed at 1280×720 and auto-scales to fit viewport.
 * Keyboard: ← → space PgDn/PgUp navigate. f toggles fullscreen. p triggers print (PDF export).
 * URL hash #2 jumps to slide 2 (1-indexed). Hash kept in sync as user navigates.
 *
 * Speaker notes: <aside class="notes"> inside a slide. Hidden by default; press n to toggle.
 * Pressing s opens speaker view in a new tab (current + notes + next preview).
 */

(function () {
  'use strict';

  const STAGE_W = 1280;
  const STAGE_H = 720;

  const slides = Array.from(document.querySelectorAll('section.slide'));
  if (slides.length === 0) {
    console.warn('[deck-stage] no <section class="slide"> elements found');
    return;
  }

  // === Inject base styles (idempotent) ===
  const styleId = '__deck_stage_styles';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      html, body { margin:0; padding:0; height:100%; overflow:hidden; background:#0a0a0a; }
      section.slide {
        position: absolute; inset: 0;
        width: ${STAGE_W}px; height: ${STAGE_H}px;
        transform-origin: top left;
        background: #fff;
        opacity: 0; pointer-events: none;
        transition: opacity 240ms ease;
        box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      }
      section.slide.active { opacity: 1; pointer-events: auto; }
      section.slide .notes { display: none; }
      section.slide.show-notes .notes {
        display: block;
        position: absolute; left: 24px; bottom: 24px; right: 24px;
        background: rgba(0,0,0,0.85); color: #fff;
        padding: 12px 16px; border-radius: 8px;
        font: 14px/1.5 system-ui;
      }
      .deck-counter {
        position: fixed; bottom: 12px; right: 16px;
        font: 12px system-ui; color: rgba(255,255,255,0.4);
        z-index: 100; pointer-events: none;
      }
      @media print {
        html, body { background: #fff; overflow: visible; }
        section.slide {
          position: relative !important;
          opacity: 1 !important; pointer-events: auto !important;
          transform: none !important;
          page-break-after: always;
          box-shadow: none;
          width: 100%; height: 100vh;
        }
        section.slide.active ~ section.slide,
        section.slide:not(.active) { opacity: 1 !important; pointer-events: auto !important; }
        .deck-counter { display: none; }
      }
    `;
    document.head.appendChild(s);
  }

  // === Counter overlay ===
  const counter = document.createElement('div');
  counter.className = 'deck-counter';
  document.body.appendChild(counter);

  // === State ===
  let cur = Math.max(0, Math.min(slides.length - 1, parseInt(location.hash.slice(1) || '1', 10) - 1));

  function show(i) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, idx) => s.classList.toggle('active', idx === cur));
    counter.textContent = `${cur + 1} / ${slides.length}`;
    history.replaceState(null, '', `#${cur + 1}`);
    window.parent?.postMessage({ type: 'deck:slide', index: cur, total: slides.length }, '*');
  }

  // === Auto-fit ===
  function fit() {
    const sx = window.innerWidth / STAGE_W;
    const sy = window.innerHeight / STAGE_H;
    const s = Math.min(sx, sy);
    const offsetX = (window.innerWidth - STAGE_W * s) / 2;
    const offsetY = (window.innerHeight - STAGE_H * s) / 2;
    slides.forEach((sl) => {
      sl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${s})`;
    });
  }
  window.addEventListener('resize', fit);
  fit();

  // === Keyboard nav ===
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      show(cur + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      show(cur - 1);
    } else if (e.key === 'Home') {
      show(0);
    } else if (e.key === 'End') {
      show(slides.length - 1);
    } else if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } else if (e.key === 'p' || e.key === 'P') {
      window.print();
    } else if (e.key === 'n' || e.key === 'N') {
      slides[cur].classList.toggle('show-notes');
    } else if (/^[0-9]$/.test(e.key)) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= slides.length) show(n - 1);
    }
  });

  // === Click L/R half for nav ===
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, [contenteditable]')) return;
    if (e.clientX < window.innerWidth / 2) show(cur - 1);
    else show(cur + 1);
  });

  show(cur);
  console.log(`[deck-stage] ${slides.length} slides loaded · arrow keys / space to navigate · p to print · n for notes`);
})();
