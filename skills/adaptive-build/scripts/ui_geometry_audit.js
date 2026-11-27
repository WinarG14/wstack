// Project-Agnostic $0 DOM Geometry, Accessibility & UX Hygiene Oracle (Layer 1 of adaptive-build).
// Inject via scripts/browser_audit.mjs. In DevTools: paste the file wrapped as `(<file>)(document.body, {})`.
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

  // Walks ancestors because CSS opacity does not inherit (a button inside an opacity:0 drawer is invisible).
  const isElementVisible = (el) => {
    if (!isShownBox(el)) return false;
    for (let cur = el; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    }
    return true;
  };

  const isVisuallyHiddenSrOnly = (el, cs) => {
    const r = el.getBoundingClientRect();
    const tinyClip = r.width <= 1.5 && r.height <= 1.5 && (cs.overflow === 'hidden' || cs.overflowX === 'hidden');
    const clipPathHidden = cs.clipPath && /inset\(\s*50%/.test(cs.clipPath);
    const clipRectHidden = cs.clip && /rect\(\s*0(px)?\s*,\s*0(px)?\s*,\s*0(px)?\s*,\s*0(px)?\s*\)/.test(cs.clip);
    return tinyClip || clipPathHidden || clipRectHidden;
  };

  const establishesContainingBlock = (cs, forFixed) => {
    const hasCb =
      (cs.transform && cs.transform !== 'none') ||
      (cs.translate && cs.translate !== 'none') ||
      (cs.rotate && cs.rotate !== 'none') ||
      (cs.scale && cs.scale !== 'none') ||
      (cs.perspective && cs.perspective !== 'none') ||
      (cs.filter && cs.filter !== 'none') ||
      (cs.backdropFilter && cs.backdropFilter !== 'none') ||
      (cs.contain && /(paint|layout|strict|content)/.test(cs.contain)) ||
      (cs.willChange && /\b(transform|translate|rotate|scale|perspective|filter|backdrop-filter)\b/.test(cs.willChange));
    if (forFixed) return hasCb;
    return hasCb || cs.position !== 'static';
  };

  // Returns true only when ancestor `a` actually clips `el` per CSS containing-block rules.
  const ancestorCanClip = (el, ancestor) => {
    let sawFixed = false;
    let sawAbsolute = false;
    let absContained = false;
    for (let cur = el; cur && cur !== ancestor; cur = cur.parentElement) {
      const pcs = getComputedStyle(cur);
      if (cur !== el) {
        if (sawFixed && establishesContainingBlock(pcs, true)) sawFixed = false;
        if (sawAbsolute && establishesContainingBlock(pcs, false)) absContained = true;
      }
      if (pcs.position === 'fixed') sawFixed = true;
      else if (pcs.position === 'absolute') {
        sawAbsolute = true;
        absContained = false;
      }
    }
    const acs = getComputedStyle(ancestor);
    if (sawFixed) return establishesContainingBlock(acs, true);
    if (sawAbsolute && !absContained) return establishesContainingBlock(acs, false);
    return true;
  };

  // Exempts an off-viewport control only when it is not clipped by an inner wrapper AND scrolling its
  // horizontal scroll ancestor can bring the full control inside the viewport-visible area of the scroller.
  const isReachableInHorizontalScroller = (el, raw) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (!ancestorCanClip(el, a)) continue;
      const ov = getComputedStyle(a);
      if (ov.overflowX === 'hidden' || ov.overflowX === 'clip') {
        const ar = a.getBoundingClientRect();
        if (raw.right > ar.right + 2 || raw.left < ar.left - 2) return false;
      }
      if ((ov.overflowX === 'auto' || ov.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) {
        const ar = a.getBoundingClientRect();
        const visLeft = Math.max(ar.left, 0);
        const visRight = Math.min(ar.right, window.innerWidth);
        if (visRight - visLeft <= 1) continue;
        const maxScroll = a.scrollWidth - a.clientWidth;
        const isRtl = ov.direction === 'rtl';
        const minShift = isRtl ? -a.scrollLeft : a.scrollLeft - maxScroll;
        const maxShift = isRtl ? maxScroll + a.scrollLeft : a.scrollLeft;
        const needMin = visLeft - raw.left - 2;
        const needMax = visRight - raw.right + 2;
        if (Math.max(minShift, needMin) <= Math.min(maxShift, needMax)) {
          return true;
        }
      }
    }
    return false;
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
    if (!isElementVisible(container)) continue;
    const cStyle = getComputedStyle(container);
    if (cStyle.display.includes('flex') && !cStyle.flexDirection.startsWith('column')) continue;
    if (cStyle.display.includes('grid')) continue;
    const visibleKids = [...container.children].filter((child) => {
      if (!isElementVisible(child)) return false;
      const cs = getComputedStyle(child);
      if (cs.position === 'absolute' || cs.position === 'fixed') return false;
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

  // 2. Clipped text (leaf overflow, nowrap overflow, or parent overflow:hidden clipping without ellipsis).
  const clippedText = [];
  const seenClipped = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (!isElementVisible(el)) continue;
    const cs = getComputedStyle(el);
    if (isVisuallyHiddenSrOnly(el, cs)) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const isLeaf = el.children.length === 0;
    const isNowrapHidden = cs.whiteSpace === 'nowrap' && (cs.overflowX === 'hidden' || cs.overflow === 'hidden');

    if ((isLeaf || isNowrapHidden) && el.scrollWidth > el.clientWidth + 1) {
      const intentionalEllipsis =
        isLeaf &&
        cs.textOverflow === 'ellipsis' &&
        cs.overflowX === 'hidden' &&
        Boolean(el.getAttribute('title') || el.getAttribute('aria-label'));
      if (!intentionalEllipsis) {
        const key = `${labelOf(el)}:${text.slice(0, 30)}`;
        if (!seenClipped.has(key)) {
          seenClipped.add(key);
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
      continue;
    }

    // Check if a leaf text element is clipped horizontally by a tight overflow:hidden ancestor that can actually clip it.
    if (isLeaf) {
      const r = el.getBoundingClientRect();
      if (!isReachableInHorizontalScroller(el, r)) {
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          if (!ancestorCanClip(el, a)) continue;
          const acs = getComputedStyle(a);
          if (isVisuallyHiddenSrOnly(a, acs)) break;
          if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') break;
          if (acs.overflowX === 'hidden' || acs.overflowX === 'clip') {
            const ar = a.getBoundingClientRect();
            const intentionalAncestorEllipsis =
              acs.textOverflow === 'ellipsis' &&
              Boolean(a.getAttribute('title') || a.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-label'));
            if (!intentionalAncestorEllipsis && (r.right > ar.right + 2 || r.left < ar.left - 2)) {
              const key = `${labelOf(el)}:${text.slice(0, 30)}`;
              if (!seenClipped.has(key)) {
                seenClipped.add(key);
                clippedText.push({
                  el: labelOf(el),
                  clippedBy: labelOf(a),
                  display: cs.display,
                  textOverflow: acs.textOverflow,
                  scrollWidth: Math.round(r.width),
                  clientWidth: Math.round(ar.width),
                  text: text.slice(0, 50),
                });
              }
              break;
            }
          }
        }
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
    if (!isElementVisible(el)) continue;
    const raw = el.getBoundingClientRect();
    let r = raw;
    // Clip to scroll/overflow ancestors that can actually clip this control: a control scrolled out of
    // its container is not on screen and must not count as overlapping whatever sits over that spot.
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (!ancestorCanClip(el, a)) continue;
      const ov = getComputedStyle(a);
      if (!/(auto|scroll|hidden|clip)/.test(ov.overflow + ov.overflowX + ov.overflowY)) continue;
      const ar = a.getBoundingClientRect();
      const left = Math.max(r.left, ar.left), top = Math.max(r.top, ar.top);
      const right = Math.min(r.right, ar.right), bottom = Math.min(r.bottom, ar.bottom);
      r = { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
    }
    if (r.right - r.left >= 1 && r.bottom - r.top >= 1) {
      visibleControls.push({
        el,
        r,
        label: labelOf(el),
        text: (el.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 40),
      });
    }
    if (!isReachableInHorizontalScroller(el, raw) && (raw.right > window.innerWidth + 2 || raw.left < -2)) {
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
    if (!isElementVisible(img)) continue;
    const rect = img.getBoundingClientRect();
    const isBelowFoldLazy = img.loading === 'lazy' && !img.complete && rect.top > window.innerHeight + 50;
    if (isBelowFoldLazy) continue;
    if (!img.complete || img.naturalWidth === 0) {
      brokenMedia.push({ el: labelOf(img), src: img.getAttribute('src') || '' });
    }
  }

  const uxHygieneSmells = [];
  const controlTextFallback = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        const val = (el.value || el.getAttribute('value') || '').trim();
        if (val) return val;
        // Native browser default labels for submit/reset inputs
        if (type === 'submit') return 'Submit';
        if (type === 'reset') return 'Reset';
      }
      if (type === 'image') {
        const alt = (el.getAttribute('alt') || '').trim();
        if (alt) return alt;
      }
    }
    const imgAlt = Array.from(el.querySelectorAll('img[alt]'))
      .map((img) => (img.getAttribute('alt') || '').trim())
      .filter(Boolean)
      .join(' ');
    if (imgAlt) return imgAlt;
    const svgLabel = Array.from(el.querySelectorAll('svg[aria-label], svg title'))
      .map((node) => (node.getAttribute?.('aria-label') || node.textContent || '').trim())
      .filter(Boolean)
      .join(' ');
    return svgLabel;
  };
  for (const c of visibleControls) {
    const accessibleName = (
      c.el.innerText ||
      Array.from(c.el.labels || []).map(l => l.innerText).join(' ') ||
      (c.el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => (document.getElementById(id) || {}).innerText || '').join(' ') ||
      c.el.getAttribute('aria-label') ||
      c.el.getAttribute('title') ||
      c.el.getAttribute('placeholder') ||
      controlTextFallback(c.el) ||
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
    if (!parent || !isElementVisible(parent)) continue;
    if (parent.closest('script, style, code, pre, noscript')) continue;
    if (isVisuallyHiddenSrOnly(parent, getComputedStyle(parent))) continue;
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
