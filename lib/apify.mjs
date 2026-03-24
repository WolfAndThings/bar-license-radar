import { URL } from 'node:url';

import { normalizeWhitespace, stripTags } from './html.mjs';

const APIFY_API = 'https://api.apify.com/v2';
const USER_AGENT = 'Mozilla/5.0 (compatible; BarLicenseRadar/1.0; +https://github.com)';
const SEARCH_ACTOR_ID = process.env.APIFY_SEARCH_ACTOR_ID || 'apify/google-search-scraper';
const PLACEHOLDER_EMAIL_PATTERNS = [/^user@domain\.com$/i, /^email@domain\.com$/i, /^test@test\.com$/i, /@example\./i];
const EXCLUDED_EMAIL_DOMAINS = new Set(['minneapolismn.gov', 'stpaul.gov', 'stpaul.legistar.com']);

const EXCLUDED_DOMAINS = new Set([
  'assemblyusa.org',
  'bizapedia.com',
  'documentcloud.org',
  'facebook.com',
  'finance-commerce.com',
  'instagram.com',
  'linkedin.com',
  'maps.google.com',
  'motioncount.com',
  'google.com',
  'googleusercontent.com',
  'granicus.com',
  'youtube.com',
  'stpaul.legistar.com',
  'lims.minneapolismn.gov',
  'minneapolismn.gov',
  'stpaul.gov'
]);

let cachedApifySelection = null;
let apifyDiagnostics = {
  candidate_sources: [],
  selected_source: '',
  selected: false,
  last_error: '',
  auth_failed_sources: []
};

function parseApifyCandidates() {
  const raw = process.env.APIFY_TOKEN_CANDIDATES_JSON || '';
  if (!raw) {
    const token = (process.env.APIFY_TOKEN || '').trim();
    return token ? [{ source: 'shell-env', token }] : [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        source: normalizeWhitespace(entry?.source || ''),
        token: String(entry?.token || '').trim()
      }))
      .filter((entry) => entry.source && entry.token);
  } catch {
    return [];
  }
}

function getApifyCandidates() {
  const candidates = parseApifyCandidates();
  apifyDiagnostics = {
    ...apifyDiagnostics,
    candidate_sources: candidates.map((candidate) => candidate.source)
  };
  return candidates;
}

function markApifySelection(source, token) {
  cachedApifySelection = { source, token };
  apifyDiagnostics = {
    ...apifyDiagnostics,
    selected_source: source,
    selected: true,
    last_error: ''
  };
}

function markApifyAuthFailure(source, error) {
  const authFailures = new Set(apifyDiagnostics.auth_failed_sources || []);
  authFailures.add(source);
  apifyDiagnostics = {
    ...apifyDiagnostics,
    auth_failed_sources: [...authFailures],
    last_error: error?.message || String(error || '')
  };
}

function markApifyFailure(error) {
  apifyDiagnostics = {
    ...apifyDiagnostics,
    last_error: error?.message || String(error || '')
  };
}

function isAuthError(error) {
  return /HTTP\s+(401|403)\b/i.test(error?.message || '');
}

export function getApifyDiagnostics() {
  return {
    ...apifyDiagnostics
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
  }

  return response.json();
}

function actorRef(actorId) {
  return actorId.replace('/', '~');
}

export async function runGoogleQueries(queries, { resultsPerPage = 6, timeoutMs = 180000 } = {}) {
  const candidates = cachedApifySelection ? [cachedApifySelection] : getApifyCandidates();
  if (!candidates.length) return [];

  const cleanQueries = [...new Set(queries.map((query) => normalizeWhitespace(query)).filter(Boolean))];
  if (!cleanQueries.length) return [];

  const payload = {
    queries: cleanQueries.join('\n'),
    maxPagesPerQuery: 1,
    resultsPerPage,
    languageCode: 'en',
    mobileResults: false,
    includeUnfilteredResults: false,
    countryCode: 'us'
  };

  let start = null;
  let token = '';
  let selectedSource = '';
  let lastError = null;

  for (const candidate of candidates) {
    try {
      start = await fetchJson(
        `${APIFY_API}/acts/${actorRef(SEARCH_ACTOR_ID)}/runs?token=${encodeURIComponent(candidate.token)}`,
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      token = candidate.token;
      selectedSource = candidate.source;
      markApifySelection(candidate.source, candidate.token);
      break;
    } catch (error) {
      lastError = error;
      if (isAuthError(error)) {
        markApifyAuthFailure(candidate.source, error);
        continue;
      }
      markApifyFailure(error);
      throw error;
    }
  }

  if (!start || !token) {
    throw lastError || new Error('Apify token not configured.');
  }

  const runId = start?.data?.id;
  if (!runId) throw new Error('Apify run did not return an ID.');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(5000);
    const statusResp = await fetchJson(`${APIFY_API}/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
    const status = statusResp?.data?.status;
    const datasetId = statusResp?.data?.defaultDatasetId;
    if (status === 'SUCCEEDED' && datasetId) {
      const datasetUrl = `${APIFY_API}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&clean=true&format=json`;
      markApifySelection(selectedSource, token);
      return fetchJson(datasetUrl);
    }
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status.toLowerCase()}.`);
    }
  }

  throw new Error('Apify run timed out.');
}

export function flattenOrganicResults(items = []) {
  const flattened = [];
  for (const item of items) {
    const query = item?.searchQuery?.term || item?.searchQuery?.query || item?.searchQuery || '';
    for (const organic of item?.organicResults || []) {
      flattened.push({
        query,
        position: organic?.position ?? null,
        title: normalizeWhitespace(organic?.title || ''),
        url: normalizeWhitespace(organic?.url || ''),
        description: normalizeWhitespace(organic?.description || organic?.snippet || '')
      });
    }
  }
  return flattened;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function extractEmail(input = '') {
  const match = String(input).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = match ? match[0] : '';
  if (!email || PLACEHOLDER_EMAIL_PATTERNS.some((pattern) => pattern.test(email))) return '';
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return EXCLUDED_EMAIL_DOMAINS.has(domain) ? '' : email;
}

function extractPhone(input = '') {
  const text = String(input);
  const formatted = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\(\d{3}\)\s*\d{3}[\s.-]\d{4})/);
  if (formatted) return normalizeWhitespace(formatted[0]).replace(/[.,;:]+$/, '');

  const labeled = text.match(/(?:phone|call|tel)[^0-9]{0,8}(\d{10})/i);
  return labeled ? labeled[1] : '';
}

function extractNamedContact(input = '') {
  const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+),?\s+(co-owner|owner|founder|chef|partner|manager|president|operator)\b/i;
  const match = String(input).match(pattern);
  if (!match) return { name: '', role: '' };
  return {
    name: normalizeWhitespace(match[1]),
    role: normalizeWhitespace(match[2].toLowerCase())
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchWebsiteSignals(url) {
  try {
    const html = await fetchText(url);
    const bodyText = stripTags(html).slice(0, 12000);
    const email = extractEmail(html) || extractEmail(bodyText);
    const phone = extractPhone(html) || extractPhone(bodyText);
    const summary = normalizeWhitespace(
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
        ''
    );
    const named = extractNamedContact(bodyText);
    return {
      email: email || '',
      phone: phone || '',
      summary,
      contactName: named.name,
      contactRole: named.role
    };
  } catch {
    return {
      email: '',
      phone: '',
      summary: '',
      contactName: '',
      contactRole: ''
    };
  }
}

function buildQueriesForLead(lead) {
  const business = lead.business_name || lead.dba_name || '';
  const city = lead.source_city || '';
  const address = lead.address || '';
  const applicant = lead.applicant_entity || '';

  return [
    business && city ? `"${business}" "${city}" bar` : '',
    business && address ? `"${business}" "${address}"` : '',
    applicant && business ? `"${applicant}" "${business}" owner` : '',
    business && city ? `"${business}" "${city}" contact` : ''
  ].filter(Boolean);
}

function withEnrichedDefaults(lead, extra = {}) {
  return {
    ...lead,
    enriched_contact_name: lead.enriched_contact_name || '',
    enriched_contact_role: lead.enriched_contact_role || '',
    enriched_contact_email: lead.enriched_contact_email || '',
    enriched_contact_phone: lead.enriched_contact_phone || '',
    ...extra
  };
}

function chooseWebsite(lead, organicResults) {
  const businessLower = (lead.business_name || '').toLowerCase();
  const applicantLower = (lead.applicant_entity || '').toLowerCase();
  const businessTokens = businessLower.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);

  for (const result of organicResults) {
    const domain = getDomain(result.url);
    if (!domain || EXCLUDED_DOMAINS.has(domain) || /\.pdf(?:$|\?)/i.test(result.url)) continue;
    if (businessTokens.some((token) => domain.includes(token))) return result.url;
  }

  for (const result of organicResults) {
    const domain = getDomain(result.url);
    if (!domain || EXCLUDED_DOMAINS.has(domain) || /\.pdf(?:$|\?)/i.test(result.url)) continue;
    const title = result.title.toLowerCase();
    if (businessLower && title.includes(businessLower) && !/\.(gov|org)$/i.test(domain)) return result.url;
    if (applicantLower && title.includes(applicantLower) && !/\.(gov|org)$/i.test(domain)) return result.url;
  }

  return '';
}

export async function enrichLead(lead) {
  const candidates = cachedApifySelection ? [cachedApifySelection] : getApifyCandidates();
  if (!candidates.length) {
    return withEnrichedDefaults(lead, {
      enrichment_status: 'skipped-no-apify'
    });
  }

  const queries = buildQueriesForLead(lead);
  if (!queries.length) {
    return withEnrichedDefaults(lead, {
      enrichment_status: 'skipped-no-queries'
    });
  }

  try {
    const items = await runGoogleQueries(queries);
    const organic = flattenOrganicResults(items);
    const topResults = organic.slice(0, 5).map((result) => ({
      query: result.query,
      title: result.title,
      url: result.url,
      description: result.description
    }));

    const snippetText = organic
      .map((result) => `${result.title}. ${result.description}`)
      .join(' ')
      .trim();
    const websiteUrl = lead.website_url || chooseWebsite(lead, organic);
    const websiteSignals = websiteUrl ? await fetchWebsiteSignals(websiteUrl) : {};
    const snippetNamed = extractNamedContact(snippetText);

    return withEnrichedDefaults(lead, {
      website_url: websiteUrl || lead.website_url || '',
      enriched_contact_email: lead.enriched_contact_email || websiteSignals.email || '',
      enriched_contact_phone: lead.enriched_contact_phone || websiteSignals.phone || '',
      enriched_contact_name: lead.enriched_contact_name || snippetNamed.name || websiteSignals.contactName || '',
      enriched_contact_role: lead.enriched_contact_role || snippetNamed.role || websiteSignals.contactRole || '',
      public_signals: {
        queries,
        top_results: topResults,
        website_summary: websiteSignals.summary || topResults[0]?.description || ''
      },
      enrichment_status: 'ok'
    });
  } catch (error) {
    return withEnrichedDefaults(lead, {
      enrichment_status: `error:${error.message}`
    });
  }
}
