#!/usr/bin/env node
/**
 * Project-agnostic headless browser visual + DOM Geometry Oracle runner (Layer 1 of adaptive-build).
 *
 * Usage:
 *   node browser_audit.mjs --url http://127.0.0.1:4100 --out ./evidence \
 *     [--viewports 1440x900,390x844] [--project-dir <repo>] \
 *     [--allow-status 400,404] [--actions ./actions.json]
 *
 * actions.json: a list run in order after the "initial" state. Each action gets its own state.
 *   [{ "name": "modal-open", "click": "#newBtn" },
 *    { "name": "mobile-search", "viewport": "390x844", "fill": { "selector": "#q", "value": "zzzz" } },
 *    { "name": "modal-esc", "press": "Escape", "waitMs": 0, "expectStatus": [400], "expectUrl": "/api/expenses" }]
 *   An action without "viewport" runs on the first viewport only.
 *
 * Captures:
 *   - Multi-viewport PNG screenshots + optional interactive state PNGs
 *   - Layer 1 DOM Geometry & UX Hygiene Oracle JSON per state
 *   - Console errors, uncaught page errors, HTTP >=400 responses, and transport failures
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, launchChromium } from './load_playwright.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { viewports: '1440x900,390x844', waitMs: 350, 'allow-status': '' };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const k = tok.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  if (!args.url || !args.out) {
    console.error('Usage: node browser_audit.mjs --url <URL> --out <DIR> [--viewports 1440x900,390x844] [--project-dir <DIR>] [--allow-status 400,404] [--actions file.json]');
    process.exit(2);
  }
  return args;
}

function sanitizeStateName(raw, fallback) {
  const cleaned = String(raw || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function parseStatusSet(val) {
  const out = new Set();
  if (val == null || val === '') return out;
  const list = Array.isArray(val) ? val : String(val).split(',');
  for (const item of list) {
    const code = Number(String(item).trim());
    if (Number.isFinite(code) && code >= 100) out.add(code);
  }
  return out;
}

async function runAudit() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const oracleSource = fs.readFileSync(path.join(__dirname, 'ui_geometry_audit.js'), 'utf8');
  const viewports = args.viewports.split(',').map((vp) => {
    const [w, h] = vp.trim().split('x').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new Error(`Invalid viewport "${vp}". Expected WxH such as 1440x900.`);
    }
    return { w, h, label: `${w}x${h}` };
  });
  const viewportLabels = new Set(viewports.map((v) => v.label));
  const globalAllowedStatuses = parseStatusSet(args['allow-status']);

  const actions = args.actions ? JSON.parse(fs.readFileSync(path.resolve(args.actions), 'utf8')) : [];
  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (act.viewport && !viewportLabels.has(act.viewport)) {
      throw new Error(
        `Action #${i} ("${act.name || 'action'}") targets unknown viewport "${act.viewport}" (configured: ${[...viewportLabels].join(', ')})`
      );
    }
  }

  const { chromium } = loadPlaywright(args['project-dir']);
  const browser = await launchChromium(chromium);

  const report = {
    url: args.url,
    timestamp: new Date().toISOString(),
    overallPass: true,
    states: [],
  };

  try {
    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const observedResponses = [];
      let activeStepToken = 0;
      const requestStepMap = new WeakMap();
      const seenStates = new Set();

      page.on('request', (req) => {
        requestStepMap.set(req, activeStepToken);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          const loc = msg.location() || {};
          const src = loc.url || '';
          if (!src.endsWith('/favicon.ico') && !text.includes('favicon.ico')) {
            consoleErrors.push({ text, url: src, lineNumber: loc.lineNumber ?? 0, columnNumber: loc.columnNumber ?? 0 });
          }
        }
      });
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      page.on('response', (res) => {
        if (res.url().endsWith('/favicon.ico')) return;
        const stepToken = requestStepMap.get(res.request()) ?? activeStepToken;
        observedResponses.push({ status: res.status(), url: res.url(), stepToken });
        if (res.status() >= 400) {
          failedRequests.push({ status: res.status(), url: res.url(), stepToken });
        }
      });
      page.on('requestfailed', (req) => {
        const url = req.url();
        if (url.endsWith('/favicon.ico')) return;
        const errText = req.failure()?.errorText || 'request failed';
        if (errText === 'net::ERR_ABORTED') return;
        failedRequests.push({ status: 0, url, error: errText });
      });

      const captureState = async (rawName, extraAllowedStatuses = new Set(), expectUrl = '', stepToken = 0) => {
        const baseName = sanitizeStateName(rawName, 'state');
        let stateName = baseName;
        let suffix = 2;
        while (seenStates.has(stateName)) {
          stateName = `${baseName}-${suffix++}`;
        }
        seenStates.add(stateName);

        // A string expression runs through the DevTools protocol, so a strict page CSP cannot block it.
        const audit = await page.evaluate(`(${oracleSource})(document.body, {})`);
        const shotName = `${vp.label}-${stateName}.png`;
        const shotPath = path.join(outDir, shotName);
        await page.screenshot({ path: shotPath, fullPage: true });

        const urlMatches = (url) => (!expectUrl ? true : url.includes(expectUrl));
        const matchesActionExpectation = (item) =>
          extraAllowedStatuses.has(item.status) && item.stepToken === stepToken && urlMatches(item.url);
        const isAllowedFailure = (req) => globalAllowedStatuses.has(req.status) || matchesActionExpectation(req);

        const allowedBudget = new Map();
        for (const req of failedRequests) {
          if (isAllowedFailure(req)) {
            const k = `${req.status}:${req.url}`;
            allowedBudget.set(k, (allowedBudget.get(k) || 0) + 1);
          }
        }
        const matchedExpectedStatuses = new Set(
          observedResponses
            .filter((r) => r.stepToken === stepToken && urlMatches(r.url))
            .map((r) => r.status)
        );
        const missingExpectedStatuses = [...extraAllowedStatuses].filter((code) => !matchedExpectedStatuses.has(code));
        const unexpectedFailures = failedRequests
          .filter((req) => !isAllowedFailure(req))
          .map(({ status, url, error }) => (error ? { status, url, error } : { status, url }));
        const unexpectedConsoleErrors = consoleErrors
          .filter((entry) => {
            const m = entry.text.match(/^Failed to load resource: the server responded with a status of (\d{3})\b/);
            if (!m) return true;
            // Chromium's automatic network console error has lineNumber 0 and columnNumber 0; app console.error() has a script line.
            if (entry.lineNumber > 0 || entry.columnNumber > 0) return true;
            const k = `${Number(m[1])}:${entry.url}`;
            const left = allowedBudget.get(k) || 0;
            if (left > 0) {
              allowedBudget.set(k, left - 1);
              return false;
            }
            return true;
          })
          .map((entry) => entry.text);
        const statePass =
          audit.pass &&
          unexpectedConsoleErrors.length === 0 &&
          pageErrors.length === 0 &&
          unexpectedFailures.length === 0 &&
          missingExpectedStatuses.length === 0;
        if (!statePass) report.overallPass = false;
        const stateEntry = {
          viewport: vp.label,
          state: stateName,
          pass: statePass,
          screenshot: shotPath,
          consoleErrors: [...unexpectedConsoleErrors],
          pageErrors: [...pageErrors],
          failedRequests: [...unexpectedFailures],
          audit,
        };
        if (missingExpectedStatuses.length > 0) {
          stateEntry.missingExpectedStatuses = missingExpectedStatuses;
        }
        report.states.push(stateEntry);
        // Each state reports only the errors raised since the previous state.
        consoleErrors.length = 0;
        pageErrors.length = 0;
        failedRequests.length = 0;
        observedResponses.length = 0;
      };

      try {
        // Use domcontentloaded + bounded load/networkidle waits so SSE/WebSocket/polling apps do not time out.
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(Number(args.waitMs));
      } catch (err) {
        report.overallPass = false;
        report.states.push({
          viewport: vp.label,
          state: 'initial',
          pass: false,
          navigationError: String(err),
          consoleErrors: consoleErrors.splice(0).map((e) => e.text),
          pageErrors: pageErrors.splice(0),
          failedRequests: failedRequests.splice(0).map(({ status, url, error }) => (error ? { status, url, error } : { status, url })),
        });
        observedResponses.length = 0;
        await context.close();
        continue;
      }

      await captureState('initial');

      // An action runs on its own "viewport" (e.g. "390x844"), or on the first viewport when it names none.
      for (let idx = 0; idx < actions.length; idx++) {
        const act = actions[idx];
        if (act.viewport ? act.viewport !== vp.label : vp !== viewports[0]) continue;
        const fallbackName = `action-${idx + 1}`;
        const stateLabel = act.name || fallbackName;
        const waitTime = act.waitMs ?? Number(args.waitMs);
        const expectedStatuses = parseStatusSet(act.expectStatus);
        const expectUrl = typeof act.expectUrl === 'string' ? act.expectUrl : '';
        activeStepToken += 1;
        const stepToken = activeStepToken;
        try {
          if (act.click) await page.click(act.click, { timeout: 5000 });
          if (act.fill) await page.fill(act.fill.selector, act.fill.value, { timeout: 5000 });
          if (act.press) await page.keyboard.press(act.press);
          if (waitTime > 0) await page.waitForTimeout(waitTime);
          await captureState(stateLabel, expectedStatuses, expectUrl, stepToken);
        } catch (err) {
          report.overallPass = false;
          report.states.push({
            viewport: vp.label,
            state: sanitizeStateName(stateLabel, fallbackName),
            pass: false,
            actionError: String(err),
            consoleErrors: consoleErrors.splice(0).map((e) => e.text),
            pageErrors: pageErrors.splice(0),
            failedRequests: failedRequests.splice(0).map(({ status, url, error }) => (error ? { status, url, error } : { status, url })),
          });
          observedResponses.length = 0;
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outDir, 'audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ overallPass: report.overallPass, reportPath, states: report.states.map((s) => ({ viewport: s.viewport, state: s.state, pass: s.pass, summary: s.audit?.summary, errors: (s.consoleErrors?.length || 0) + (s.pageErrors?.length || 0) + (s.failedRequests?.length || 0) + (s.missingExpectedStatuses?.length || 0) + (s.navigationError ? 1 : 0) + (s.actionError ? 1 : 0) })) }, null, 2));
  process.exit(report.overallPass ? 0 : 1);
}

runAudit().catch((err) => {
  console.error(err);
  process.exit(2);
});
