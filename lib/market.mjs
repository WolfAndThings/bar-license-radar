import { readFile } from 'node:fs/promises';
import { fetchPublicWebsiteSignals, runActorDatasetItems } from './apify.mjs';
import { normalizeWhitespace, slugify } from './html.mjs';
import { hydratePropertyRadar } from './propertyRadar.mjs';

const MARKET_ACTOR_ID = process.env.APIFY_MARKET_ACTOR_ID || 'api-ninja/google-maps-scraper';
const PROPERTYRADAR_MARKET_LIMIT = Math.max(0, Number(process.env.PROPERTYRADAR_MARKET_LIMIT || 18));
const PROPERTYRADAR_MARKET_PER_CITY = Math.max(1, Number(process.env.PROPERTYRADAR_MARKET_PER_CITY || 2));
const MARKET_FETCH_RETRIES = Math.max(1, Number(process.env.MARKET_FETCH_RETRIES || 2));
const MARKET_WEBSITE_SIGNAL_LIMIT = Math.max(0, Number(process.env.MARKET_WEBSITE_SIGNAL_LIMIT || 32));
const MARKET_WEBSITE_SIGNAL_WINDOW_DAYS = Math.max(1, Number(process.env.MARKET_WEBSITE_SIGNAL_WINDOW_DAYS || 180));
const MARKET_WEBSITE_SIGNAL_CONCURRENCY = Math.max(1, Number(process.env.MARKET_WEBSITE_SIGNAL_CONCURRENCY || 4));
const ALCOHOL_TYPE_PATTERN = /\bbar\b|cocktail_bar|sports_bar|wine_bar|pub|brewpub|night_club|lounge|tavern|gastropub|bar_and_grill/;
const EXCLUDED_PRIMARY_TYPE_PATTERN =
  /\bbeauty salon\b|\bbarber shop\b|\bhair salon\b|\bnail salon\b|\bspa\b|\bwellness\b|\bgym\b|\bfitness\b|\byoga\b|\bpilates\b|\bcoffee shop\b|\bcafe\b|\bbakery\b|\bjuice shop\b|\bsmoothie shop\b|\btea house\b|\bdessert shop\b/;
const EXCLUDED_NAME_PATTERN =
  /\bbeauty bar\b|\bbrow bar\b|\bblow dry bar\b|\bnail bar\b|\bjuice bar\b|\bcoffee bar\b|\boxygen bar\b|\bsalad bar\b/;
const DEFAULT_MARKETS = [
  { city: 'Minneapolis', state: 'MN', location: 'Minneapolis, MN', textQuery: 'bars', maxResultCount: 60 },
  { city: 'St. Paul', state: 'MN', location: 'Saint Paul, MN', textQuery: 'bars', maxResultCount: 60 },
  { city: 'Duluth', state: 'MN', location: 'Duluth, MN', textQuery: 'bars', maxResultCount: 40 },
  { city: 'Rochester', state: 'MN', location: 'Rochester, MN', textQuery: 'bars', maxResultCount: 40 },
  { city: 'Fargo', state: 'ND', location: 'Fargo, ND', textQuery: 'bars', maxResultCount: 40 },
  { city: 'Grand Forks', state: 'ND', location: 'Grand Forks, ND', textQuery: 'bars', maxResultCount: 40 },
  { city: 'Bismarck', state: 'ND', location: 'Bismarck, ND', textQuery: 'bars', maxResultCount: 40 },
  { city: 'Sioux Falls', state: 'SD', location: 'Sioux Falls, SD', textQuery: 'bars', maxResultCount: 40 },
  { city: 'Rapid City', state: 'SD', location: 'Rapid City, SD', textQuery: 'bars', maxResultCount: 40 }
];

function loadMarketTargets() {
  const raw = String(process.env.APIFY_MARKETS_JSON || '').trim();
  if (!raw) return DEFAULT_MARKETS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_MARKETS;
    return parsed
      .map((entry) => ({
        city: normalizeWhitespace(entry?.city || ''),
        state: normalizeWhitespace(entry?.state || ''),
        location: normalizeWhitespace(entry?.location || ''),
        textQuery: normalizeWhitespace(entry?.textQuery || 'bars'),
        maxResultCount: Number(entry?.maxResultCount || 40)
      }))
      .filter((entry) => entry.city && entry.state && entry.location);
  } catch {
    return DEFAULT_MARKETS;
  }
}

function titleCase(input = '') {
  return String(input)
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeCompare(input = '') {
  return String(input || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function priceRangeText(item = {}) {
  const start = item?.priceRange?.startPrice?.units || '';
  const end = item?.priceRange?.endPrice?.units || '';
  if (!start && !end) return '';
  if (start && end) return `$${start}-$${end}`;
  return `$${start || end}`;
}

function oldestVisibleReviewDate(item = {}) {
  const dates = (Array.isArray(item.reviews) ? item.reviews : [])
    .map((review) => String(review?.publishTime || ''))
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  return dates[0] ? dates[0].toISOString().slice(0, 10) : '';
}

function latestVisibleReviewDate(item = {}) {
  const dates = (Array.isArray(item.reviews) ? item.reviews : [])
    .map((review) => String(review?.publishTime || ''))
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0] ? dates[0].toISOString().slice(0, 10) : '';
}

function daysSince(dateText = '') {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

async function mapWithConcurrency(items, limit, mapper) {
  const queue = [...items];
  const results = [];

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      results.push(await mapper(item));
    }
  });

  await Promise.all(workers);
  return results;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadPreviousMarketRecords() {
  try {
    const raw = await readFile(new URL('../data/market.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addressStateCode(address = '') {
  const match = String(address || '').match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?$/);
  return match ? match[1] : '';
}

function matchesMarketGeography(item = {}, market = {}) {
  const address = normalizeWhitespace(item.formattedAddress || item.shortFormattedAddress || '');
  if (!address) return true;

  const targetState = normalizeWhitespace(market.state || '').toUpperCase();
  const actualState = addressStateCode(address);
  if (targetState && actualState && actualState !== targetState) return false;

  return true;
}

function matchesStoredMarketGeography(record = {}, market = {}) {
  const address = normalizeWhitespace(record.address || '');
  if (!address) return true;

  const targetState = normalizeWhitespace(market.state || '').toUpperCase();
  const actualState = addressStateCode(address);
  if (targetState && actualState && actualState !== targetState) return false;

  return true;
}

function isBarLike(item = {}) {
  const types = (Array.isArray(item.types) ? item.types : []).map((value) => String(value || '').toLowerCase());
  const primary = String(item.primaryType || '').toLowerCase();
  const labels = [item.googleMapsTypeLabel?.text || '', item.primaryTypeDisplayName?.text || '']
    .join(' ')
    .toLowerCase();
  const name = String(item.displayName?.text || item.title || '').toLowerCase();
  const explicitNameSignal = /\bbar\b|pub|tavern|saloon|lounge|tap\b|taproom|cocktail|brewpub/.test(name);
  const strongNameSignal = explicitNameSignal || /\bclub\b|cantina|ale house|speakeasy/.test(name);
  const foodOnlyNameSignal = /\bcafe\b|\bcoffee\b|\bbakery\b|\bbreakfast\b/.test(name);
  const hasContactSignal = Boolean(item.nationalPhoneNumber || item.websiteUri);
  const reviewCount = Number(item.userRatingCount || 0);
  const genericSingleName = /^(bar|lounge|pub|budweiser)$/i.test(name.trim());
  const alcoholTypeSignal = types.some((value) => ALCOHOL_TYPE_PATTERN.test(value)) || ALCOHOL_TYPE_PATTERN.test(primary) || ALCOHOL_TYPE_PATTERN.test(labels);
  const excludedPrimarySignal = EXCLUDED_PRIMARY_TYPE_PATTERN.test(`${primary} ${labels}`) || types.some((value) => EXCLUDED_PRIMARY_TYPE_PATTERN.test(value));

  if (genericSingleName) {
    return false;
  }

  if (EXCLUDED_NAME_PATTERN.test(name)) {
    return false;
  }

  if (excludedPrimarySignal && !alcoholTypeSignal) {
    return false;
  }

  if (foodOnlyNameSignal && !explicitNameSignal) {
    return false;
  }

  if (!strongNameSignal && !hasContactSignal && reviewCount < 3) {
    return false;
  }

  if (types.some((value) => ALCOHOL_TYPE_PATTERN.test(value))) {
    return true;
  }

  if (ALCOHOL_TYPE_PATTERN.test(primary) || /\bbar\b|cocktail|pub|brewpub|sports bar|wine bar|night club|lounge|tavern/.test(labels)) {
    return true;
  }

  if (/\brestaurant\b|cafe\b/.test(`${primary} ${labels}`) && !explicitNameSignal) {
    return false;
  }

  return explicitNameSignal || /\bbar\b|cocktail|pub|brewpub|sports bar|wine bar|night club|lounge|tavern/.test(labels);
}

function isStoredMarketRecordTarget(record = {}, market = {}) {
  if (!matchesStoredMarketGeography(record, market)) return false;

  const name = String(record.business_name || '').toLowerCase();
  const primary = String(record.primary_type || '').toLowerCase();
  const typeText = `${primary} ${record.account_type_label || ''}`.toLowerCase();
  const alcoholSignal =
    ALCOHOL_TYPE_PATTERN.test(typeText) ||
    /\bbar\b|\bpub\b|\btavern\b|\blounge\b|\btaproom\b|\bbrewpub\b|\bcocktail\b|\bsaloon\b|\bgrill\b|\btaphouse\b/.test(name);
  const excludedPrimarySignal = EXCLUDED_PRIMARY_TYPE_PATTERN.test(primary);

  if (EXCLUDED_NAME_PATTERN.test(name)) return false;
  if (excludedPrimarySignal && !alcoholSignal) return false;
  if (/\bcafe\b|\bcoffee\b|\bbakery\b|\bjuice\b|\bsmoothie\b/.test(name) && !alcoholSignal) return false;

  return alcoholSignal;
}

function matchRecentActivity(item = {}, activity = []) {
  const itemName = normalizeCompare(item.displayName?.text || item.title || '');
  const itemAddress = normalizeCompare(item.formattedAddress || item.shortFormattedAddress || '');
  if (!itemName) return null;

  return (
    activity.find((lead) => {
      const leadName = normalizeCompare(lead.business_name || lead.dba_name || '');
      const leadAddress = normalizeCompare(lead.address || '');
      if (!leadName) return false;
      const nameMatch = leadName === itemName || leadName.includes(itemName) || itemName.includes(leadName);
      if (!nameMatch) return false;
      if (!itemAddress || !leadAddress) return true;
      return itemAddress.includes(leadAddress) || leadAddress.includes(itemAddress);
    }) || null
  );
}

function marketGapLabel(record) {
  if (record.recent_public_activity) return 'Recent public activity';
  if (!record.website_url && !record.phone) return 'Low digital footprint';
  return 'Quiet account';
}

function marketGapSummary(record) {
  if (record.recent_public_activity) {
    return `Matches public license activity from ${record.recent_public_activity_date || 'the current watch window'}.`;
  }
  if (!record.website_url && !record.phone) {
    return 'No website or phone was returned from the market inventory scrape. This is a coverage gap worth checking manually.';
  }
  return 'No recent public license activity matched this bar in the current watch window.';
}

function buildMarketRecord(item, market, activity) {
  const match = matchRecentActivity(item, activity);
  const oldestReview = oldestVisibleReviewDate(item);
  const latestReview = latestVisibleReviewDate(item);
  const reviewCount = Number(item.userRatingCount || 0);
  const rating = typeof item.rating === 'number' ? item.rating.toFixed(1) : '';
  const name = normalizeWhitespace(item.displayName?.text || item.title || '');

  const record = {
    id: `market-${slugify(`${market.city}-${name}-${item.id || item.formattedAddress || ''}`)}`,
    source_city: market.city,
    source_state: market.state,
    business_name: name,
    address: normalizeWhitespace(item.formattedAddress || item.shortFormattedAddress || ''),
    phone: normalizeWhitespace(item.nationalPhoneNumber || ''),
    website_url: normalizeWhitespace(item.websiteUri || ''),
    google_maps_url: normalizeWhitespace(item.googleMapsUri || item.googleMapsLinks?.placeUri || ''),
    business_status: normalizeWhitespace(item.businessStatus || ''),
    open_now: Boolean(item.currentOpeningHours?.openNow ?? item.regularOpeningHours?.openNow),
    primary_type: normalizeWhitespace(item.primaryTypeDisplayName?.text || item.googleMapsTypeLabel?.text || titleCase(item.primaryType || '')),
    rating,
    review_count: reviewCount,
    price_range: priceRangeText(item),
    oldest_visible_review_date: oldestReview,
    latest_visible_review_date: latestReview,
    oldest_visible_review_summary: oldestReview
      ? `Oldest visible Google review in the current sample: ${oldestReview}.`
      : 'No dated Google review was returned in the current sample.',
    recent_public_activity: Boolean(match),
    recent_public_activity_date: match?.first_public_record_date || match?.hearing_date || '',
    recent_public_activity_summary: match
      ? `${match.business_name || match.dba_name || 'This venue'} matched recent public license activity.`
      : 'No recent public license activity matched this venue.',
    recent_public_activity_fit: match?.sales_fit || '',
    market_refresh_status: 'live',
    website_signal_status: '',
    website_signal_summary: '',
    website_signal_contact_name: '',
    website_signal_contact_role: '',
    website_signal_contact_email: '',
    website_signal_contact_phone: '',
    gap_label: '',
    gap_summary: ''
  };

  record.gap_label = marketGapLabel(record);
  record.gap_summary = marketGapSummary(record);
  return record;
}

async function fetchMarketItems(market) {
  let lastError = null;

  for (let attempt = 1; attempt <= MARKET_FETCH_RETRIES; attempt += 1) {
    try {
      return await runActorDatasetItems(
        MARKET_ACTOR_ID,
        {
          location: market.location,
          textQuery: market.textQuery || 'bars',
          maxResultCount: Math.max(40, Number(market.maxResultCount || 40)),
          scrapeAllPlaces: false,
          includeContacts: false,
          languageCode: 'en'
        },
        { timeoutMs: 240000 }
      );
    } catch (error) {
      lastError = error;
      if (attempt < MARKET_FETCH_RETRIES) {
        await wait(1200 * attempt);
      }
    }
  }

  throw lastError || new Error('Market inventory run failed.');
}

function withMarketPropertyDefaults(record, status = record.property_radar_status || 'not_checked') {
  return {
    ...record,
    property_radar_status: status,
    property_radar_match_label: record.property_radar_match_label || '',
    property_radar_site_address: record.property_radar_site_address || '',
    property_radar_owner_name: record.property_radar_owner_name || '',
    property_radar_owner_role: record.property_radar_owner_role || '',
    property_radar_owner_email: record.property_radar_owner_email || '',
    property_radar_owner_phone: record.property_radar_owner_phone || '',
    property_radar_owner_location_type: record.property_radar_owner_location_type || '',
    property_radar_owner_location_label: record.property_radar_owner_location_label || 'Unknown',
    property_radar_owner_location_summary:
      record.property_radar_owner_location_summary ||
      (status === 'not_checked' ? 'Not checked in the daily PropertyRadar sample for owner location.' : 'No owner-location signal yet.'),
    property_radar_phone_tie_type: record.property_radar_phone_tie_type || '',
    property_radar_phone_tie_label: record.property_radar_phone_tie_label || 'Unknown',
    property_radar_phone_tie_summary:
      record.property_radar_phone_tie_summary ||
      (status === 'not_checked' ? 'Not checked in the daily PropertyRadar sample for owner-phone tie.' : 'No phone-tie signal yet.'),
    property_radar_listing_status: record.property_radar_listing_status || '',
    property_radar_listing_type: record.property_radar_listing_type || '',
    property_radar_listing_price: record.property_radar_listing_price || '',
    property_radar_listing_date: record.property_radar_listing_date || '',
    property_radar_days_on_market: record.property_radar_days_on_market || '',
    property_radar_available_equity: record.property_radar_available_equity || '',
    property_radar_total_loan_balance: record.property_radar_total_loan_balance || '',
    property_radar_equity_percent: record.property_radar_equity_percent || '',
    property_radar_distress_score: record.property_radar_distress_score || '',
    property_radar_is_underwater: Boolean(record.property_radar_is_underwater),
    property_radar_is_listed_for_sale: Boolean(record.property_radar_is_listed_for_sale),
    property_radar_in_foreclosure: Boolean(record.property_radar_in_foreclosure),
    property_radar_in_tax_delinquency: Boolean(record.property_radar_in_tax_delinquency),
    property_radar_in_bankruptcy: Boolean(record.property_radar_in_bankruptcy),
    property_radar_is_bank_owned: Boolean(record.property_radar_is_bank_owned),
    property_radar_property_pressure_label:
      record.property_radar_property_pressure_label || (status === 'not_checked' ? 'Not checked' : 'Unknown'),
    property_radar_property_pressure_summary:
      record.property_radar_property_pressure_summary ||
      (status === 'not_checked'
        ? 'Not checked in the daily PropertyRadar sample for market bars.'
        : 'No PropertyRadar property pressure signal yet.'),
    property_radar_area_pressure_label:
      record.property_radar_area_pressure_label || (status === 'not_checked' ? 'Not checked' : 'Unknown'),
    property_radar_area_pressure_summary:
      record.property_radar_area_pressure_summary ||
      (status === 'not_checked'
        ? 'Not checked in the daily PropertyRadar sample for nearby area sales.'
        : 'No nearby sale activity signal yet.'),
    property_radar_next_step:
      record.property_radar_next_step ||
      (status === 'not_checked'
        ? 'Run a PropertyRadar check for this bar if it becomes a priority account.'
        : 'No PropertyRadar next step yet.')
  };
}

function withMarketWebsiteDefaults(record, status = record.website_signal_status || '') {
  return {
    ...record,
    website_signal_status: status,
    website_signal_summary: record.website_signal_summary || '',
    website_signal_contact_name: record.website_signal_contact_name || '',
    website_signal_contact_role: record.website_signal_contact_role || '',
    website_signal_contact_email: record.website_signal_contact_email || '',
    website_signal_contact_phone: record.website_signal_contact_phone || ''
  };
}

function isRecentMarketAccount(record) {
  const ageDays = daysSince(record.oldest_visible_review_date || '');
  return ageDays !== null && ageDays <= MARKET_WEBSITE_SIGNAL_WINDOW_DAYS;
}

function selectWebsiteSignalCandidates(records = []) {
  if (!MARKET_WEBSITE_SIGNAL_LIMIT) return [];

  return [...records]
    .filter((record) => isRecentMarketAccount(record) && record.website_url)
    .sort((a, b) => {
      const ageDelta = (daysSince(a.oldest_visible_review_date || '') ?? 9999) - (daysSince(b.oldest_visible_review_date || '') ?? 9999);
      if (ageDelta !== 0) return ageDelta;
      return Number(b.review_count || 0) - Number(a.review_count || 0);
    })
    .slice(0, MARKET_WEBSITE_SIGNAL_LIMIT);
}

function marketPropertyRadarScore(record) {
  const reviewAge = daysSince(record.oldest_visible_review_date);
  let score = 0;

  if (record.recent_public_activity) score += 60;
  if (!record.website_url) score += 30;
  if (!record.phone) score += 24;
  if (record.gap_label === 'Low digital footprint') score += 22;
  if (record.gap_label === 'Quiet account') score += 10;
  if (reviewAge !== null && reviewAge >= 365) score += 18;
  else if (reviewAge !== null && reviewAge >= 180) score += 10;
  if (Number(record.review_count || 0) < 80) score += 6;

  return score;
}

function selectPropertyRadarMarketCandidates(records = []) {
  if (!PROPERTYRADAR_MARKET_LIMIT) return [];

  const grouped = new Map();
  for (const record of records) {
    const city = record.source_city || 'Unknown';
    if (!grouped.has(city)) grouped.set(city, []);
    grouped.get(city).push(record);
  }

  const candidates = [];
  for (const cityRecords of grouped.values()) {
    const ranked = [...cityRecords].sort((a, b) => {
      const scoreDelta = marketPropertyRadarScore(b) - marketPropertyRadarScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      return (a.business_name || '').localeCompare(b.business_name || '');
    });
    candidates.push(...ranked.slice(0, PROPERTYRADAR_MARKET_PER_CITY));
  }

  return [...new Map(candidates.map((record) => [record.id, record])).values()]
    .sort((a, b) => {
      const scoreDelta = marketPropertyRadarScore(b) - marketPropertyRadarScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      return (a.business_name || '').localeCompare(b.business_name || '');
    })
    .slice(0, PROPERTYRADAR_MARKET_LIMIT);
}

export async function buildMarketInventory(activity = []) {
  const warnings = [];
  const records = [];
  const previousRecords = await loadPreviousMarketRecords();

  for (const market of loadMarketTargets()) {
    try {
      const items = await fetchMarketItems(market);

      const deduped = [...new Map((Array.isArray(items) ? items : []).map((item) => [item.id || item.name || JSON.stringify(item), item])).values()];
      for (const item of deduped) {
        if (!matchesMarketGeography(item, market)) continue;
        if (!isBarLike(item)) continue;
        records.push(buildMarketRecord(item, market, activity));
      }
    } catch (error) {
      const fallback = previousRecords
        .filter((record) => record.source_city === market.city && record.source_state === market.state)
        .filter((record) => isStoredMarketRecordTarget(record, market))
        .map((record) => ({
          ...record,
          market_refresh_status: 'stale'
        }));

      if (fallback.length) {
        records.push(...fallback);
        warnings.push(`${market.city} market inventory failed: ${error.message}. Using previous snapshot (${fallback.length} accounts).`);
      } else {
        warnings.push(`${market.city} market inventory failed: ${error.message}`);
      }
    }
  }

  const uniqueRecords = [...new Map(records.map((record) => [`${record.source_city}::${normalizeCompare(record.business_name)}::${normalizeCompare(record.address)}`, record])).values()];
  const preparedRecords = uniqueRecords.map((record) => withMarketPropertyDefaults(record));
  const candidateIds = new Set(selectPropertyRadarMarketCandidates(preparedRecords).map((record) => record.id));
  const hydratedRecords = [];

  for (const record of preparedRecords) {
    if (!candidateIds.has(record.id)) {
      hydratedRecords.push(record);
      continue;
    }

    try {
      const enriched = await hydratePropertyRadar(record);
      hydratedRecords.push(withMarketPropertyDefaults(enriched, enriched.property_radar_status || 'not_checked'));
    } catch {
      hydratedRecords.push(withMarketPropertyDefaults(record, 'error'));
    }
  }

  const websiteCandidates = selectWebsiteSignalCandidates(hydratedRecords);
  const websiteCandidateIds = new Set(websiteCandidates.map((record) => record.id));
  const websiteEnrichedEntries = await mapWithConcurrency(websiteCandidates, MARKET_WEBSITE_SIGNAL_CONCURRENCY, async (record) => {
    try {
      const signals = await fetchPublicWebsiteSignals(record.website_url);
      return [
        record.id,
        withMarketWebsiteDefaults(
          {
            ...record,
            website_signal_summary: signals.summary || record.website_signal_summary || '',
            website_signal_contact_name: signals.contactName || record.website_signal_contact_name || '',
            website_signal_contact_role: signals.contactRole || record.website_signal_contact_role || '',
            website_signal_contact_email: signals.email || record.website_signal_contact_email || '',
            website_signal_contact_phone: signals.phone || record.website_signal_contact_phone || ''
          },
          signals.status || 'ok'
        )
      ];
    } catch {
      return [record.id, withMarketWebsiteDefaults(record, 'error')];
    }
  });

  const websiteEnrichedMap = new Map(websiteEnrichedEntries);
  const finalRecords = hydratedRecords.map((record) => {
    if (websiteEnrichedMap.has(record.id)) return websiteEnrichedMap.get(record.id);
    if (websiteCandidateIds.has(record.id)) return withMarketWebsiteDefaults(record, record.website_signal_status || 'ok-empty');
    if (isRecentMarketAccount(record) && !record.website_url) return withMarketWebsiteDefaults(record, record.website_signal_status || 'skipped-no-website');
    return withMarketWebsiteDefaults(record, record.website_signal_status || '');
  });

  const matchedCount = finalRecords.filter((record) => record.property_radar_status === 'matched').length;
  const checkedCount = finalRecords.filter((record) => record.property_radar_status && record.property_radar_status !== 'not_checked').length;
  const staleCount = finalRecords.filter((record) => record.market_refresh_status === 'stale').length;
  const websiteCheckedCount = finalRecords.filter((record) => record.website_signal_status && record.website_signal_status !== 'skipped-no-website').length;

  return {
    records: finalRecords.sort((a, b) => a.business_name.localeCompare(b.business_name)),
    meta: {
      actor_id: MARKET_ACTOR_ID,
      market_count: uniqueRecords.length,
      property_radar_checked_count: checkedCount,
      property_radar_matched_count: matchedCount,
      property_radar_limit: PROPERTYRADAR_MARKET_LIMIT,
      website_signal_checked_count: websiteCheckedCount,
      stale_count: staleCount,
      warnings
    }
  };
}
