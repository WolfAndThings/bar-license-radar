const PROPERTY_RADAR_API = 'https://api.propertyradar.com/v1';
const USER_AGENT = 'Mozilla/5.0 (compatible; BarLicenseRadar/1.0; +https://github.com)';
const FETCH_TIMEOUT_MS = 20000;

const STATE_NAMES = {
  MN: 'Minnesota',
  ND: 'North Dakota',
  SD: 'South Dakota',
  WI: 'Wisconsin'
};

let diagnostics = {
  configured: false,
  selected_env: '',
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

  const url = new URL(pathname, PROPERTY_RADAR_API);
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
  const city = normalizeWhitespace(lead.source_city || '').toLowerCase();
  const stateName = normalizeWhitespace(STATE_NAMES[lead.source_state] || '').toLowerCase();

  const normalized = results
    .map((result) => ({
      label: normalizeWhitespace(result?.Label || ''),
      criteria: Array.isArray(result?.Criteria) ? result.Criteria : []
    }))
    .filter((result) => result.label && result.criteria.length);

  const exact = normalized.find((result) => {
    const text = result.label.toLowerCase();
    return (!city || text.includes(city)) && (!stateName || text.includes(stateName));
  });

  return exact || normalized[0] || null;
}

function personDisplayName(person = {}) {
  const fullName = normalizeWhitespace(
    [person.FirstName, person.MiddleName, person.LastName, person.Suffix].filter(Boolean).join(' ')
  );
  return fullName || normalizeWhitespace(person.EntityName || '');
}

function choosePrimaryPerson(people = []) {
  if (!Array.isArray(people) || !people.length) return null;
  return (
    people.find((person) => asBool(person?.isPrimaryContact)) ||
    people.find((person) => ['Owner', 'Principal'].includes(person?.OwnershipRole)) ||
    people[0]
  );
}

function summarizeProperty(property = {}, primaryPerson, comps = []) {
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
    ? `Nearby for-sale activity is showing ${areaForSaleCount} sale listing comp${areaForSaleCount === 1 ? '' : 's'}${
        areaListingTypes.length ? ` with a mix of ${areaListingTypes.join(', ')}` : ''
      }. Treat this as area turnover, not proof that this bar is for sale.`
    : 'No nearby for-sale comp activity was returned from PropertyRadar for this matched property.';

  let nextStep = 'Keep PropertyRadar as a separate landlord-pressure read and do not overwrite the bar or applicant contact.';
  if (isListedForSale) {
    nextStep = 'This property is listed. Work the operator and the building owner as separate paths, and confirm whether a sale, lease assignment, or concept change is in play.';
  } else if (propertyPressureLabel === 'High') {
    nextStep = 'There is direct property pressure. Verify whether the landlord situation affects beverage decisions before assuming the operator is actively selling.';
  } else if (areaPressureLabel !== 'Low') {
    nextStep = 'Use the area sale activity as a prospecting map. Check nearby bar operators and ownership changes instead of assuming this specific account is distressed.';
  }

  return {
    property_radar_owner_name: personDisplayName(primaryPerson) || normalizeWhitespace(property.Owner || ''),
    property_radar_owner_role: normalizeWhitespace(primaryPerson?.OwnershipRole || ''),
    property_radar_owner_email: normalizeWhitespace(primaryPerson?.Email || ''),
    property_radar_owner_phone: normalizeWhitespace(primaryPerson?.Phone || ''),
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
      Purchase: 0
    }
  });

  return Array.isArray(response?.results) ? response.results : [];
}

async function loadForSaleComps(radarId) {
  const response = await fetchJson(`/properties/${encodeURIComponent(radarId)}/comps/forsale`, {
    method: 'GET',
    query: {
      Fields: 'default',
      Purchase: 0,
      Limit: 6
    }
  });

  return Array.isArray(response?.results) ? response.results : [];
}

export function getPropertyRadarDiagnostics() {
  return { ...diagnostics };
}

export async function hydratePropertyRadar(lead) {
  const token = configuredToken();
  if (!token) return withDefaults(lead, 'not_configured');
  if (!normalizeWhitespace(lead.address)) return withDefaults(lead, 'no_address');

  try {
    const suggestionResponse = await fetchJson('/suggestions/SiteAddress', {
      method: 'POST',
      query: {
        SuggestionInput: normalizeWhitespace(lead.address),
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
        Fields: 'Overview,ValueTab,ListingsTab,Persons',
        Limit: 1,
        Purchase: 0
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

    const people = await loadPropertyPeople(property.RadarID, property).catch(() => []);
    const primaryPerson = choosePrimaryPerson(people);
    const comps = await loadForSaleComps(property.RadarID).catch(() => []);
    const summary = summarizeProperty(property, primaryPerson, comps);

    diagnostics = {
      ...diagnostics,
      matched_count: diagnostics.matched_count + 1,
      last_error: ''
    };

    return withDefaults(
      {
        ...lead,
        property_radar_match_label: suggestion.label,
        property_radar_radar_id: property.RadarID,
        ...summary
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
