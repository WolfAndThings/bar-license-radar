import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeLead } from './analyze.mjs';
import { enrichLead, getApifyDiagnostics } from './apify.mjs';
import { collectFargoLeads, collectMinneapolisLeads, collectSiouxFallsLeads, collectStPaulLeads } from './collectors.mjs';
import { hydrateDistributorSignal } from './distributor.mjs';
import { hydrateMenuSignals } from './menu.mjs';
import { getPropertyRadarDiagnostics, hydratePropertyRadar } from './propertyRadar.mjs';
import { buildSuggestedFollowUp } from './suggest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const LEADS_PATH = path.join(DATA_DIR, 'leads.json');
const META_PATH = path.join(DATA_DIR, 'meta.json');
const JUST_MISSED_WINDOW_DAYS = 180;

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

function withEnrichmentDefaults(lead, enrichmentStatus = lead.enrichment_status || '') {
  return {
    ...lead,
    website_url: lead.website_url || '',
    enriched_contact_name: lead.enriched_contact_name || '',
    enriched_contact_role: lead.enriched_contact_role || '',
    enriched_contact_email: lead.enriched_contact_email || '',
    enriched_contact_phone: lead.enriched_contact_phone || '',
    public_signals: lead.public_signals || {
      queries: [],
      top_results: [],
      website_summary: ''
    },
    enrichment_status: enrichmentStatus,
    property_radar_status: lead.property_radar_status || '',
    property_radar_match_label: lead.property_radar_match_label || '',
    property_radar_radar_id: lead.property_radar_radar_id || '',
    property_radar_owner_name: lead.property_radar_owner_name || '',
    property_radar_owner_role: lead.property_radar_owner_role || '',
    property_radar_owner_email: lead.property_radar_owner_email || '',
    property_radar_owner_phone: lead.property_radar_owner_phone || '',
    property_radar_listing_status: lead.property_radar_listing_status || '',
    property_radar_listing_type: lead.property_radar_listing_type || '',
    property_radar_listing_price: lead.property_radar_listing_price || '',
    property_radar_listing_date: lead.property_radar_listing_date || '',
    property_radar_days_on_market: lead.property_radar_days_on_market || '',
    property_radar_available_equity: lead.property_radar_available_equity || '',
    property_radar_total_loan_balance: lead.property_radar_total_loan_balance || '',
    property_radar_equity_percent: lead.property_radar_equity_percent || '',
    property_radar_distress_score: lead.property_radar_distress_score || '',
    property_radar_is_underwater: Boolean(lead.property_radar_is_underwater),
    property_radar_is_listed_for_sale: Boolean(lead.property_radar_is_listed_for_sale),
    property_radar_in_foreclosure: Boolean(lead.property_radar_in_foreclosure),
    property_radar_in_tax_delinquency: Boolean(lead.property_radar_in_tax_delinquency),
    property_radar_in_bankruptcy: Boolean(lead.property_radar_in_bankruptcy),
    property_radar_is_bank_owned: Boolean(lead.property_radar_is_bank_owned),
    property_radar_has_open_liens: Boolean(lead.property_radar_has_open_liens),
    property_radar_has_recent_eviction: Boolean(lead.property_radar_has_recent_eviction),
    property_radar_property_pressure_label: lead.property_radar_property_pressure_label || 'Unknown',
    property_radar_property_pressure_summary:
      lead.property_radar_property_pressure_summary || 'No PropertyRadar property pressure signal yet.',
    property_radar_area_pressure_label: lead.property_radar_area_pressure_label || 'Unknown',
    property_radar_area_pressure_summary: lead.property_radar_area_pressure_summary || 'No nearby sale activity signal yet.',
    property_radar_area_for_sale_count: lead.property_radar_area_for_sale_count || 0,
    property_radar_area_listing_types: Array.isArray(lead.property_radar_area_listing_types)
      ? lead.property_radar_area_listing_types
      : [],
    property_radar_next_step: lead.property_radar_next_step || 'No PropertyRadar next step yet.'
  };
}

function isOlderThanDays(dateText = '', days = 45) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > days * 24 * 60 * 60 * 1000;
}

function shouldSkipExpensiveEnrichment(lead, analysis) {
  const lowFit = ['Weak signal / generic code', 'Temporary / event permit', 'Temporary / consumption-only'].includes(
    analysis.sales_fit
  );
  const noOfficialDirectContact = !(lead.contact_name || lead.contact_phone || lead.contact_email);
  const stale = isOlderThanDays(lead.hearing_date || lead.first_public_record_date || '', 45);
  return lowFit || (stale && noOfficialDirectContact && (analysis.sales_likelihood_score ?? 0) < 60);
}

function isTargetOpportunity(analysis) {
  return !['Temporary / event permit', 'Temporary / consumption-only'].includes(analysis.sales_fit);
}

export async function runRefresh() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const warnings = [
    'Minnesota AGE Public Data Access is the preferred statewide approved-license source, but the portal is currently blocking headless automation. This build is currently automating Minneapolis, St. Paul, Fargo, and Sioux Falls public records instead.',
    'Rapid City agenda pages are still behind a Cloudflare challenge, so Rapid City remains a manual watchlist source for now.'
  ];
  const collected = [];

  try {
    const stPaul = await collectStPaulLeads({ daysBack: JUST_MISSED_WINDOW_DAYS });
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

  try {
    const fargo = await collectFargoLeads({ daysBack: JUST_MISSED_WINDOW_DAYS });
    collected.push(...fargo);
  } catch (error) {
    warnings.push(`Fargo collector failed: ${error.message}`);
  }

  try {
    const siouxFalls = await collectSiouxFallsLeads({ daysBack: 120 });
    collected.push(...siouxFalls);
  } catch (error) {
    warnings.push(`Sioux Falls collector failed: ${error.message}`);
  }

  const deduped = sortLeads(dedupeLeads(collected));
  const enriched = [];
  let filteredNonTargetCount = 0;

  for (const lead of deduped) {
    const baseLead = withEnrichmentDefaults(lead);
    const baseAnalysis = analyzeLead(baseLead);
    const shouldSkip = shouldSkipExpensiveEnrichment(baseLead, baseAnalysis);
    let enrichedLead = shouldSkip ? withEnrichmentDefaults(baseLead, 'skipped-low-priority') : await enrichLead(baseLead);

    if (!['Temporary / event permit', 'Temporary / consumption-only'].includes(baseAnalysis.sales_fit)) {
      enrichedLead = await hydratePropertyRadar(enrichedLead);
    }

    if (!shouldSkip) {
      enrichedLead = await hydrateDistributorSignal(await hydrateMenuSignals(enrichedLead));
    }

    const analysis = shouldSkip ? baseAnalysis : analyzeLead(enrichedLead);
    const suggested = buildSuggestedFollowUp(enrichedLead);
    if (!isTargetOpportunity(analysis)) {
      filteredNonTargetCount += 1;
      continue;
    }
    enriched.push({
      ...enrichedLead,
      ...analysis,
      suggested_follow_up_subject: suggested.subject,
      suggested_follow_up_body: suggested.body
    });
  }

  const apify = getApifyDiagnostics();
  const propertyRadar = getPropertyRadarDiagnostics();
  if (!apify.candidate_sources.length) {
    warnings.push('Apify enrichment is not configured. No local token candidates were found.');
  } else if (!apify.selected && apify.last_error) {
    warnings.push(`Apify enrichment is disabled: ${apify.last_error}`);
  } else if (apify.selected_source) {
    warnings.push(`Apify enrichment is active via ${apify.selected_source}.`);
  }

  if (propertyRadar.configured && propertyRadar.last_error) {
    warnings.push(`PropertyRadar enrichment is configured but last request failed: ${propertyRadar.last_error}`);
  }

  if (filteredNonTargetCount) {
    warnings.push(
      `Filtered ${filteredNonTargetCount} temporary or consumption-only permits from the main board because they are not durable distributor opportunities.`
    );
  }

  const meta = {
    generated_at: new Date().toISOString(),
    lead_count: enriched.length,
    cities: [...new Set(enriched.map((lead) => lead.source_city))],
    apify,
    propertyRadar,
    warnings
  };

  await fs.writeFile(LEADS_PATH, JSON.stringify(enriched, null, 2));
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2));

  return {
    leads: enriched,
    meta
  };
}
