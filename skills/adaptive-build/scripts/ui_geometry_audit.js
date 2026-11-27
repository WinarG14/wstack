// Project-Agnostic $0 DOM Geometry, Accessibility & UX Hygiene Oracle (Layer 1 of adaptive-build).
// Inject via scripts/browser_audit.mjs OR paste into any browser DevTools / preview_evaluate.
// Returns structured JSON with pass/fail and exact elements + coordinates.
(function adaptiveUiGeometryAudit(rootEl, options) {
  if (typeof document.getAnimations === 'function') {
    for (const anim of document.getAnimations()) {
      try { anim.finish(); } catch { /* ignore non-finishable */ }
    }
  }

  const root = rootEl || document.body;
  const opts = Object.assign({
    maxGapPx: 48,
    minInvisibleHeightPx: 16,
    overlapTolerancePx: 4,
  }, options || {});

  const isShownBox = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };

  const isOutOfFlow = (el) => {
    let cur = el;
    while (cur && cur !== root && cur !== document.body) {
      const p = getComputedStyle(cur).position;
      if (p === 'absolute' || p === 'fixed') return true;
      cur = cur.parentElement;
    }
    return false;
  };

  const labelOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const testId = el.getAttribute('data-testid');
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    if (testId) return `${tag}[data-testid="${testId}"]`;
    if (id) return `${tag}${id}`;
    return cls ? `${tag}.${cls}` : tag;
  };

  // 1a. Invisible elements reserving in-flow layout height (dead whitespace traps).
  const invisibleReservations = [];
  for (const el of root.querySelectorAll('*')) {
    if (!isShownBox(el) || isOutOfFlow(el)) continue;
    const cs = getComputedStyle(el);
    const hidden = parseFloat(cs.opacity) === 0 || cs.visibility === 'hidden';
    if (!hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.height < opts.minInvisibleHeightPx) continue;
    const parentCs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    if (parentCs && (parseFloat(parentCs.opacity) === 0 || parentCs.visibility === 'hidden')) continue;
    invisibleReservations.push({
      kind: 'invisible_height_reservation',
      el: labelOf(el),
      height: Math.round(r.height),
      top: Math.round(r.top),
      opacity: cs.opacity,
      visibility: cs.visibility,
    });
  }

  // 1b. Abnormal vertical gaps between consecutive visible siblings in block/flex column stacks.
  const largeVerticalGaps = [];
  const seenGaps = new Set();
  for (const container of [root, ...root.querySelectorAll('main, section, [role="main"], .container, .content, .panel, .card')]) {
    if (!isShownBox(container)) continue;
    const cStyle = getComputedStyle(container);
    if (cStyle.display.includes('flex') && !cStyle.flexDirection.startsWith('column')) continue;
    if (cStyle.display.includes('grid')) continue;
    const visibleKids = [...container.children].filter((child) => {
      if (!isShownBox(child)) return false;
      const cs = getComputedStyle(child);
      if (cs.position === 'absolute' || cs.position === 'fixed') return false;
      if (parseFloat(cs.opacity) === 0 || cs.visibility === 'hidden') return false;
      return true;
    });
    for (let i = 0; i < visibleKids.length - 1; i++) {
      const a = visibleKids[i].getBoundingClientRect();
      const b = visibleKids[i + 1].getBoundingClientRect();
      const gap = Math.round(b.top - a.bottom);
      const key = `${Math.round(a.bottom)}:${Math.round(b.top)}`;
      if (gap > opts.maxGapPx && !seenGaps.has(key)) {
        seenGaps.add(key);
        largeVerticalGaps.push({
          kind: 'large_vertical_gap',
          gapPx: gap,
          above: labelOf(visibleKids[i]),
          below: labelOf(visibleKids[i + 1]),
        });
      }
    }
  }

  // 2. Clipped text (leaf overflow or inline-flex/flex nowrap overflowing without ellipsis).
  const clippedText = [];
  for (const el of root.querySelectorAll('*')) {
    if (!isShownBox(el)) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.opacity) === 0 || cs.visibility === 'hidden') continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const isLeaf = el.children.length === 0;
    const isNowrapHidden = cs.whiteSpace === 'nowrap' && (cs.overflowX === 'hidden' || cs.overflow === 'hidden');
    if (!isLeaf && !isNowrapHidden) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      const intentionalEllipsis = isLeaf && cs.textOverflow === 'ellipsis' && cs.overflowX === 'hidden' && el.getAttribute('title');
      if (!intentionalEllipsis) {
        clippedText.push({
          el: labelOf(el),
          display: cs.display,
          textOverflow: cs.textOverflow,
          scrollWidth: Math.round(el.scrollWidth),
          clientWidth: Math.round(el.clientWidth),
          text: text.slice(0, 50),
        });
      }
    }
  }

  // 3. Horizontal overflow (page-level and off-viewport interactive controls).
  const horizontalOverflow = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 2) {
    horizontalOverflow.push({
      el: 'documentElement',
      scrollWidth: Math.round(document.documentElement.scrollWidth),
      viewportWidth: window.innerWidth,
      overflowPx: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    });
  }
  const offViewportControls = [];
  const interactiveSel = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
  const visibleControls = [];
  for (const el of root.querySelectorAll(interactiveSel)) {
    if (!isShownBox(el)) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.opacity) === 0 || cs.visibility === 'hidden') continue;
    const raw = el.getBoundingClientRect();
    let r = raw;
    // Clip to scroll/overflow ancestors: a control scrolled out of its container is not on screen and
    // must not count as overlapping whatever sits over that spot (for example a fixed tab bar).
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ov = getComputedStyle(a);
      if (!/(auto|scroll|hidden|clip)/.test(ov.overflow + ov.overflowX + ov.overflowY)) continue;
      const ar = a.getBoundingClientRect();
      const left = Math.max(r.left, ar.left), top = Math.max(r.top, ar.top);
      const right = Math.min(r.right, ar.right), bottom = Math.min(r.bottom, ar.bottom);
      r = { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
    }
    if (r.right - r.left >= 1 && r.bottom - r.top >= 1) visibleControls.push({ el, r, label: labelOf(el), text: (el.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 40) });
    if (raw.right > window.innerWidth + 2 || raw.left < -2) {
      offViewportControls.push({
        el: labelOf(el),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40),
        left: Math.round(raw.left),
        right: Math.round(raw.right),
        viewportWidth: window.innerWidth,
      });
    }
  }

  // 4. Overlapping interactive controls (same stacking context, not ancestor/descendant).
  const overlappingControls = [];
  for (let i = 0; i < visibleControls.length; i++) {
    for (let j = i + 1; j < visibleControls.length; j++) {
      const a = visibleControls[i];
      const b = visibleControls[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Ignore modal backdrop/dialog vs elements underneath when a modal is open
      const aModal = a.el.closest('[role="dialog"], .modal, dialog[open]');
      const bModal = b.el.closest('[role="dialog"], .modal, dialog[open]');
      if (Boolean(aModal) !== Boolean(bModal)) continue;
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix > opts.overlapTolerancePx && iy > opts.overlapTolerancePx) {
        overlappingControls.push({
          a: `${a.label} ("${a.text}")`,
          b: `${b.label} ("${b.text}")`,
          overlapPx: { x: Math.round(ix), y: Math.round(iy) },
        });
      }
    }
  }

  // 5. Broken images and UX hygiene text smells (raw ISO timestamps, internal enums, NaN/undefined, unlabeled controls).
  const brokenMedia = [];
  for (const img of root.querySelectorAll('img')) {
    if (!isShownBox(img)) continue;
    if (!img.complete || img.naturalWidth === 0) {
      brokenMedia.push({ el: labelOf(img), src: img.getAttribute('src') || '' });
    }
  }

  const uxHygieneSmells = [];
  for (const c of visibleControls) {
    const accessibleName = (
      c.el.innerText ||
      Array.from(c.el.labels || []).map(l => l.innerText).join(' ') ||
      (c.el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => (document.getElementById(id) || {}).innerText || '').join(' ') ||
      c.el.getAttribute('aria-label') ||
      c.el.getAttribute('title') ||
      c.el.getAttribute('placeholder') ||
      ''
    ).trim();
    if (!accessibleName) {
      uxHygieneSmells.push({ kind: 'unlabeled_control', el: c.label });
    }
  }

  const rawIsoRe = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z\b/;
  const rawEnumRe = /\b[A-Z]{2,}_[A-Z0-9_]{2,}\b/;
  const rawIdRe = /\b(exp|usr|org|ord|tsk|inv)_[0-9a-f]{6,}\b/i;
  const badValueRe = /\b(NaN|undefined|\[object Object\])\b/;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seenSmells = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || !isShownBox(parent)) continue;
    const tag = parent.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'code' || tag === 'pre') continue;
    const txt = (node.nodeValue || '').trim();
    if (!txt) continue;
    for (const [kind, re] of [
      ['raw_iso_timestamp', rawIsoRe],
      ['raw_internal_enum', rawEnumRe],
      ['raw_internal_id', rawIdRe],
      ['leaked_js_value', badValueRe],
    ]) {
      const m = txt.match(re);
      if (m) {
        const key = `${kind}:${m[0]}`;
        if (!seenSmells.has(key)) {
          seenSmells.add(key);
          uxHygieneSmells.push({ kind, el: labelOf(parent), sample: m[0] });
        }
      }
    }
  }

  const deadGaps = [...invisibleReservations, ...largeVerticalGaps];
  const pass =
    deadGaps.length === 0 &&
    clippedText.length === 0 &&
    horizontalOverflow.length === 0 &&
    offViewportControls.length === 0 &&
    overlappingControls.length === 0 &&
    brokenMedia.length === 0 &&
    uxHygieneSmells.length === 0;

  return {
    pass,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    summary: {
      deadGaps: deadGaps.length,
      clippedText: clippedText.length,
      horizontalOverflow: horizontalOverflow.length,
      offViewportControls: offViewportControls.length,
      overlappingControls: overlappingControls.length,
      brokenMedia: brokenMedia.length,
      uxHygieneSmells: uxHygieneSmells.length,
    },
    deadGaps: deadGaps.slice(0, 15),
    clippedText: clippedText.slice(0, 15),
    horizontalOverflow: horizontalOverflow.slice(0, 10),
    offViewportControls: offViewportControls.slice(0, 15),
    overlappingControls: overlappingControls.slice(0, 15),
    brokenMedia: brokenMedia.slice(0, 10),
    uxHygieneSmells: uxHygieneSmells.slice(0, 20),
  };
})
