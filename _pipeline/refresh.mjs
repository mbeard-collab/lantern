#!/usr/bin/env node
// Usage:
//   node _pipeline/refresh.mjs <slug> [--dry-run] [--no-narrative] [--local]
//
// Flags:
//   --dry-run      Run queries and narrative, print data.json to stdout. No commit.
//   --no-narrative Skip the Claude narrative step (narrative: null).
//   --local        Write <slug>/data.json to the working tree instead of committing.
//                  Useful with `netlify dev` for local testing.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Parse args ----
const argv = process.argv.slice(2);
const slug = argv.find(a => !a.startsWith('--'));
const DRY_RUN     = argv.includes('--dry-run');
const NO_NARRATIVE = argv.includes('--no-narrative');
const LOCAL       = argv.includes('--local');

if (!slug) {
  console.error('Usage: node _pipeline/refresh.mjs <slug> [--dry-run] [--no-narrative] [--local]');
  process.exit(1);
}

// ---- Load .env (manual; no dotenv dependency) ----
const envFile = resolve(__dirname, '.env');
try {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // .env missing is fine in CI — rely on actual env vars
}

// ---- Load query module for this slug ----
const queryPath = resolve(__dirname, 'queries', `${slug}.mjs`);
let runQuery, outputFile, formatOutput;
try {
  const mod = await import(queryPath);
  runQuery     = mod.default;
  outputFile   = mod.outputFile   || 'data.json';
  formatOutput = mod.formatOutput || null;
} catch (err) {
  console.error(`[refresh] No query module for slug "${slug}" (expected ${queryPath})\n${err.message}`);
  process.exit(1);
}

// ---- Run ----
const { query } = await import('./lib/crate.mjs');

// Read existing output file before we potentially overwrite it (for narrative diff).
const dataPath = resolve(ROOT, slug, outputFile);
let previousData = null;
try {
  previousData = JSON.parse(readFileSync(dataPath, 'utf8'));
  console.error(`[refresh] Loaded previous data from ${slug}/data.json (generated_at: ${previousData.generated_at})`);
} catch {
  console.error(`[refresh] No existing data.json for ${slug} — first run`);
}

console.error(`[refresh] Querying CrateDB for ${slug}…`);
const data = await runQuery({ query });
console.error(`[refresh] Query complete`);

let narrative = null;
if (!NO_NARRATIVE) {
  const { generateNarrative } = await import('./lib/claude.mjs');
  narrative = await generateNarrative(data, previousData?.data ?? null);
}

// ---- Serialise output ----
// Query modules with a custom formatOutput (e.g. window.GS_DATA = ...) bypass
// the standard JSON envelope. Standard modules get the full metadata wrapper.
let fileContent;
if (formatOutput) {
  fileContent = formatOutput(data);
} else {
  const payload = {
    generated_at: new Date().toISOString(),
    source: 'cratedb',
    slug,
    narrative,
    data,
  };
  fileContent = JSON.stringify(payload, null, 2) + '\n';
}

// ---- Output ----
if (DRY_RUN) {
  process.stdout.write(fileContent);
  console.error('\n[refresh] --dry-run: nothing written or committed.');
  process.exit(0);
}

if (LOCAL) {
  writeFileSync(dataPath, fileContent);
  console.error(`[refresh] --local: wrote ${dataPath}`);
  process.exit(0);
}

const { publish } = await import('./lib/publish.mjs');
const result = await publish(slug, [{ name: outputFile, content: fileContent }]);
console.error(`[refresh] Committed. SHA: ${result.commitSha}`);
