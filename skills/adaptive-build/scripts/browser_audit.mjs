#!/usr/bin/env node
/**
 * Project-agnostic headless browser visual + DOM Geometry Oracle runner (Layer 1 of adaptive-build).
 *
 * Usage:
 *   node browser_audit.mjs --url http://127.0.0.1:4100 --out ./evidence \
 *     [--viewports 1440x900,390x844] [--actions ./actions.json]
 *
 * Captures:
 *   - Multi-viewport PNG screenshots + optional interactive state PNGs
 *   - Layer 1 DOM Geometry & UX Hygiene Oracle JSON per state
 *   - Console errors, uncaught page errors, and HTTP >=400 network responses
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, launchChromium } from './load_playwright.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { viewports: '1440x900,390x844', waitMs: 350 };
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
    console.error('Usage: node browser_audit.mjs --url <URL> --out <DIR> [--viewports 1440x900,390x844] [--actions file.json]');
    process.exit(2);
  }
  return args;
}

async function runAudit() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const oracleSource = fs.readFileSync(path.join(__dirname, 'ui_geometry_audit.js'), 'utf8');
  const viewports = args.viewports.split(',').map((vp) => {
    const [w, h] = vp.trim().split('x').map(Number);
    return { w, h, label: `${w}x${h}` };
  });

  const actions = args.actions ? JSON.parse(fs.readFileSync(path.resolve(args.actions), 'utf8')) : [];
  const { chromium } = loadPlaywright();
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

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          const src = msg.location()?.url || '';
          if (!src.endsWith('/favicon.ico') && !text.includes('favicon.ico')) consoleErrors.push(text);
        }
      });
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      page.on('response', (res) => {
        if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) {
          failedRequests.push({ status: res.status(), url: res.url() });
        }
      });

      await page.goto(args.url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(Number(args.waitMs));

      const captureState = async (stateName) => {
        // A string expression runs through the DevTools protocol, so a strict page CSP cannot block it.
        const audit = await page.evaluate(`(${oracleSource})(document.body, {})`);
        const shotName = `${vp.label}-${stateName}.png`;
        const shotPath = path.join(outDir, shotName);
        await page.screenshot({ path: shotPath, fullPage: true });
        const statePass =
          audit.pass &&
          consoleErrors.length === 0 &&
          pageErrors.length === 0 &&
          failedRequests.length === 0;
        if (!statePass) report.overallPass = false;
        report.states.push({
          viewport: vp.label,
          state: stateName,
          pass: statePass,
          screenshot: shotPath,
          consoleErrors: [...consoleErrors],
          pageErrors: [...pageErrors],
          failedRequests: [...failedRequests],
          audit,
        });
        // Each state reports only the errors raised since the previous state.
        consoleErrors.length = 0;
        pageErrors.length = 0;
        failedRequests.length = 0;
      };

      await captureState('initial');

      // An action runs on its own "viewport" (e.g. "390x844"), or on the first viewport when it names none.
      for (const act of actions) {
        if (act.viewport ? act.viewport !== vp.label : vp !== viewports[0]) continue;
        try {
          if (act.click) await page.click(act.click, { timeout: 5000 });
          if (act.fill) await page.fill(act.fill.selector, act.fill.value, { timeout: 5000 });
          if (act.press) await page.keyboard.press(act.press);
          await page.waitForTimeout(act.waitMs || Number(args.waitMs));
          await captureState(act.name || 'action');
        } catch (err) {
          report.overallPass = false;
          report.states.push({
            viewport: vp.label,
            state: act.name || 'action',
            pass: false,
            actionError: String(err),
          });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outDir, 'audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ overallPass: report.overallPass, reportPath, states: report.states.map((s) => ({ viewport: s.viewport, state: s.state, pass: s.pass, summary: s.audit?.summary, errors: (s.consoleErrors?.length || 0) + (s.pageErrors?.length || 0) + (s.failedRequests?.length || 0) })) }, null, 2));
  process.exit(report.overallPass ? 0 : 1);
}

runAudit().catch((err) => {
  console.error(err);
  process.exit(2);
});
