import { inferDistributorFromBrands } from './brandLookup.mjs';

function compactSentence(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

function normalizeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compactSentence(value)).filter(Boolean))];
}

function cleanDistributorName(value = '') {
  return compactSentence(String(value).replace(/[.;:,]+$/, ''));
}

function labelFromStatus(status = '') {
  if (status === 'exact') return 'Exact';
  if (status === 'brand_inferred') return 'Brand-inferred';
  return 'Unknown';
}

function detectDistributorFromText(text = '') {
  const patterns = [
    /\b(?:distributed by|distributor|wholesaler|supplied by)\s+([A-Z0-9][A-Za-z0-9&,'()./\-\s]{2,80})/i,
    /\b([A-Z0-9][A-Za-z0-9&,'()./\-\s]{2,80})\s+(?:is the distributor|is the wholesaler)\b/i
  ];

  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (!match) continue;
    const candidate = cleanDistributorName(match[1]);
    if (candidate && !/^(license|liquor|wine|malt|beer|strong)$/i.test(candidate)) return candidate;
  }

  return '';
}

function inferFromLeadText(lead) {
  const textSources = [
    { name: 'official record', text: lead.official_title || '' },
    { name: 'official summary', text: lead.official_summary || '' },
    { name: 'website summary', text: lead.public_signals?.website_summary || '' }
  ];

  for (const source of textSources) {
    const distributor = detectDistributorFromText(source.text);
    if (!distributor) continue;
    return {
      distributor_name: distributor,
      distributor_signal_type: 'exact',
      distributor_confidence_label: labelFromStatus('exact'),
      distributor_evidence: `Public ${source.name} text names ${distributor} as the distributor or supplier.`,
      distributor_source_scope: 'retailer_account',
      distributor_source_name: source.name,
      distributor_source_url: source.name === 'website summary' ? lead.website_url || '' : lead.official_record_url || ''
    };
  }

  return null;
}

async function inferFromMenuBrands(lead) {
  const menuBrands = Array.isArray(lead.menu_brands) ? lead.menu_brands : [];
  if (!menuBrands.length) return null;

  const lookup = await inferDistributorFromBrands(lead.source_state, menuBrands);
  if (lookup.confidence !== 'brand_inferred' || !lookup.distributorName) {
    return {
      distributor_lookup_note: lookup.note || '',
      distributor_lookup_supplier: lookup.supplierName || '',
      distributor_lookup_source_name: lookup.source?.name || '',
      distributor_lookup_source_url: lookup.source?.siteUrl || '',
      distributor_brands: normalizeList(lookup.matchedBrands)
    };
  }

  return {
    distributor_name: lookup.distributorName,
    distributor_signal_type: 'brand_inferred',
    distributor_confidence_label: labelFromStatus('brand_inferred'),
    distributor_evidence: lookup.note,
    distributor_source_scope: 'brand_level',
    distributor_source_name: lookup.source?.name || '',
    distributor_source_url: lookup.source?.siteUrl || '',
    distributor_brands: normalizeList(lookup.matchedBrands),
    distributor_lookup_note: lookup.note || '',
    distributor_lookup_supplier: lookup.supplierName || '',
    distributor_lookup_source_name: lookup.source?.name || '',
    distributor_lookup_source_url: lookup.source?.siteUrl || ''
  };
}

function nextStepForLead(lead) {
  if (lead.official_attachments?.length) {
    return 'Review hearing attachments or packet PDFs for wholesaler correspondence, menus, invoices, or delinquent-wholesaler notices.';
  }

  if (lead.website_url) {
    return 'Check the venue website, menus, socials, and photos for carried brands, then map those brands to state active-brand distributor databases.';
  }

  return 'Check menus, socials, photos, or hearing packets for carried brands, then map those brands to state active-brand distributor databases.';
}

function summaryForSignal(lead, state) {
  if (state.distributor_signal_type === 'exact' && state.distributor_name) {
    return `${state.distributor_name} is tied to this lead by direct public text. Treat this as the strongest public distributor signal.`;
  }

  if (state.distributor_signal_type === 'brand_inferred' && state.distributor_name) {
    const brands = normalizeList(state.distributor_brands);
    const brandText = brands.length ? ` for ${brands.join(', ')}` : '';
    return `${state.distributor_name} is a likely distributor${brandText} based on public brand-level distribution data. This is not account-level proof for the specific venue.`;
  }

  if (state.distributor_lookup_note) {
    return state.distributor_lookup_note;
  }

  const business = lead.business_name || 'this account';
  return `No public record currently ties ${business} to a specific wholesaler. Retail liquor-license records usually show the licensee and owners, not the distributor.`;
}

export async function hydrateDistributorSignal(lead) {
  const directSignal = inferFromLeadText(lead);
  const brandSignal = directSignal ? null : await inferFromMenuBrands(lead);
  const prefilledName = cleanDistributorName(lead.distributor_name || '');
  const prefilledStatus =
    lead.distributor_signal_type ||
    (prefilledName ? (normalizeList(lead.distributor_brands).length ? 'brand_inferred' : 'exact') : 'unknown');

  const state = {
    distributor_name: prefilledName,
    distributor_signal_type: ['exact', 'brand_inferred'].includes(prefilledStatus) ? prefilledStatus : 'unknown',
    distributor_confidence_label: labelFromStatus(prefilledStatus),
    distributor_evidence: compactSentence(lead.distributor_evidence || ''),
    distributor_source_scope: lead.distributor_source_scope || (prefilledStatus === 'exact' ? 'retailer_account' : 'unknown'),
    distributor_source_name: lead.distributor_source_name || '',
    distributor_source_url: lead.distributor_source_url || '',
    distributor_brands: normalizeList(lead.distributor_brands),
    distributor_next_step: compactSentence(lead.distributor_next_step || nextStepForLead(lead)),
    distributor_lookup_note: compactSentence(lead.distributor_lookup_note || ''),
    distributor_lookup_supplier: cleanDistributorName(lead.distributor_lookup_supplier || ''),
    distributor_lookup_source_name: compactSentence(lead.distributor_lookup_source_name || ''),
    distributor_lookup_source_url: lead.distributor_lookup_source_url || ''
  };

  const merged = directSignal
    ? {
        ...state,
        ...directSignal
      }
    : brandSignal
      ? {
          ...state,
          ...brandSignal
        }
    : state;

  return {
    ...lead,
    ...merged,
    distributor_confidence_label: labelFromStatus(merged.distributor_signal_type),
    distributor_summary: summaryForSignal(lead, merged)
  };
}
