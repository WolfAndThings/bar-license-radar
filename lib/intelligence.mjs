import { normalizeWhitespace } from './html.mjs';

const CHAIN_TOKENS = [
  'applebee',
  'buffalo wild wings',
  'bw3',
  'chili',
  'courtyard by marriott',
  'doubletree',
  'embassy suites',
  'fairfield inn',
  'hampton inn',
  'hilton',
  'holiday inn',
  'hooters',
  'hy-vee',
  'hy vee',
  'hyatt',
  'marriott',
  'olive garden',
  'sheraton',
  'tgi friday',
  'topgolf'
];

function compactSentence(input = '') {
  return normalizeWhitespace(String(input || '').replace(/[ \t]+/g, ' '));
}

function normalizeCompare(input = '') {
  return compactSentence(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCase(input = '') {
  return String(input)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function arrayUnique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function daysSince(dateText = '') {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function yearsSince(dateText = '') {
  const days = daysSince(dateText);
  if (days === null) return null;
  return Number((days / 365).toFixed(1));
}

function entityKey(record = {}) {
  return [record.business_name, record.source_city, record.address].map(normalizeCompare).join('::');
}

function leadText(lead = {}) {
  return compactSentence(
    [
      lead.business_name,
      lead.applicant_entity,
      lead.license_type,
      lead.official_title,
      lead.official_summary,
      lead.hearing_purpose_summary,
      lead.inclusion_summary,
      lead.sales_likelihood_summary,
      lead.public_signals?.website_summary,
      ...(Array.isArray(lead.public_signals?.top_results)
        ? lead.public_signals.top_results.flatMap((item) => [item.title, item.description])
        : []),
      ...(Array.isArray(lead.menu_brands) ? lead.menu_brands : [])
    ].filter(Boolean).join(' ')
  );
}

function marketText(record = {}) {
  return compactSentence(
    [
      record.business_name,
      record.primary_type,
      record.gap_label,
      record.gap_summary,
      record.recent_public_activity_summary,
      record.recent_public_activity_fit,
      record.property_radar_property_pressure_summary,
      record.property_radar_area_pressure_summary
    ].filter(Boolean).join(' ')
  );
}

function chooseDecisionMaker(record = {}) {
  const choices = [
    {
      source: 'license',
      label: 'Official record',
      name: record.contact_name || '',
      role: record.contact_role || '',
      email: record.contact_email || '',
      phone: record.contact_phone || ''
    },
    {
      source: 'web',
      label: 'Website / public web',
      name: record.enriched_contact_name || '',
      role: record.enriched_contact_role || '',
      email: record.enriched_contact_email || '',
      phone: record.enriched_contact_phone || ''
    },
    {
      source: 'owner',
      label: 'Property owner',
      name: record.property_radar_owner_name || '',
      role: record.property_radar_owner_role || '',
      email: record.property_radar_owner_email || '',
      phone: record.property_radar_owner_phone || ''
    }
  ];

  for (const choice of choices) {
    if (choice.name || choice.email || choice.phone) {
      const line = [choice.name, choice.role, choice.phone, choice.email].filter(Boolean).join(' | ');
      return {
        decision_maker_name: choice.name,
        decision_maker_role: choice.role,
        decision_maker_email: choice.email,
        decision_maker_phone: choice.phone,
        decision_maker_source: choice.source,
        decision_maker_source_label: choice.label,
        decision_maker_line: line || 'No named person yet',
        decision_maker_summary: choice.name
          ? `${choice.label} currently gives the clearest person to reach: ${line}.`
          : `${choice.label} currently gives the clearest contact path: ${line}.`
      };
    }
  }

  return {
    decision_maker_name: '',
    decision_maker_role: '',
    decision_maker_email: '',
    decision_maker_phone: '',
    decision_maker_source: '',
    decision_maker_source_label: '',
    decision_maker_line: 'No named decision maker yet',
    decision_maker_summary: 'No named decision maker is captured yet. The next step is still to confirm an owner, operator, or bar manager.'
  };
}

function classifyAccountType(text = '', primaryType = '') {
  const haystack = `${primaryType} ${text}`.toLowerCase();

  if (/\bsports bar\b/.test(haystack)) return { label: 'Sports bar', summary: 'Reads like a sports-driven bar account.' };
  if (/\bcocktail\b|\bspeakeasy\b/.test(haystack)) {
    return { label: 'Cocktail bar', summary: 'Reads like a cocktail-led bar program.' };
  }
  if (/\bwine bar\b/.test(haystack)) return { label: 'Wine bar', summary: 'Reads like a wine-led bar account.' };
  if (/\bbrewpub\b|\btaproom\b|\bbrewery\b/.test(haystack)) {
    return { label: 'Taproom / brewpub', summary: 'Reads like a taproom or brewpub account.' };
  }
  if (/\bhotel\b|\binn\b|\bsuites\b/.test(haystack)) {
    return { label: 'Hotel bar', summary: 'Reads like a hotel-driven beverage account.' };
  }
  if (/\brestaurant\b|\bgrill\b|\bbistro\b|\bkitchen\b|\bchophouse\b|\bmarket grille\b/.test(haystack)) {
    return { label: 'Restaurant with bar', summary: 'Reads like a restaurant account with a liquor program.' };
  }
  if (/\bevent\b|\bmuseum\b|\barboretum\b|\bvenue\b/.test(haystack)) {
    return { label: 'Event venue', summary: 'Reads like an event-led venue rather than a steady bar account.' };
  }
  if (/\bmarket\b|\bgrocery\b/.test(haystack)) {
    return { label: 'Retail / market', summary: 'Reads like a retail or market account, not a classic bar.' };
  }
  if (/\btavern\b|\bpub\b|\bsaloon\b|\blounge\b|\bbar\b/.test(haystack)) {
    return { label: 'Neighborhood bar', summary: 'Reads like a classic bar, tavern, lounge, or pub account.' };
  }

  return { label: titleCase(primaryType || 'Bar / restaurant'), summary: 'General on-premise account.' };
}

function sizeScoreFromSignals(record = {}) {
  const reviewCount = Number(record.review_count || record.market_review_count || 0);
  const rating = Number(record.rating || record.market_rating || 0);
  const price = String(record.price_range || record.market_price_range || '');
  const type = String(record.account_type_label || '').toLowerCase();
  let score = 20;

  if (reviewCount >= 500) score += 42;
  else if (reviewCount >= 250) score += 30;
  else if (reviewCount >= 120) score += 20;
  else if (reviewCount >= 50) score += 12;
  else if (reviewCount >= 15) score += 6;

  if (price.includes('$$$')) score += 14;
  else if (price.includes('$$')) score += 8;
  else if (price.includes('$')) score += 3;

  if (rating >= 4.6) score += 5;
  else if (rating >= 4.2) score += 3;

  if (record.website_url) score += 5;
  if (record.phone || record.contact_phone || record.enriched_contact_phone) score += 4;
  if (record.open_now || record.market_open_now) score += 4;
  if (type.includes('restaurant') || type.includes('hotel')) score += 6;
  if (type.includes('sports') || type.includes('taproom')) score += 4;

  return Math.max(0, Math.min(100, score));
}

function accountSizeFromScore(score = 0) {
  if (score >= 76) return 'Large';
  if (score >= 56) return 'Mid-size';
  if (score >= 36) return 'Neighborhood';
  return 'Small';
}

function summarizeAccountSize(record = {}, score = 0) {
  const parts = [];
  const reviewCount = Number(record.review_count || record.market_review_count || 0);
  if (reviewCount) parts.push(`${reviewCount} visible reviews`);
  if (record.price_range || record.market_price_range) parts.push(`price range ${record.price_range || record.market_price_range}`);
  if (record.website_url) parts.push('active website');
  return parts.length ? `${parts.join(', ')}.` : 'Very little public demand or program-size signal is visible yet.';
}

function classifyOperatingSignal(record = {}) {
  const latestReviewDate = record.latest_visible_review_date || record.market_latest_visible_review_date || '';
  const businessStatus = String(record.business_status || record.market_business_status || '').toUpperCase();
  const latestReviewAge = daysSince(latestReviewDate);
  const hasContact = Boolean(record.website_url || record.phone || record.contact_phone || record.enriched_contact_phone);

  if (businessStatus.includes('CLOSED')) {
    return {
      label: 'Closed / verify',
      summary: 'The market profile is not reading as a live operating account. Verify before outreach.'
    };
  }

  if (record.open_now || record.market_open_now) {
    return { label: 'Open now', summary: 'The market profile says the venue is open right now.' };
  }

  if (businessStatus === 'OPERATIONAL' && latestReviewAge !== null && latestReviewAge <= 90) {
    return { label: 'Active', summary: 'The venue looks operational with recent public activity on the market profile.' };
  }

  if (businessStatus === 'OPERATIONAL' && hasContact) {
    return { label: 'Likely open', summary: 'The venue still looks operational, but the live-hours signal is weaker than an open-now read.' };
  }

  return { label: 'Check manually', summary: 'The operating signal is thin enough that a manual check is still worth doing before outreach.' };
}

function classifyOpeningStage(lead = {}, marketMatch = null) {
  const fit = String(lead.sales_fit || '');
  const future = (() => {
    const date = new Date(lead.hearing_date || '');
    return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now() - 24 * 60 * 60 * 1000;
  })();
  const ageDays = daysSince(lead.first_public_record_date || lead.hearing_date || '');
  const marketYears = marketMatch ? yearsSince(marketMatch.oldest_visible_review_date || '') : null;

  if (fit === 'Temporary / event permit' || fit === 'Temporary / consumption-only') {
    return {
      label: 'Temporary',
      summary: 'This reads like an event-use record, not a steady bar or restaurant opening.'
    };
  }

  if (fit === 'Ownership / operator change') {
    return {
      label: 'Ownership change',
      summary: 'This looks like an ownership or operator-change account, which is often one of the better times to call.'
    };
  }

  if ((fit === 'New issuance' || fit === 'New / timely') && future) {
    return {
      label: 'Opening soon',
      summary: 'The official record still looks like an in-process opening or approval window.'
    };
  }

  if ((fit === 'New issuance' || fit === 'New / timely') && ageDays !== null && ageDays <= 45) {
    return {
      label: 'Just opened',
      summary: 'The official record is recent enough that this account may have just opened or just cleared approvals.'
    };
  }

  if (fit === 'Existing venue / amendment') {
    return {
      label: 'Existing account changing',
      summary: 'This is an existing venue making a change rather than a true new opening.'
    };
  }

  if (marketYears !== null && marketYears >= 2) {
    return {
      label: 'Established account',
      summary: `The matched market profile shows public operating signals going back about ${marketYears} years, so this is not a new location.`
    };
  }

  if (fit === 'Weak signal / generic code') {
    return {
      label: 'Watch / unclear',
      summary: 'The public record still needs manual confirmation before treating it like a real opening.'
    };
  }

  return {
    label: future ? 'In process' : 'Fresh activity',
    summary: 'This is still a live public-record signal worth checking, even if the opening stage is not perfectly clear.'
  };
}

function classifyMarketStage(record = {}) {
  const ageYears = yearsSince(record.oldest_visible_review_date || '');
  if (record.recent_public_activity && (record.recent_public_activity_fit === 'New issuance' || record.recent_public_activity_fit === 'New / timely')) {
    return { label: 'Just opened', summary: 'The market listing lines up with a recent new-license signal.' };
  }
  if (ageYears !== null && ageYears < 1) {
    return { label: 'Newer account', summary: 'The earliest public operating signal is less than a year old.' };
  }
  if (ageYears !== null && ageYears >= 6) {
    return { label: 'Long-running', summary: `The earliest public operating signal is about ${ageYears} years old.` };
  }
  if (ageYears !== null && ageYears >= 2) {
    return { label: 'Established', summary: `The earliest public operating signal is about ${ageYears} years old.` };
  }
  return { label: 'Open account', summary: 'The market listing looks like a live on-premise account.' };
}

function classifyOwnershipSignal(text = '', fit = '') {
  if (fit === 'Ownership / operator change' || /\b(change of ownership|ownership transfer|new owner|new operator|transfer)\b/i.test(text)) {
    return {
      label: 'Strong',
      summary: 'Ownership or operator-change language is one of the strongest switch signals on the board.'
    };
  }

  if (/\bpartner\b|\bco-owner\b|\bdba\b/i.test(text)) {
    return {
      label: 'Possible',
      summary: 'There are ownership-style words in the public text, but not enough to call it a clean transfer.'
    };
  }

  return {
    label: 'No clear signal',
    summary: 'No direct ownership-change language is visible in the current public record.'
  };
}

function classifyHiringSignal(text = '') {
  if (!text) {
    return { label: 'Unknown', summary: 'No hiring signal was captured from the current public text.' };
  }

  if (/\b(now hiring|join our team|hiring bartenders|hiring servers|bar manager|general manager|foh manager)\b/i.test(text)) {
    return {
      label: 'Active',
      summary: 'Hiring language is visible in the public text, which can signal change inside the account.'
    };
  }

  if (/\bhiring\b|\bcareer\b|\bjobs\b/i.test(text)) {
    return {
      label: 'Possible',
      summary: 'There is generic hiring language in the public text, but it is not specific to the bar program.'
    };
  }

  return { label: 'None seen', summary: 'No hiring signal was visible in the public text we captured.' };
}

function classifyProgramOpportunity(record = {}) {
  const brandCount = Array.isArray(record.menu_brands) ? record.menu_brands.length : 0;
  const hasMenu = Boolean(record.menu_source_url || record.menu_source_note);
  const digitalGap = record.gap_label === 'Low digital footprint';
  const reviewCount = Number(record.review_count || record.market_review_count || 0);

  if (!hasMenu && digitalGap && reviewCount >= 40) {
    return {
      label: 'High',
      summary: 'The account has visible demand but very little public beverage-program detail. That usually means there is room to sharpen the pitch.'
    };
  }

  if (brandCount === 0 && reviewCount >= 80) {
    return {
      label: 'High',
      summary: 'The account looks real, but no visible drink program or brand mix is captured yet. That can be a good opening for outreach.'
    };
  }

  if (brandCount > 0 && brandCount < 6) {
    return {
      label: 'Medium',
      summary: 'A few menu brands are visible, but the online program still looks thin enough to be worth probing.'
    };
  }

  if (brandCount >= 10) {
    return {
      label: 'Low',
      summary: 'A fairly visible beverage program is already online, so the opportunity looks more like refinement than a blank slate.'
    };
  }

  return {
    label: 'Unknown',
    summary: 'There is not enough visible program detail yet to judge how developed the beverage mix really is.'
  };
}

function brandMixSummary(record = {}) {
  const brands = arrayUnique((Array.isArray(record.menu_brands) ? record.menu_brands : []).map(compactSentence)).slice(0, 8);
  if (!brands.length) return 'No readable brand mix was captured yet.';
  return `Visible brands or menu terms: ${brands.join(', ')}.`;
}

function classifyChainStatus(record = {}) {
  const haystack = `${record.business_name || ''} ${record.website_url || ''}`.toLowerCase();
  const match = CHAIN_TOKENS.find((token) => haystack.includes(token));
  if (match) {
    return {
      label: 'Likely chain',
      summary: `The name or website reads like a chain or centrally managed concept (${match}).`
    };
  }

  return {
    label: 'Likely independent',
    summary: 'Nothing in the public name or website clearly points to a chain or franchise operator.'
  };
}

function firstTopCompetitors(record = {}, allMarkets = []) {
  const selfKey = entityKey(record);
  return allMarkets
    .filter((item) => item.source_city === record.source_city)
    .filter((item) => item.id !== record.id)
    .filter((item) => entityKey(item) !== selfKey)
    .sort((a, b) => Number(b.review_count || 0) - Number(a.review_count || 0))
    .slice(0, 3)
    .map((item) => item.business_name)
    .filter(Boolean);
}

function competitionContext(record = {}, allMarkets = []) {
  const cityCount = allMarkets.filter((item) => item.source_city === record.source_city).length;
  const peers = firstTopCompetitors(record, allMarkets);
  let label = 'Light';
  if (cityCount >= 40) label = 'Dense';
  else if (cityCount >= 20) label = 'Active';

  return {
    area_bar_count: cityCount,
    area_competition_label: label,
    area_competition_examples: peers,
    area_competition_summary: peers.length
      ? `${record.source_city} currently has ${cityCount} tracked bars in the board. Visible peers include ${peers.join(', ')}.`
      : `${record.source_city} currently has ${cityCount} tracked bars in the board.`
  };
}

function buildCountMap(values = []) {
  const map = new Map();
  for (const value of values.map(normalizeCompare).filter(Boolean)) {
    map.set(value, (map.get(value) || 0) + 1);
  }
  return map;
}

function ownerPortfolioContext(record = {}, ownerCountMap = new Map(), operatorCountMap = new Map()) {
  const ownerKey = normalizeCompare(record.property_radar_owner_name || '');
  const operatorKey = normalizeCompare(record.applicant_entity || '');
  const ownerCount = ownerKey ? ownerCountMap.get(ownerKey) || 0 : 0;
  const operatorCount = operatorKey ? operatorCountMap.get(operatorKey) || 0 : 0;

  if (operatorCount > 1 && record.applicant_entity) {
    return {
      owner_portfolio_count: operatorCount,
      owner_portfolio_summary: `${record.applicant_entity} appears on ${operatorCount} tracked accounts in the current dataset.`
    };
  }

  if (ownerCount > 1 && record.property_radar_owner_name) {
    return {
      owner_portfolio_count: ownerCount,
      owner_portfolio_summary: `${record.property_radar_owner_name} is tied to ${ownerCount} tracked properties in the current dataset.`
    };
  }

  return {
    owner_portfolio_count: Math.max(ownerCount, operatorCount, 1),
    owner_portfolio_summary: record.property_radar_owner_name || record.applicant_entity
      ? 'No multi-location pattern is obvious from the current dataset.'
      : 'No owner portfolio signal is visible yet.'
  };
}

function cityMomentumContext(record = {}, activity = []) {
  const recentCount = activity.filter((item) => item.source_city === record.source_city && daysSince(item.first_public_record_date || item.hearing_date || '') !== null && daysSince(item.first_public_record_date || item.hearing_date || '') <= 120).length;
  let label = 'Quiet';
  if (recentCount >= 8) label = 'Hot';
  else if (recentCount >= 3) label = 'Active';

  return {
    city_momentum_label: label,
    city_recent_activity_count: recentCount,
    city_momentum_summary: `${record.source_city} has ${recentCount} public-license activity items in the last 120 days.`
  };
}

function reachabilityScore(record = {}, decision = {}) {
  let score = 18;
  if (decision.decision_maker_name) score += 28;
  if (decision.decision_maker_phone) score += 24;
  if (decision.decision_maker_email) score += 22;
  if (!decision.decision_maker_phone && !decision.decision_maker_email && (record.phone || record.contact_phone || record.enriched_contact_phone)) score += 14;
  if (record.website_url) score += 10;
  return Math.max(0, Math.min(100, score));
}

function revenuePotentialScore(record = {}) {
  return sizeScoreFromSignals(record);
}

function switchLikelihoodScore(record = {}, openingStage = {}, ownership = {}, program = {}, chain = {}) {
  let score = 24;
  if (ownership.label === 'Strong') score += 28;
  else if (ownership.label === 'Possible') score += 12;
  if (program.label === 'High') score += 18;
  else if (program.label === 'Medium') score += 10;
  if (record.menu_change_signal === 'major_change') score += 14;
  else if (record.menu_change_signal === 'moderate_change') score += 8;
  if (record.property_radar_property_pressure_label === 'High') score += 22;
  else if (record.property_radar_property_pressure_label === 'Medium') score += 12;
  if (record.property_radar_is_underwater || record.property_radar_in_tax_delinquency || record.property_radar_is_listed_for_sale) score += 14;
  if (openingStage.label === 'Long-running' || openingStage.label === 'Established account') score += 10;
  if (chain.label === 'Likely chain') score -= 18;
  return Math.max(0, Math.min(100, score));
}

function timingScore(record = {}, openingStage = {}, hiring = {}) {
  let score = 22;
  if (openingStage.label === 'Opening soon') score += 48;
  else if (openingStage.label === 'Just opened' || openingStage.label === 'Ownership change') score += 36;
  else if (openingStage.label === 'Existing account changing') score += 22;
  else if (openingStage.label === 'Long-running') score += 10;
  if (record.property_radar_property_pressure_label === 'High') score += 16;
  if (record.recent_public_activity) score += 10;
  if (hiring.label === 'Active') score += 10;
  return Math.max(0, Math.min(100, score));
}

function portfolioFitScore(record = {}, accountType = {}, chain = {}) {
  let score = 55;
  if (accountType.label === 'Event venue') score = 18;
  else if (accountType.label === 'Retail / market') score = 38;
  else if (accountType.label === 'Restaurant with bar') score = 72;
  else if (accountType.label === 'Neighborhood bar') score = 84;
  else if (accountType.label === 'Cocktail bar' || accountType.label === 'Sports bar' || accountType.label === 'Taproom / brewpub') score = 82;
  if (chain.label === 'Likely chain') score -= 18;
  return Math.max(0, Math.min(100, score));
}

function buildActionSummary(record = {}, scores = {}, decision = {}, openingStage = {}, ownership = {}, program = {}, competition = {}) {
  const parts = [];
  if (openingStage.label) parts.push(openingStage.label);
  if (decision.decision_maker_name) parts.push(`named contact: ${decision.decision_maker_name}`);
  else if (decision.decision_maker_phone || decision.decision_maker_email) parts.push('direct contact path');
  if (ownership.label === 'Strong') parts.push('operator-change signal');
  if (record.property_radar_property_pressure_label === 'High') parts.push('high property pressure');
  if (program.label === 'High') parts.push('thin visible program');
  if (competition.area_bar_count) parts.push(`${competition.area_bar_count} tracked bars in ${record.source_city}`);
  return compactSentence(parts.join(' | '));
}

function actionBucket(totalScore = 0) {
  if (totalScore >= 70) return 'Call now';
  if (totalScore >= 52) return 'Watch closely';
  if (totalScore >= 36) return 'Long-shot';
  return 'Skip';
}

function attachScoreBlock(record = {}, openingStage = {}, decision = {}, accountType = {}, program = {}, chain = {}, ownership = {}, hiring = {}, competition = {}) {
  const reachability = reachabilityScore(record, decision);
  const revenue = revenuePotentialScore(record);
  const switchLikelihood = switchLikelihoodScore(record, openingStage, ownership, program, chain);
  const timing = timingScore(record, openingStage, hiring);
  const fit = portfolioFitScore(record, accountType, chain);
  const totalScore = Math.round((reachability + revenue + switchLikelihood + timing + fit) / 5);
  const bucket = actionBucket(totalScore);

  return {
    outreach_reachability_score: reachability,
    outreach_revenue_potential_score: revenue,
    outreach_switch_likelihood_score: switchLikelihood,
    outreach_timing_score: timing,
    outreach_portfolio_fit_score: fit,
    outreach_score: totalScore,
    outreach_bucket: bucket,
    outreach_summary: buildActionSummary(record, { reachability, revenue, switchLikelihood, timing, fit, totalScore }, decision, openingStage, ownership, program, competition),
    outreach_score_line: `Reachability ${reachability} | Revenue ${revenue} | Switch ${switchLikelihood} | Timing ${timing} | Fit ${fit}`
  };
}

function matchMarketRecord(lead = {}, marketRecords = []) {
  const key = entityKey(lead);
  const direct = marketRecords.find((record) => entityKey(record) === key);
  if (direct) return direct;

  const nameKey = normalizeCompare(lead.business_name || '');
  const addressKey = normalizeCompare(lead.address || '');
  const city = lead.source_city || '';
  return (
    marketRecords.find((record) => {
      if (record.source_city !== city) return false;
      const recordName = normalizeCompare(record.business_name || '');
      const recordAddress = normalizeCompare(record.address || '');
      const nameMatch = recordName === nameKey || recordName.includes(nameKey) || nameKey.includes(recordName);
      const addressMatch = addressKey && recordAddress ? recordAddress.includes(addressKey) || addressKey.includes(recordAddress) : true;
      return nameMatch && addressMatch;
    }) || null
  );
}

export function enrichMarketRecords(records = [], activity = [], leads = []) {
  const ownerCountMap = buildCountMap(records.map((record) => record.property_radar_owner_name));
  const operatorCountMap = buildCountMap(leads.map((lead) => lead.applicant_entity));

  return records.map((record) => {
    const accountType = classifyAccountType(marketText(record), record.primary_type || '');
    const stage = classifyMarketStage(record);
    const decision = chooseDecisionMaker(record);
    const program = classifyProgramOpportunity(record);
    const chain = classifyChainStatus(record);
    const competition = competitionContext(record, records);
    const portfolio = ownerPortfolioContext(record, ownerCountMap, operatorCountMap);
    const momentum = cityMomentumContext(record, activity);
    const sizeScore = sizeScoreFromSignals({ ...record, account_type_label: accountType.label });
    const operating = classifyOperatingSignal(record);
    const ownership = classifyOwnershipSignal(marketText(record), record.recent_public_activity_fit || '');
    const hiring = classifyHiringSignal(marketText(record));
    const scores = attachScoreBlock({ ...record, account_type_label: accountType.label }, stage, decision, accountType, program, chain, ownership, hiring, competition);

    return {
      ...record,
      account_type_label: accountType.label,
      account_type_summary: accountType.summary,
      opening_stage_label: stage.label,
      opening_stage_summary: stage.summary,
      estimated_account_size_score: sizeScore,
      estimated_account_size_label: accountSizeFromScore(sizeScore),
      estimated_account_size_summary: summarizeAccountSize(record, sizeScore),
      operating_signal_label: operating.label,
      operating_signal_summary: operating.summary,
      brand_mix_summary: brandMixSummary(record),
      underserved_program_label: program.label,
      underserved_program_summary: program.summary,
      chain_status_label: chain.label,
      chain_status_summary: chain.summary,
      ownership_change_signal_label: ownership.label,
      ownership_change_summary: ownership.summary,
      hiring_signal_label: hiring.label,
      hiring_signal_summary: hiring.summary,
      ...competition,
      ...portfolio,
      ...momentum,
      ...decision,
      ...scores
    };
  });
}

export function enrichLeadRecords(leads = [], marketRecords = [], activity = []) {
  const ownerCountMap = buildCountMap(marketRecords.map((record) => record.property_radar_owner_name).concat(leads.map((lead) => lead.property_radar_owner_name)));
  const operatorCountMap = buildCountMap(leads.map((lead) => lead.applicant_entity));

  return leads.map((lead) => {
    const marketMatch = matchMarketRecord(lead, marketRecords);
    const text = leadText(lead);
    const accountType = classifyAccountType(text, marketMatch?.primary_type || '');
    const stage = classifyOpeningStage(lead, marketMatch);
    const decision = chooseDecisionMaker(lead);
    const program = classifyProgramOpportunity({
      ...lead,
      gap_label: marketMatch?.gap_label || '',
      review_count: marketMatch?.review_count || 0
    });
    const chain = classifyChainStatus({ ...lead, website_url: lead.website_url || marketMatch?.website_url || '' });
    const competition = competitionContext(
      { ...lead, id: `lead-${lead.id || entityKey(lead)}` },
      marketRecords
    );
    const portfolio = ownerPortfolioContext(lead, ownerCountMap, operatorCountMap);
    const momentum = cityMomentumContext(lead, activity);
    const sizeScore = sizeScoreFromSignals({
      ...lead,
      account_type_label: accountType.label,
      market_review_count: marketMatch?.review_count || 0,
      market_rating: marketMatch?.rating || '',
      market_price_range: marketMatch?.price_range || '',
      market_open_now: marketMatch?.open_now || false
    });
    const operating = classifyOperatingSignal({
      ...lead,
      business_status: marketMatch?.business_status || '',
      market_open_now: marketMatch?.open_now || false,
      market_latest_visible_review_date: marketMatch?.latest_visible_review_date || '',
      phone: marketMatch?.phone || ''
    });
    const ownership = classifyOwnershipSignal(text, lead.sales_fit || '');
    const hiring = classifyHiringSignal(text);
    const scores = attachScoreBlock(
      {
        ...lead,
        account_type_label: accountType.label,
        open_now: marketMatch?.open_now || false,
        phone: lead.contact_phone || lead.enriched_contact_phone || marketMatch?.phone || '',
        review_count: marketMatch?.review_count || 0,
        price_range: marketMatch?.price_range || '',
        rating: marketMatch?.rating || '',
        website_url: lead.website_url || marketMatch?.website_url || ''
      },
      stage,
      decision,
      accountType,
      program,
      chain,
      ownership,
      hiring,
      competition
    );

    return {
      ...lead,
      linked_market_id: marketMatch?.id || '',
      market_business_status: marketMatch?.business_status || '',
      market_primary_type: marketMatch?.primary_type || '',
      market_review_count: marketMatch?.review_count || 0,
      market_rating: marketMatch?.rating || '',
      market_price_range: marketMatch?.price_range || '',
      market_open_now: Boolean(marketMatch?.open_now),
      market_oldest_visible_review_date: marketMatch?.oldest_visible_review_date || '',
      market_latest_visible_review_date: marketMatch?.latest_visible_review_date || '',
      account_type_label: accountType.label,
      account_type_summary: accountType.summary,
      opening_stage_label: stage.label,
      opening_stage_summary: stage.summary,
      estimated_account_size_score: sizeScore,
      estimated_account_size_label: accountSizeFromScore(sizeScore),
      estimated_account_size_summary: summarizeAccountSize(
        {
          ...lead,
          review_count: marketMatch?.review_count || 0,
          price_range: marketMatch?.price_range || '',
          website_url: lead.website_url || marketMatch?.website_url || ''
        },
        sizeScore
      ),
      operating_signal_label: operating.label,
      operating_signal_summary: operating.summary,
      brand_mix_summary: brandMixSummary(lead),
      underserved_program_label: program.label,
      underserved_program_summary: program.summary,
      chain_status_label: chain.label,
      chain_status_summary: chain.summary,
      ownership_change_signal_label: ownership.label,
      ownership_change_summary: ownership.summary,
      hiring_signal_label: hiring.label,
      hiring_signal_summary: hiring.summary,
      ...competition,
      ...portfolio,
      ...momentum,
      ...decision,
      ...scores
    };
  });
}
