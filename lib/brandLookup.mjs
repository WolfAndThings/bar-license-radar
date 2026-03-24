import { normalizeWhitespace } from './html.mjs';

const USER_AGENT = 'Mozilla/5.0 (compatible; BarLicenseRadar/1.0; +https://github.com)';

const BRAND_SOURCES = {
  MN: {
    state: 'MN',
    name: 'Minnesota Active Brands',
    siteUrl: 'https://mn.productregistrationonline.com/brands',
    searchUrl: 'https://mn.productregistrationonline.com/Search/ActiveBrandSearch',
    suggestionsUrl: 'https://mn.productregistrationonline.com/SearchFilters/ActiveBrandsBrands'
  },
  SD: {
    state: 'SD',
    name: 'South Dakota Active Brands',
    siteUrl: 'https://sd.productregistrationonline.com/brands',
    searchUrl: 'https://sd.productregistrationonline.com/Search/ActiveBrandSearch',
    suggestionsUrl: 'https://sd.productregistrationonline.com/SearchFilters/ActiveBrandsBrands'
  }
};

function compactSentence(input = '') {
  return normalizeWhitespace(String(input).replace(/[ \t]+/g, ' '));
}

function cleanText(value = '') {
  return compactSentence(String(value).replace(/\s+/g, ' '));
}

function normalizeKey(value = '') {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function brandSourceForState(state = '') {
  return BRAND_SOURCES[String(state || '').toUpperCase()] || null;
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBrandSuggestions(source, query) {
  const url = `${source.suggestionsUrl}?query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, {}, 12000).catch(() => ({ suggestionsDictionary: [] }));
  return Array.isArray(data?.suggestionsDictionary) ? data.suggestionsDictionary : [];
}

async function searchActiveBrands(source, brandName) {
  const body = new URLSearchParams({
    BrandName: brandName,
    LabelRegistrationSearchType: '0'
  });

  const data = await fetchJson(
    source.searchUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: body.toString()
    },
    15000
  ).catch(() => ({ Items: [] }));

  return Array.isArray(data?.Items) ? data.Items : [];
}

function scoreSuggestion(candidate, suggestion) {
  const a = normalizeKey(candidate);
  const b = normalizeKey(suggestion);
  if (!a || !b) return 0;
  if (a === b) return 4;
  if (b.startsWith(a)) return 3;
  if (a.startsWith(b)) return 2;
  return b.includes(a) || a.includes(b) ? 1 : 0;
}

function pickBestSuggestion(candidate, suggestions) {
  const scored = suggestions
    .map((item) => {
      const value = cleanText(item?.Value || item?.Key || '');
      return {
        value,
        score: scoreSuggestion(candidate, value)
      };
    })
    .filter((item) => item.value && item.score > 0)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length);

  return scored[0]?.value || '';
}

function summarizeMatches(source, brand, items) {
  const distributors = new Map();
  const suppliers = new Map();

  for (const item of items) {
    const supplier = cleanText(item?.LicenseeName || '');
    if (supplier) suppliers.set(supplier, (suppliers.get(supplier) || 0) + 1);

    for (const distributor of Array.isArray(item?.Distributors) ? item.Distributors : []) {
      const name = cleanText(distributor?.Name || '');
      if (!name) continue;
      distributors.set(name, (distributors.get(name) || 0) + 1);
    }
  }

  const rankedDistributors = [...distributors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rankedSuppliers = [...suppliers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    brand,
    source,
    distributorName: rankedDistributors[0]?.[0] || '',
    supplierName: rankedSuppliers[0]?.[0] || '',
    rawItems: items,
    hasDistributor: rankedDistributors.length > 0,
    distributionType: cleanText(items[0]?.DistributionType || '')
  };
}

export async function inferDistributorFromBrands(state, brandCandidates = []) {
  const source = brandSourceForState(state);
  if (!source) {
    return {
      matchedBrands: [],
      distributorName: '',
      supplierName: '',
      source,
      confidence: 'unknown',
      note: ''
    };
  }

  const uniqueCandidates = [...new Set((Array.isArray(brandCandidates) ? brandCandidates : []).map(cleanText).filter(Boolean))].slice(
    0,
    8
  );
  if (!uniqueCandidates.length) {
    return {
      matchedBrands: [],
      distributorName: '',
      supplierName: '',
      source,
      confidence: 'unknown',
      note: ''
    };
  }

  const matchedBrands = [];
  const distributorTallies = new Map();
  const supplierTallies = new Map();

  for (const candidate of uniqueCandidates) {
    const suggestions = await fetchBrandSuggestions(source, candidate);
    const selectedBrand = pickBestSuggestion(candidate, suggestions) || candidate;
    const items = await searchActiveBrands(source, selectedBrand);
    if (!items.length) continue;

    const summary = summarizeMatches(source, selectedBrand, items);
    matchedBrands.push(selectedBrand);

    if (summary.distributorName) {
      distributorTallies.set(summary.distributorName, (distributorTallies.get(summary.distributorName) || 0) + 1);
    }
    if (summary.supplierName) {
      supplierTallies.set(summary.supplierName, (supplierTallies.get(summary.supplierName) || 0) + 1);
    }

    if (matchedBrands.length >= 5 && distributorTallies.size) break;
  }

  const rankedDistributors = [...distributorTallies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rankedSuppliers = [...supplierTallies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (rankedDistributors.length) {
    return {
      matchedBrands,
      distributorName: rankedDistributors[0][0],
      supplierName: rankedSuppliers[0]?.[0] || '',
      source,
      confidence: 'brand_inferred',
      note: `${source.name} matched ${matchedBrands.join(', ')} and pointed to ${rankedDistributors[0][0]} at the brand level.`
    };
  }

  if (rankedSuppliers.length) {
    return {
      matchedBrands,
      distributorName: '',
      supplierName: rankedSuppliers[0][0],
      source,
      confidence: 'supplier_only',
      note: `${source.name} matched ${matchedBrands.join(', ')}, but the public search only exposed supplier registration details, not a specific wholesaler.`
    };
  }

  return {
    matchedBrands,
    distributorName: '',
    supplierName: '',
    source,
    confidence: 'unknown',
    note: matchedBrands.length ? `${source.name} matched brands, but no distributor details were exposed.` : ''
  };
}
