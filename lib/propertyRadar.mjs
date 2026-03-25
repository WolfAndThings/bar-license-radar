const PROPERTY_RADAR_API = 'https://api.propertyradar.com/v1/';
const USER_AGENT = 'Mozilla/5.0 (compatible; BarLicenseRadar/1.0; +https://github.com)';
const FETCH_TIMEOUT_MS = 20000;

const STATE_NAMES = {
  MN: 'Minnesota',
  ND: 'North Dakota',
  SD: 'South Dakota',
  WI: 'Wisconsin'
};

const STREET_STOPWORDS = new Set([
  'N',
  'S',
  'E',
  'W',
  'NORTH',
  'SOUTH',
  'EAST',
  'WEST',
  'ST',
  'STREET',
  'AVE',
  'AVENUE',
  'BLVD',
  'BOULEVARD',
  'RD',
  'ROAD',
  'DR',
  'DRIVE',
  'LN',
  'LANE',
  'CT',
  'COURT',
  'PL',
  'PLACE',
  'PKWY',
  'PARKWAY',
  'CIR',
  'CIRCLE',
  'HWY',
  'HIGHWAY',
  'WAY',
  'TRAIL',
  'TRL',
  'MINNEAPOLIS',
  'SAINT',
  'PAUL',
  'STPAUL',
  'SIOUX',
  'FALLS',
  'FARGO',
  'DULUTH',
  'RAPID',
  'CITY',
  'MN',
  'ND',
  'SD',
  'WI'
]);

let diagnostics = {
  configured: false,
  selected_env: '',
  checked_count: 0,
  matched_count: 0,
  last_error: ''
};

function configuredToken() {
  const keys = ['PROPERTYRADAR_TOKEN', 'PROPERTY_RADAR_TOKEN'];
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      diagnostics = {
        ...diagnostics,
        configured: true,
        selected_env: key
      };
      return value;
    }
  }

  diagnostics = {
    ...diagnostics,
    configured: false,
    selected_env: ''
  };
  return '';
}

function withDefaults(lead, status = lead.property_radar_status || '') {
  return {
    ...lead,
    property_radar_status: status,
    property_radar_match_label: lead.property_radar_match_label || '',
    property_radar_site_address: lead.property_radar_site_address || '',
    property_radar_radar_id: lead.property_radar_radar_id || '',
    property_radar_owner_name: lead.property_radar_owner_name || '',
    property_radar_owner_role: lead.property_radar_owner_role || '',
    property_radar_owner_email: lead.property_radar_owner_email || '',
    property_radar_owner_phone: lead.property_radar_owner_phone || '',
    property_radar_owner_location_type: lead.property_radar_owner_location_type || '',
    property_radar_owner_location_label: lead.property_radar_owner_location_label || 'Unknown',
    property_radar_owner_location_summary:
      lead.property_radar_owner_location_summary || 'No owner-location signal yet.',
    property_radar_phone_tie_type: lead.property_radar_phone_tie_type || '',
    property_radar_phone_tie_label: lead.property_radar_phone_tie_label || 'Unknown',
    property_radar_phone_tie_summary: lead.property_radar_phone_tie_summary || 'No phone-tie signal yet.',
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
    property_radar_area_pressure_summary:
      lead.property_radar_area_pressure_summary || 'No nearby sale activity signal yet.',
    property_radar_area_for_sale_count: lead.property_radar_area_for_sale_count || 0,
    property_radar_area_listing_types: Array.isArray(lead.property_radar_area_listing_types)
      ? lead.property_radar_area_listing_types
      : [],
    property_radar_next_step: lead.property_radar_next_step || 'No PropertyRadar next step yet.'
  };
}

function normalizeWhitespace(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

function canonicalCityName(city = '') {
  const normalized = normalizeWhitespace(city);
  if (/^st[.]?\s+paul$/i.test(normalized)) return 'Saint Paul';
  return normalized;
}

function normalizeSuggestionAddress(input = '') {
  return normalizeWhitespace(input).replace(/\bSt[.]?\s+(?=[A-Z][a-z])/g, 'Saint ');
}

function normalizeAddressText(input = '') {
  return normalizeWhitespace(input)
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStreetNumber(input = '') {
  const match = normalizeAddressText(input).match(/\b(\d+)\b/);
  return match ? match[1] : '';
}

function streetTokens(input = '') {
  return normalizeAddressText(input)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !/^\d{5}$/.test(token))
    .filter((token) => token.length > 1)
    .filter((token) => !STREET_STOPWORDS.has(token));
}

function addressLooksLikeMatch(label = '', leadAddress = '') {
  const labelNumber = extractStreetNumber(label);
  const leadNumber = extractStreetNumber(leadAddress);
  if (leadNumber && labelNumber && leadNumber !== labelNumber) return false;

  const leadStreet = new Set(streetTokens(leadAddress));
  const labelStreet = streetTokens(label);

  if (!leadStreet.size || !labelStreet.length) return Boolean(leadNumber && labelNumber && leadNumber === labelNumber);
  return labelStreet.some((token) => leadStreet.has(token));
}

function normalizeHrefPath(href = '') {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) {
    const url = new URL(href);
    return url.pathname.replace(/^\/v1\//, '');
  }
  return String(href).replace(/^\/+v1\//, '').replace(/^\/+/, '');
}

function buildSuggestionInput(lead) {
  const address = normalizeSuggestionAddress(lead.address || '');
  const city = canonicalCityName(lead.source_city || '');
  const state = normalizeWhitespace(lead.source_state || '');
  const combined = [address, city, state].filter(Boolean).join(' ');
  return normalizeWhitespace(combined);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number.parseFloat(String(value).replace(/[$,% ,]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function asBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isoDate(value = '') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function currency(value) {
  const numeric = parseNumber(value);
  if (numeric === null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(numeric);
}

function percent(value) {
  const numeric = parseNumber(value);
  if (numeric === null) return '';
  return `${Math.round(numeric)}%`;
}

async function fetchJson(pathname, { method = 'GET', query = {}, body } = {}) {
  const token = configuredToken();
  if (!token) throw new Error('PropertyRadar token not configured.');

  const normalizedPath = String(pathname || '').replace(/^\/+/, '');
  const url = new URL(normalizedPath, PROPERTY_RADAR_API);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PropertyRadar HTTP ${response.status}: ${text.slice(0, 240)}`);
    }

    return response.json();
  } catch (error) {
    diagnostics = {
      ...diagnostics,
      last_error: error?.message || String(error || '')
    };
    if (error?.name === 'AbortError') {
      throw new Error(`PropertyRadar timed out after ${FETCH_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stateCriteria(stateCode = '') {
  const state = normalizeWhitespace(stateCode).toUpperCase();
  return state ? [{ name: 'State', value: [state] }] : [];
}

function chooseSuggestion(results = [], lead) {
  const city = canonicalCityName(lead.source_city || '').toLowerCase();
  const stateName = normalizeWhitespace(STATE_NAMES[lead.source_state] || '').toLowerCase();
  const stateCode = normalizeWhitespace(lead.source_state || '').toLowerCase();
  const leadAddress = normalizeWhitespace(lead.address || '');

  const normalized = results
    .map((result) => ({
      label: normalizeWhitespace(result?.Label || ''),
      criteria: Array.isArray(result?.Criteria) ? result.Criteria : []
    }))
    .filter((result) => result.label && result.criteria.length);

  const exact = normalized.find((result) => {
    const text = result.label.toLowerCase();
    const cityValues = result.criteria
      .filter((criterion) => String(criterion?.name || '').toLowerCase() === 'city')
      .flatMap((criterion) => criterion?.value || [])
      .map((value) => normalizeWhitespace(value).toLowerCase());
    const stateValues = result.criteria
      .filter((criterion) => String(criterion?.name || '').toLowerCase() === 'state')
      .flatMap((criterion) => criterion?.value || [])
      .map((value) => normalizeWhitespace(value).toLowerCase());
    const addressValues = result.criteria
      .filter((criterion) => String(criterion?.name || '').toLowerCase() === 'address')
      .flatMap((criterion) => criterion?.value || [])
      .map((value) => normalizeWhitespace(value));

    const cityMatch = !city || cityValues.includes(city) || text.includes(city);
    const stateMatch =
      !stateCode ||
      stateValues.includes(stateCode) ||
      (stateName && text.includes(stateName)) ||
      text.includes(`, ${stateCode} `) ||
      text.endsWith(`, ${stateCode}`);
    const addressMatch =
      !leadAddress ||
      addressValues.some((value) => addressLooksLikeMatch(value, leadAddress)) ||
      addressLooksLikeMatch(result.label, leadAddress);

    return (
      cityMatch &&
      stateMatch &&
      addressMatch
    );
  });

  return exact || null;
}

function personDisplayName(person = {}) {
  const fullName = normalizeWhitespace(
    [person.FirstName, person.MiddleName, person.LastName, person.Suffix].filter(Boolean).join(' ')
  );
  return fullName || normalizeWhitespace(person.EntityName || '');
}

function normalizeContactPrimitive(value = '') {
  let text = normalizeWhitespace(value);
  if (!text) return '';
  if (/^\/v1\//i.test(text)) return '';
  if (/^tel:/i.test(text)) {
    text = text.replace(/^tel:\+?1[- ]?/i, '').replace(/^tel:/i, '');
  } else if (/^mailto:/i.test(text)) {
    text = text.replace(/^mailto:/i, '');
  }
  return normalizeWhitespace(text);
}

function contactEntryText(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return normalizeContactPrimitive(entry);
  if (typeof entry !== 'object') return '';

  return [
    entry.linktext,
    entry.Linktext,
    entry.value,
    entry.Value,
    entry.href,
    entry.Href
  ]
    .map((value) => normalizeContactPrimitive(value))
    .find(Boolean) || '';
}

function hasInlineContactData(entries = []) {
  return Array.isArray(entries) && entries.some((entry) => Boolean(contactEntryText(entry)));
}

function firstContactText(person = {}, fields = []) {
  for (const field of fields) {
    const entries = Array.isArray(person?.[field]) ? person[field] : [];
    for (const entry of entries) {
      const text = contactEntryText(entry);
      if (text) return text;
    }
  }

  return '';
}

function allContactTexts(people = [], fields = []) {
  const seen = new Set();
  const values = [];

  for (const person of Array.isArray(people) ? people : []) {
    for (const field of fields) {
      const entries = Array.isArray(person?.[field]) ? person[field] : [];
      for (const entry of entries) {
        const text = contactEntryText(entry);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        values.push(text);
      }
    }
  }

  return values;
}

function normalizePhoneDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function uniquePhoneDigits(values = []) {
  return [...new Set(values.map((value) => normalizePhoneDigits(value)).filter((value) => value.length >= 10))];
}

function collectBarPhoneDigits(lead = {}) {
  return uniquePhoneDigits([
    lead.contact_phone,
    lead.enriched_contact_phone,
    lead.website_signal_contact_phone,
    lead.phone
  ]);
}

function propertySiteAddress(property = {}, fallback = '') {
  const parts = [
    normalizeWhitespace(property.Address || ''),
    normalizeWhitespace(property.City || ''),
    normalizeWhitespace(property.State || ''),
    normalizeWhitespace(property.ZipFive || '')
  ].filter(Boolean);

  if (!parts.length) return normalizeWhitespace(fallback);
  if (parts.length >= 4) return `${parts[0]}, ${parts[1]}, ${parts[2]} ${parts[3]}`;
  return parts.join(', ');
}

function choosePrimaryPerson(people = []) {
  if (!Array.isArray(people) || !people.length) return null;
  return (
    people.find((person) => asBool(person?.isPrimaryContact)) ||
    people.find((person) => ['Owner', 'Principal'].includes(person?.OwnershipRole)) ||
    people[0]
  );
}

function summarizeProperty(lead = {}, property = {}, primaryPerson, comps = [], ownerPhone = '', ownerEmail = '', siteAddress = '') {
  const listingType = normalizeWhitespace(property.ListingType || '');
  const listingStatus = normalizeWhitespace(property.ListingStatus || '');
  const listingPrice = currency(property.ListingPrice);
  const listingDate = isoDate(property.ListingDate);
  const distressScore = parseNumber(property.DistressScore);
  const equityPercent = percent(property.EquityPercent);
  const availableEquity = currency(property.AvailableEquity);
  const totalLoanBalance = currency(property.TotalLoanBalance);
  const isListedForSale = asBool(property.isListedForSale);
  const isUnderwater = asBool(property.isUnderwater);
  const inForeclosure = asBool(property.inForeclosure) || asBool(property.isPreforeclosure);
  const inTaxDelinquency = asBool(property.inTaxDelinquency);
  const inBankruptcy = asBool(property.inBankruptcyProperty);
  const isBankOwned = asBool(property.isBankOwned);
  const hasOpenLiens = asBool(property.PropertyHasOpenLiens) || asBool(property.PropertyHasOpenPersonLiens);
  const hasRecentEviction = asBool(property.hasRecentEviction);
  const isSameMailing = asBool(property.isSameMailing);
  const isSameMailingOrExempt = asBool(property.isSameMailingOrExempt);
  const isNotSameMailingOrExempt = asBool(property.isNotSameMailingOrExempt);
  const barPhoneDigits = collectBarPhoneDigits(lead);
  const ownerPhoneDigits = normalizePhoneDigits(ownerPhone);
  const matchesBarPhone = Boolean(ownerPhoneDigits && barPhoneDigits.includes(ownerPhoneDigits));

  const directSignals = [];
  if (isListedForSale) {
    directSignals.push(
      `currently listed${listingType ? ` as ${listingType.toLowerCase()}` : ''}${listingPrice ? ` at ${listingPrice}` : ''}`
    );
  }
  if (isUnderwater) directSignals.push('shows as underwater');
  if (inForeclosure) directSignals.push('shows foreclosure pressure');
  if (inTaxDelinquency) directSignals.push('shows tax delinquency');
  if (inBankruptcy) directSignals.push('shows bankruptcy pressure');
  if (isBankOwned) directSignals.push('shows bank-owned status');
  if (hasOpenLiens) directSignals.push('shows open liens');
  if (hasRecentEviction) directSignals.push('shows recent eviction activity');
  if (distressScore !== null && distressScore >= 70) directSignals.push(`has a distress score of ${Math.round(distressScore)}`);

  let propertyPressureLabel = 'Low';
  if (isListedForSale || isUnderwater || inForeclosure || isBankOwned || (distressScore !== null && distressScore >= 70)) {
    propertyPressureLabel = 'High';
  } else if (inTaxDelinquency || inBankruptcy || hasOpenLiens || hasRecentEviction || (distressScore !== null && distressScore >= 45)) {
    propertyPressureLabel = 'Medium';
  } else if (!directSignals.length) {
    propertyPressureLabel = 'Low';
  }

  const areaListingTypes = [...new Set(comps.map((comp) => normalizeWhitespace(comp?.ListingType || '')).filter(Boolean))];
  const areaForSaleCount = comps.length;
  let areaPressureLabel = 'Low';
  if (areaForSaleCount >= 6) areaPressureLabel = 'High';
  else if (areaForSaleCount >= 3) areaPressureLabel = 'Medium';

  const propertyPressureSummary = directSignals.length
    ? `PropertyRadar matched the bar address and ${directSignals.join(', ')}.${equityPercent ? ` Equity reads around ${equityPercent}.` : ''}${
        availableEquity ? ` Available equity shows ${availableEquity}.` : ''
      }${totalLoanBalance ? ` Estimated loan balance shows ${totalLoanBalance}.` : ''}${
        listingStatus ? ` Latest listing status: ${listingStatus}.` : ''
      }${listingDate ? ` Listing date: ${listingDate}.` : ''}`
    : `PropertyRadar matched the bar address, but it does not currently show a strong sell-or-distress signal on the property itself.${
        equityPercent ? ` Equity reads around ${equityPercent}.` : ''
      }${availableEquity ? ` Available equity shows ${availableEquity}.` : ''}`;

  const areaPressureSummary = areaForSaleCount
    ? `Nearby for-sale property activity is showing ${areaForSaleCount} listing comp${areaForSaleCount === 1 ? '' : 's'}${
        areaListingTypes.length ? ` with a mix of ${areaListingTypes.join(', ')}` : ''
      }. This is nearby real-estate listing activity, not proof that this bar sold or is for sale.`
    : 'No nearby for-sale property activity was returned from PropertyRadar for this matched property.';

  let ownerLocationType = 'unknown';
  let ownerLocationLabel = 'Unknown';
  let ownerLocationSummary = 'PropertyRadar did not expose enough mailing data to tell whether the owner receives mail at the bar address.';
  if (isSameMailing) {
    ownerLocationType = 'same_site';
    ownerLocationLabel = 'Same as bar address';
    ownerLocationSummary = `PropertyRadar says the owner mailing address matches the matched site${siteAddress ? ` at ${siteAddress}` : ''}.`;
  } else if (isNotSameMailingOrExempt) {
    ownerLocationType = 'separate_mailing';
    ownerLocationLabel = 'Separate owner mailing';
    ownerLocationSummary = 'PropertyRadar says the owner mailing address is different from the matched bar parcel, so this reads like an off-site owner or landlord path.';
  } else if (isSameMailingOrExempt) {
    ownerLocationType = 'same_or_exempt';
    ownerLocationLabel = 'Same or exempt mailing';
    ownerLocationSummary = 'PropertyRadar marks the mailing status as same or exempt. That is directionally useful, but weaker than a clean same-site owner match.';
  }

  let phoneTieType = 'unknown';
  let phoneTieLabel = ownerPhone ? 'Owner phone not tied yet' : 'No owner phone';
  let phoneTieSummary = ownerPhone
    ? 'PropertyRadar returned an owner phone, but it does not yet match the public bar line.'
    : 'PropertyRadar matched the parcel, but no owner phone was returned.';

  if (matchesBarPhone) {
    phoneTieType = 'matches_bar_phone';
    phoneTieLabel = 'Matches bar phone';
    phoneTieSummary = `The PropertyRadar owner phone${ownerPhone ? ` ${ownerPhone}` : ''} matches a public phone already tied to this bar.`;
  } else if (ownerPhone && ownerLocationType === 'same_site') {
    phoneTieType = 'same_site_owner_phone';
    phoneTieLabel = 'Same-site owner line';
    phoneTieSummary = `PropertyRadar returned owner phone ${ownerPhone}. It does not match the public bar line, but the owner mailing address reads as the same site.`;
  } else if (ownerPhone && ownerLocationType === 'separate_mailing') {
    phoneTieType = 'offsite_owner_phone';
    phoneTieLabel = 'Off-site owner line';
    phoneTieSummary = `PropertyRadar returned owner phone ${ownerPhone}, but it does not match the public bar line and the owner mailing address reads separate from the bar parcel.`;
  } else if (ownerPhone) {
    phoneTieType = 'owner_phone_unconfirmed';
    phoneTieLabel = 'Owner line not confirmed';
    phoneTieSummary = `PropertyRadar returned owner phone ${ownerPhone}, but the tie to the live bar line is still unconfirmed.`;
  }

  let nextStep = 'Keep PropertyRadar as a separate landlord-pressure read and do not overwrite the bar or applicant contact.';
  if (isListedForSale) {
    nextStep = 'This property is listed. Work the operator and the building owner as separate paths, and confirm whether a sale, lease assignment, or concept change is in play.';
  } else if (matchesBarPhone) {
    nextStep = 'The owner phone matches the public bar line. Treat it as a potentially direct venue path, then confirm whether it reaches the operator or property owner.';
  } else if (ownerLocationType === 'separate_mailing' && ownerPhone) {
    nextStep = 'This looks like an off-site owner or landlord contact. Keep it separate from the bar-manager/operator path and use it when property pressure matters.';
  } else if (propertyPressureLabel === 'High') {
    nextStep = 'There is direct property pressure. Verify whether the landlord situation affects beverage decisions before assuming the operator is actively selling.';
  } else if (areaPressureLabel !== 'Low') {
    nextStep = 'Use the nearby for-sale property activity as a prospecting map. Check nearby bar operators and ownership changes instead of assuming this specific account is distressed.';
  }

  return {
    property_radar_owner_name: personDisplayName(primaryPerson) || normalizeWhitespace(property.Owner || ''),
    property_radar_owner_role: normalizeWhitespace(primaryPerson?.OwnershipRole || ''),
    property_radar_owner_email: ownerEmail,
    property_radar_owner_phone: ownerPhone,
    property_radar_owner_location_type: ownerLocationType,
    property_radar_owner_location_label: ownerLocationLabel,
    property_radar_owner_location_summary: ownerLocationSummary,
    property_radar_phone_tie_type: phoneTieType,
    property_radar_phone_tie_label: phoneTieLabel,
    property_radar_phone_tie_summary: phoneTieSummary,
    property_radar_listing_status: listingStatus,
    property_radar_listing_type: listingType,
    property_radar_listing_price: listingPrice,
    property_radar_listing_date: listingDate,
    property_radar_days_on_market: parseNumber(property.DaysOnMarket) ?? '',
    property_radar_available_equity: availableEquity,
    property_radar_total_loan_balance: totalLoanBalance,
    property_radar_equity_percent: equityPercent,
    property_radar_distress_score: distressScore === null ? '' : Math.round(distressScore),
    property_radar_is_underwater: isUnderwater,
    property_radar_is_listed_for_sale: isListedForSale,
    property_radar_in_foreclosure: inForeclosure,
    property_radar_in_tax_delinquency: inTaxDelinquency,
    property_radar_in_bankruptcy: inBankruptcy,
    property_radar_is_bank_owned: isBankOwned,
    property_radar_has_open_liens: hasOpenLiens,
    property_radar_has_recent_eviction: hasRecentEviction,
    property_radar_property_pressure_label: propertyPressureLabel,
    property_radar_property_pressure_summary: propertyPressureSummary,
    property_radar_area_pressure_label: areaPressureLabel,
    property_radar_area_pressure_summary: areaPressureSummary,
    property_radar_area_for_sale_count: areaForSaleCount,
    property_radar_area_listing_types: areaListingTypes,
    property_radar_next_step: nextStep
  };
}

async function loadPropertyPeople(radarId, property = {}) {
  if (Array.isArray(property.Persons) && property.Persons.length) return property.Persons;

  const response = await fetchJson(`/properties/${encodeURIComponent(radarId)}/persons`, {
    method: 'GET',
    query: {
      Fields: 'overview',
      Purchase: 1
    }
  });

  return Array.isArray(response?.results) ? response.results : [];
}

async function loadForSaleComps(radarId) {
  const response = await fetchJson(`/properties/${encodeURIComponent(radarId)}/comps/forsale`, {
    method: 'GET',
    query: {
      Fields: 'default',
      Purchase: 1,
      Limit: 6
    }
  });

  return Array.isArray(response?.results) ? response.results : [];
}

async function loadPersonContactValues(href) {
  const path = normalizeHrefPath(href);
  if (!path) return [];

  const response = await fetchJson(path, {
    method: 'POST',
    query: {
      Purchase: 1
    }
  });

  return Array.isArray(response?.results) ? response.results : [];
}

async function hydratePeopleContacts(people = []) {
  const hydrated = [];

  for (const person of people.slice(0, 3)) {
    const existingPhones = Array.isArray(person?.PhoneValues) && person.PhoneValues.length ? person.PhoneValues : Array.isArray(person?.Phone) ? person.Phone : [];
    const existingEmails = Array.isArray(person?.EmailValues) && person.EmailValues.length ? person.EmailValues : Array.isArray(person?.Email) ? person.Email : [];
    const phoneHref = !hasInlineContactData(existingPhones) && Array.isArray(person?.Phone) ? person.Phone[0]?.href : '';
    const emailHref = !hasInlineContactData(existingEmails) && Array.isArray(person?.Email) ? person.Email[0]?.href : '';
    const [phones, emails] = await Promise.all([
      phoneHref ? loadPersonContactValues(phoneHref).catch(() => []) : Promise.resolve([]),
      emailHref ? loadPersonContactValues(emailHref).catch(() => []) : Promise.resolve([])
    ]);

    hydrated.push({
      ...person,
      PhoneValues: phones.length ? phones : existingPhones,
      EmailValues: emails.length ? emails : existingEmails
    });
  }

  return hydrated;
}

export function getPropertyRadarDiagnostics() {
  return { ...diagnostics };
}

export async function hydratePropertyRadar(lead) {
  const token = configuredToken();
  if (!token) return withDefaults(lead, 'not_configured');
  if (!normalizeWhitespace(lead.address)) return withDefaults(lead, 'no_address');

  try {
    diagnostics = {
      ...diagnostics,
      checked_count: diagnostics.checked_count + 1
    };

    const suggestionResponse = await fetchJson('/suggestions/SiteAddress', {
      method: 'POST',
      query: {
        SuggestionInput: buildSuggestionInput(lead),
        Limit: 5
      },
      body: {
        Criteria: stateCriteria(lead.source_state)
      }
    });

    const suggestion = chooseSuggestion(suggestionResponse?.results || [], lead);
    if (!suggestion) return withDefaults(lead, 'no_match');

    const propertyResponse = await fetchJson('/properties', {
      method: 'POST',
      query: {
        Fields: 'Overview',
        Limit: 1,
        Purchase: 1
      },
      body: {
        Criteria: suggestion.criteria
      }
    });

    const property = propertyResponse?.results?.[0];
    if (!property?.RadarID) {
      return withDefaults(
        {
          ...lead,
          property_radar_match_label: suggestion.label
        },
        'no_property_result'
      );
    }

    const rawPeople = await loadPropertyPeople(property.RadarID, property).catch(() => []);
    const people = await hydratePeopleContacts(rawPeople).catch(() => rawPeople);
    const primaryPerson = choosePrimaryPerson(people);
    const comps = await loadForSaleComps(property.RadarID).catch(() => []);
    const ownerPhones = allContactTexts(people, ['PhoneValues', 'Phone']);
    const ownerEmails = allContactTexts(people, ['EmailValues', 'Email']);
    const barPhoneDigits = collectBarPhoneDigits(lead);
    const matchingOwnerPhone =
      ownerPhones.find((phone) => {
        const digits = normalizePhoneDigits(phone);
        return digits && barPhoneDigits.includes(digits);
      }) || '';
    const ownerPhone = matchingOwnerPhone || firstContactText(primaryPerson, ['PhoneValues', 'Phone']) || ownerPhones[0] || '';
    const ownerEmail = firstContactText(primaryPerson, ['EmailValues', 'Email']) || ownerEmails[0] || '';
    const siteAddress = propertySiteAddress(property, suggestion.label);
    const summary = summarizeProperty(lead, property, primaryPerson, comps, ownerPhone, ownerEmail, siteAddress);

    diagnostics = {
      ...diagnostics,
      matched_count: diagnostics.matched_count + 1,
      last_error: ''
    };

    return withDefaults(
      {
        ...lead,
        property_radar_match_label: suggestion.label,
        property_radar_site_address: siteAddress,
        property_radar_radar_id: property.RadarID,
        ...summary,
        property_radar_owner_phone: ownerPhone || summary.property_radar_owner_phone || '',
        property_radar_owner_email: ownerEmail || summary.property_radar_owner_email || ''
      },
      'matched'
    );
  } catch (error) {
    diagnostics = {
      ...diagnostics,
      last_error: error?.message || String(error || '')
    };
    return withDefaults(lead, 'error');
  }
}
