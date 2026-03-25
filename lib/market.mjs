import { runActorDatasetItems } from './apify.mjs';
import { normalizeWhitespace, slugify } from './html.mjs';

const MARKET_ACTOR_ID = process.env.APIFY_MARKET_ACTOR_ID || 'api-ninja/google-maps-scraper';
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

function isBarLike(item = {}) {
  const types = (Array.isArray(item.types) ? item.types : []).map((value) => String(value || '').toLowerCase());
  const primary = String(item.primaryType || '').toLowerCase();
  const labels = [item.googleMapsTypeLabel?.text || '', item.primaryTypeDisplayName?.text || '']
    .join(' ')
    .toLowerCase();
  const name = String(item.displayName?.text || item.title || '').toLowerCase();
  const explicitNameSignal = /\bbar\b|pub|tavern|saloon|lounge|tap\b|taproom|cocktail|brewpub/.test(name);

  if (types.some((value) => /\bbar\b|cocktail_bar|sports_bar|wine_bar|pub|brewpub|night_club|lounge|tavern/.test(value))) {
    return true;
  }

  if (/\bbar\b|cocktail|pub|brewpub|sports bar|wine bar|night club|lounge|tavern/.test(primary)) {
    return true;
  }

  if (/\brestaurant\b|cafe\b/.test(`${primary} ${labels}`) && !explicitNameSignal) {
    return false;
  }

  return explicitNameSignal || /\bbar\b|cocktail|pub|brewpub|sports bar|wine bar|night club|lounge|tavern/.test(labels);
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
    oldest_visible_review_summary: oldestReview
      ? `Oldest visible Google review in the current sample: ${oldestReview}.`
      : 'No dated Google review was returned in the current sample.',
    recent_public_activity: Boolean(match),
    recent_public_activity_date: match?.first_public_record_date || match?.hearing_date || '',
    recent_public_activity_summary: match
      ? `${match.business_name || match.dba_name || 'This venue'} matched recent public license activity.`
      : 'No recent public license activity matched this venue.',
    recent_public_activity_fit: match?.sales_fit || '',
    gap_label: '',
    gap_summary: ''
  };

  record.gap_label = marketGapLabel(record);
  record.gap_summary = marketGapSummary(record);
  return record;
}

export async function buildMarketInventory(activity = []) {
  const warnings = [];
  const records = [];

  for (const market of loadMarketTargets()) {
    try {
      const items = await runActorDatasetItems(
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

      const deduped = [...new Map((Array.isArray(items) ? items : []).map((item) => [item.id || item.name || JSON.stringify(item), item])).values()];
      for (const item of deduped) {
        if (!isBarLike(item)) continue;
        records.push(buildMarketRecord(item, market, activity));
      }
    } catch (error) {
      warnings.push(`${market.city} market inventory failed: ${error.message}`);
    }
  }

  const uniqueRecords = [...new Map(records.map((record) => [`${record.source_city}::${normalizeCompare(record.business_name)}::${normalizeCompare(record.address)}`, record])).values()];

  return {
    records: uniqueRecords.sort((a, b) => a.business_name.localeCompare(b.business_name)),
    meta: {
      actor_id: MARKET_ACTOR_ID,
      market_count: uniqueRecords.length,
      warnings
    }
  };
}
