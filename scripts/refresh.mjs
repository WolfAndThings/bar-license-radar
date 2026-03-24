import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runRefresh } from '../lib/pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const workspaceDir = path.resolve(rootDir, '..');

function loadDotEnv(root) {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return {};

  const rows = fs.readFileSync(envPath, 'utf8').split('\n');
  const loaded = {};
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
    loaded[key] = value;
  }

  return loaded;
}

function readSharedApifyEnv(workspaceRoot) {
  const envPath = path.join(
    workspaceRoot,
    'chad-command-center',
    '07-resources',
    'local-service-site-engine',
    'config',
    'apify.env'
  );
  if (!fs.existsSync(envPath)) return {};

  const rows = fs.readFileSync(envPath, 'utf8').split('\n');
  const loaded = {};
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const clean = line.startsWith('export ') ? line.slice(7) : line;
    const eq = clean.indexOf('=');
    if (eq < 1) continue;
    const key = clean.slice(0, eq).trim();
    let value = clean.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    loaded[key] = value;
  }

  return loaded;
}

function readMcpApifyToken(workspaceRoot) {
  const mcpPath = path.join(workspaceRoot, '.mcp.json');
  if (!fs.existsSync(mcpPath)) return '';

  try {
    const data = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    return data?.mcpServers?.apify?.env?.APIFY_TOKEN?.trim() || '';
  } catch {
    return '';
  }
}

function collectApifyTokenCandidates() {
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (source, token) => {
    const cleanToken = String(token || '').trim();
    if (!cleanToken || seen.has(cleanToken)) return;
    seen.add(cleanToken);
    candidates.push({ source, token: cleanToken });
  };

  const projectEnv = loadDotEnv(rootDir);
  const sharedEnv = readSharedApifyEnv(workspaceDir);

  pushCandidate('shell-env', process.env.APIFY_TOKEN);
  pushCandidate('project-dotenv', projectEnv.APIFY_TOKEN);
  pushCandidate('shared-apify-env', sharedEnv.APIFY_TOKEN);
  pushCandidate('workspace-mcp', readMcpApifyToken(workspaceDir));

  return candidates;
}

const apifyTokenCandidates = collectApifyTokenCandidates();

if (!process.env.APIFY_TOKEN && apifyTokenCandidates[0]?.token) {
  process.env.APIFY_TOKEN = apifyTokenCandidates[0].token;
}

process.env.APIFY_TOKEN_CANDIDATES_JSON = JSON.stringify(
  apifyTokenCandidates.map(({ source, token }) => ({ source, token }))
);

const result = await runRefresh();
console.log(`Generated ${result.meta.lead_count} leads at ${result.meta.generated_at}`);
if (result.meta.warnings.length) {
  console.log('Warnings:');
  for (const warning of result.meta.warnings) console.log(`- ${warning}`);
}
