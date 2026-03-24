import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeLead } from './analyze.mjs';
import { enrichLead, getApifyDiagnostics } from './apify.mjs';
import { collectMinneapolisLeads, collectStPaulLeads } from './collectors.mjs';
import { hydrateDistributorSignal } from './distributor.mjs';
import { hydrateMenuSignals } from './menu.mjs';
import { buildSuggestedFollowUp } from './suggest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const LEADS_PATH = path.join(DATA_DIR, 'leads.json');
const META_PATH = path.join(DATA_DIR, 'meta.json');

function dedupeLeads(leads) {
  const seen = new Map();
  for (const lead of leads) {
    const key = [
      lead.source_city,
      lead.license_id || '',
      lead.official_record_url || '',
      (lead.business_name || '').toLowerCase(),
      (lead.address || '').toLowerCase()
    ].join('::');

    if (!seen.has(key)) seen.set(key, lead);
  }
  return [...seen.values()];
}

function sortLeads(leads) {
  return [...leads].sort((a, b) => {
    const aDate = a.hearing_date || a.first_public_record_date || '';
    const bDate = b.hearing_date || b.first_public_record_date || '';
    return bDate.localeCompare(aDate);
  });
}

export async function runRefresh() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const warnings = [
    'Minnesota AGE Public Data Access is the preferred statewide approved-license source, but the portal is currently blocking headless automation. This build is using Minneapolis and St. Paul public hearing records as the automated source of truth.'
  ];
  const collected = [];

  try {
    const stPaul = await collectStPaulLeads({ daysBack: 365 });
    collected.push(...stPaul);
  } catch (error) {
    warnings.push(`St. Paul collector failed: ${error.message}`);
  }

  try {
    const minneapolis = await collectMinneapolisLeads({ daysBack: 120 });
    collected.push(...minneapolis);
  } catch (error) {
    warnings.push(`Minneapolis collector failed: ${error.message}`);
  }

  const deduped = sortLeads(dedupeLeads(collected));
  const enriched = [];

  for (const lead of deduped) {
    const enrichedLead = await hydrateDistributorSignal(await hydrateMenuSignals(await enrichLead(lead)));
    const analysis = analyzeLead(enrichedLead);
    const suggested = buildSuggestedFollowUp(enrichedLead);
    enriched.push({
      ...enrichedLead,
      ...analysis,
      suggested_follow_up_subject: suggested.subject,
      suggested_follow_up_body: suggested.body
    });
  }

  const apify = getApifyDiagnostics();
  if (!apify.candidate_sources.length) {
    warnings.push('Apify enrichment is not configured. No local token candidates were found.');
  } else if (!apify.selected && apify.last_error) {
    warnings.push(`Apify enrichment is disabled: ${apify.last_error}`);
  } else if (apify.selected_source) {
    warnings.push(`Apify enrichment is active via ${apify.selected_source}.`);
  }

  const meta = {
    generated_at: new Date().toISOString(),
    lead_count: enriched.length,
    cities: [...new Set(enriched.map((lead) => lead.source_city))],
    apify,
    warnings
  };

  await fs.writeFile(LEADS_PATH, JSON.stringify(enriched, null, 2));
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2));

  return {
    leads: enriched,
    meta
  };
}
