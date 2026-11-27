// Finds Playwright from a project dir, cwd, NODE_PATH, or the global npm root, then launches Chromium.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

function findLocalNodeModule(startDir, modName) {
  let dir = path.resolve(startDir);
  while (true) {
    const cand = path.join(dir, 'node_modules', modName);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadPlaywright(projectDir) {
  const searchBases = [];
  if (projectDir) searchBases.push(path.resolve(projectDir));
  searchBases.push(process.cwd());

  const localMods = ['playwright', 'playwright-core'];
  // Check explicit local node_modules ancestors for projectDir then cwd BEFORE NODE_PATH / global roots.
  for (const base of searchBases) {
    const require = createRequire(path.join(base, 'noop.js'));
    for (const mod of localMods) {
      const hit = findLocalNodeModule(base, mod);
      if (!hit) continue;
      try {
        return require(hit);
      } catch {
        // try next
      }
    }
  }

  const roots = [path.join(os.homedir(), '.local/lib/node_modules')];
  try {
    roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    // npm not on PATH
  }
  const globalRequire = createRequire(path.join(process.cwd(), 'noop.js'));
  const globalCandidates = [
    ...localMods,
    ...roots.flatMap((r) => [path.join(r, 'playwright'), path.join(r, 'playwright-core')]),
  ];
  for (const mod of globalCandidates) {
    try {
      return globalRequire(mod);
    } catch {
      // try next global root
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
