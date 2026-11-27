#!/usr/bin/env node
/**
 * Objective Ground-Truth 12-Defect Scorer for SpendPulse Benchmark Arms.
 * Usage: node score_arm.mjs --arm-dir <path> --port <port> --out <evidence_dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { loadPlaywright, launchChromium } from '../../skills/adaptive-build/scripts/load_playwright.mjs';

const { chromium } = loadPlaywright();
const ORACLE_JS = fs.readFileSync(new URL('../../skills/adaptive-build/scripts/ui_geometry_audit.js', import.meta.url), 'utf8');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function waitServer(url, timeoutMs = 6000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not respond at ${url}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const armDir = path.resolve(args['arm-dir']);
  const port = Number(args.port || 4195);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  // Snapshot original data.json so scorer does not permanently mutate arm's repo
  const dataPath = path.join(armDir, 'data.json');
  const origData = fs.readFileSync(dataPath, 'utf8');

  const srv = spawn('node', ['server.mjs'], {
    cwd: armDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = `http://127.0.0.1:${port}`;
  const results = {};
  let browser;

  try {
    await waitServer(url);
    browser = await launchChromium(chromium);

    // --- Visual / DOM Geometry checks on Desktop (1440x900) and Mobile (390x844) ---
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktopCtx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(450);

    await page.screenshot({ path: path.join(outDir, '1440x900-final.png'), fullPage: true });
    const auditDesktop = await page.evaluate(`(${ORACLE_JS})(document.body, {})`);

    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mPage = await mobileCtx.newPage();
    await mPage.goto(url, { waitUntil: 'networkidle' });
    await mPage.waitForTimeout(450);
    await mPage.screenshot({ path: path.join(outDir, '390x844-final.png'), fullPage: true });
    const auditMobile = await mPage.evaluate(`(${ORACLE_JS})(document.body, {})`);
    await mobileCtx.close();

    // V1: Dead whitespace / invisible height reservation
    results.V1_dead_whitespace = {
      fixed: auditDesktop.summary.deadGaps === 0 && auditMobile.summary.deadGaps === 0,
      detail: { desktopDeadGaps: auditDesktop.summary.deadGaps, mobileDeadGaps: auditMobile.summary.deadGaps },
    };

    // V2: Clipped text / status pills
    results.V2_clipped_pills = {
      fixed: auditDesktop.summary.clippedText === 0 && auditMobile.summary.clippedText === 0,
      detail: { desktopClipped: auditDesktop.summary.clippedText, mobileClipped: auditMobile.summary.clippedText },
    };

    // V3: Mobile horizontal overflow & off-viewport controls
    results.V3_mobile_overflow = {
      fixed: auditMobile.summary.horizontalOverflow === 0 && auditMobile.summary.offViewportControls === 0,
      detail: { overflow: auditMobile.summary.horizontalOverflow, offViewport: auditMobile.summary.offViewportControls },
    };

    // V4: Overlapping controls
    results.V4_overlapping_controls = {
      fixed: auditDesktop.summary.overlappingControls === 0 && auditMobile.summary.overlappingControls === 0,
      detail: { desktopOverlap: auditDesktop.summary.overlappingControls, mobileOverlap: auditMobile.summary.overlappingControls },
    };

    // U2: Raw internal IDs, raw ISO timestamps, raw enum keys
    const rawSmells = auditDesktop.uxHygieneSmells.filter((s) =>
      ['raw_iso_timestamp', 'raw_internal_enum', 'raw_internal_id'].includes(s.kind)
    );
    results.U2_human_readable_ui = {
      fixed: rawSmells.length === 0,
      detail: { remainingRawSmells: rawSmells.length, sample: rawSmells.slice(0, 3) },
    };

    // B2: Approved Spend calculation (1240.10 + 602.20 = 1842.30, NOT including 899.99 rejected, no float noise)
    const approvedText = (await page.locator('#kpiApproved').innerText()).trim();
    const cleanedNum = approvedText.replace(/[$,\s]/g, '');
    const b2Fixed = cleanedNum === '1842.30' || cleanedNum === '1842.3';
    results.B2_kpi_calculation = {
      fixed: b2Fixed,
      detail: { kpiApprovedText: approvedText },
    };

    // U4: Visual hierarchy (primary CTA distinct bg from Reset, KPI value larger/bolder than label, Escape closes modal)
    const hierarchy = await page.evaluate(() => {
      const newBtn = document.getElementById('newExpenseBtn');
      const resetBtn = document.getElementById('resetBtn');
      const kpiLabel = document.querySelector('.kpi-label');
      const kpiVal = document.querySelector('.kpi-value');
      const nBg = newBtn ? getComputedStyle(newBtn).backgroundColor : '';
      const rBg = resetBtn ? getComputedStyle(resetBtn).backgroundColor : '';
      const lSize = kpiLabel ? parseFloat(getComputedStyle(kpiLabel).fontSize) : 0;
      const vSize = kpiVal ? parseFloat(getComputedStyle(kpiVal).fontSize) : 0;
      const lWt = kpiLabel ? parseInt(getComputedStyle(kpiLabel).fontWeight, 10) : 400;
      const vWt = kpiVal ? parseInt(getComputedStyle(kpiVal).fontWeight, 10) : 400;
      return { ctaDistinct: nBg !== rBg, kpiProminent: vSize >= lSize + 4 || vWt >= lWt + 200, nBg, rBg, lSize, vSize, lWt, vWt };
    });
    await page.click('#newExpenseBtn');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const modalClosedOnEsc = await page.evaluate(() => {
      const ov = document.getElementById('modalOverlay');
      return !ov || ov.classList.contains('hidden') || getComputedStyle(ov).display === 'none';
    });
    if (!modalClosedOnEsc) {
      await page.click('#cancelModalBtn').catch(() => {});
    }
    results.U4_hierarchy_and_modal_esc = {
      fixed: hierarchy.ctaDistinct && hierarchy.kpiProminent && modalClosedOnEsc,
      detail: { ...hierarchy, modalClosedOnEsc },
    };

    // B1: Async filter race (click Pending [350ms] then immediately Approved [30ms], wait 600ms, verify Approved rows stay)
    await page.click('.tab[data-status="PENDING_L2_APPROVAL"]');
    await page.waitForTimeout(25);
    await page.click('.tab[data-status="APPROVED"]');
    await page.waitForTimeout(650);
    const afterRaceText = await page.locator('#expenseRows').innerText();
    const b1Fixed =
      afterRaceText.includes('Q4 Cloud GPU Staging Nodes') &&
      !afterRaceText.includes('Annual Figma Enterprise Seats');
    results.B1_async_filter_race = {
      fixed: b1Fixed,
      detail: { hasApproved: afterRaceText.includes('Q4 Cloud GPU Staging Nodes'), leakedPending: afterRaceText.includes('Annual Figma Enterprise Seats') },
    };

    // B4a: Combined Status + Search filter (Pending + "Figma" -> only Figma row, NOT Catering)
    await page.click('.tab[data-status="PENDING_L2_APPROVAL"]');
    await page.waitForTimeout(500);
    await page.fill('#searchInput', 'Figma');
    await page.waitForTimeout(550);
    const combinedText = await page.locator('#expenseRows').innerText();
    const b4CombinedOk =
      combinedText.includes('Annual Figma Enterprise Seats') &&
      !combinedText.includes('Regional Ops Offsite Catering');

    // U3: Empty state recovery when searching nonsense
    await page.fill('#searchInput', 'zzzz_no_match_999');
    await page.waitForTimeout(550);
    const emptyStateText = (await page.locator('main').innerText()).trim();
    const u3EmptyOk = /no\s+(matching\s+)?expense|nothing\s+found|no\s+results|clear\s+filter/i.test(emptyStateText);

    // Reset back to All
    await page.click('#resetBtn');
    await page.waitForTimeout(500);

    // B3: Create Expense end-to-end (modal -> POST 201 -> visible -> persists across reload)
    let createStatus = null;
    const onResp = (r) => {
      if (r.url().includes('/api/expenses') && r.request().method() === 'POST') createStatus = r.status();
    };
    page.on('response', onResp);
    await page.click('#newExpenseBtn');
    await page.waitForTimeout(150);
    await page.fill('#expenseForm input[name="title"]', 'Benchmark Smoke Expense');
    const reqInput = await page.$('#expenseForm input[name="requester"], #expenseForm input[name="requesterName"]');
    if (reqInput) await reqInput.fill('Alice Bench');
    await page.fill('#expenseForm input[name="amount"]', '42.50');
    await page.click('#submitExpenseBtn');
    await page.waitForTimeout(600);
    page.off('response', onResp);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(450);
    const afterCreateText = await page.locator('#expenseRows').innerText();
    results.B3_create_expense_contract = {
      fixed: createStatus === 201 && afterCreateText.includes('Benchmark Smoke Expense'),
      detail: { postStatus: createStatus, persistedAfterReload: afterCreateText.includes('Benchmark Smoke Expense') },
    };

    // B4b: Approve persistence (click Approve on Figma, reload, switch to Approved tab -> Figma must appear)
    const figmaApprove = page.locator('tr', { hasText: 'Annual Figma Enterprise Seats' }).locator('button', { hasText: /approve/i });
    let b4ApproveOk = false;
    if ((await figmaApprove.count()) > 0) {
      await figmaApprove.first().click();
      await page.waitForTimeout(650);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(450);
      await page.click('.tab[data-status="APPROVED"]');
      await page.waitForTimeout(450);
      const approvedAfterReload = await page.locator('#expenseRows').innerText();
      b4ApproveOk = approvedAfterReload.includes('Annual Figma Enterprise Seats');
    }
    results.B4_combined_filter_and_approve_persist = {
      fixed: b4CombinedOk && b4ApproveOk,
      detail: { combinedFilterOk: b4CombinedOk, approvePersistedInApprovedTab: b4ApproveOk },
    };

    // U3 part 2: Check loading/disable guard in app.js (static check for disabled button during approve/submit)
    const appJs = fs.readFileSync(path.join(armDir, 'public/app.js'), 'utf8');
    const hasSubmitDisableGuard = /\.disabled\s*=\s*true|isSubmitting|inFlight/i.test(appJs);
    results.U3_empty_state_and_loading_guard = {
      fixed: u3EmptyOk && hasSubmitDisableGuard,
      detail: { emptyStateHelpful: u3EmptyOk, hasSubmitDisableGuard },
    };

    // U1: Destructive delete guard (confirm dialog, custom modal, or undo toast)
    await page.click('#resetBtn');
    await page.waitForTimeout(500);
    let sawNativeConfirm = false;
    page.on('dialog', async (d) => {
      sawNativeConfirm = true;
      await d.dismiss();
    });
    const beforeRows = await page.locator('#expenseRows tr').count();
    const firstDel = page.locator('#expenseRows button', { hasText: /delete/i }).first();
    if ((await firstDel.count()) > 0) {
      await firstDel.click();
      await page.waitForTimeout(350);
    }
    const afterRows = await page.locator('#expenseRows tr').count();
    const pageBodyText = await page.locator('body').innerText();
    const sawCustomConfirmOrUndo =
      sawNativeConfirm ||
      afterRows === beforeRows ||
      /\bundo\b/i.test(pageBodyText) ||
      /are you sure|confirm delete/i.test(pageBodyText);
    results.U1_destructive_delete_guard = {
      fixed: sawCustomConfirmOrUndo,
      detail: { sawNativeConfirm, beforeRows, afterRows, hasUndoOrConfirmText: /\bundo\b|are you sure|confirm delete/i.test(pageBodyText) },
    };

    await desktopCtx.close();

    const keys = Object.keys(results);
    const fixedCount = keys.filter((k) => results[k].fixed).length;
    const byCat = {
      logic: ['B1_async_filter_race', 'B2_kpi_calculation', 'B3_create_expense_contract', 'B4_combined_filter_and_approve_persist'].filter((k) => results[k]?.fixed).length,
      visual: ['V1_dead_whitespace', 'V2_clipped_pills', 'V3_mobile_overflow', 'V4_overlapping_controls'].filter((k) => results[k]?.fixed).length,
      ux: ['U1_destructive_delete_guard', 'U2_human_readable_ui', 'U3_empty_state_and_loading_guard', 'U4_hierarchy_and_modal_esc'].filter((k) => results[k]?.fixed).length,
    };

    const summary = { armDir, totalFixed: fixedCount, totalSeeded: keys.length, byCategory: byCat, results };
    fs.writeFileSync(path.join(outDir, 'score.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (browser) await browser.close();
    srv.kill('SIGTERM');
    fs.writeFileSync(dataPath, origData);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
