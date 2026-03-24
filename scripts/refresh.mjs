import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runRefresh } from '../lib/pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadDotEnv(root) {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;

  const rows = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv(rootDir);

const result = await runRefresh();
console.log(`Generated ${result.meta.lead_count} leads at ${result.meta.generated_at}`);
if (result.meta.warnings.length) {
  console.log('Warnings:');
  for (const warning of result.meta.warnings) console.log(`- ${warning}`);
}
