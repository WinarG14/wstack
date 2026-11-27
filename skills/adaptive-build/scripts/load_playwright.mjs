// Finds Playwright from a local install, NODE_PATH, or the global npm root, then launches Chromium.
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

export function loadPlaywright() {
  const require = createRequire(path.join(process.cwd(), 'noop.js'));
  const roots = [path.join(os.homedir(), '.local/lib/node_modules')];
  try {
    roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    // npm not on PATH
  }
  const candidates = ['playwright', 'playwright-core', ...roots.flatMap((r) => [path.join(r, 'playwright'), path.join(r, 'playwright-core')])];
  for (const mod of candidates) {
    try {
      return require(mod);
    } catch {
      // try next
    }
  }
  throw new Error('Playwright not found. Run `npm i -D playwright && npx playwright install chromium` in this folder, or `npm i -g playwright`.');
}

// Bundled Chromium first; installed Google Chrome only if the bundled browser is not downloaded.
export async function launchChromium(chromium) {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    try {
      return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      throw err;
    }
  }
}
