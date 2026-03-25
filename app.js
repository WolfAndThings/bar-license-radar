const generatedAtEl = document.getElementById('generatedAt');
const leadCountEl = document.getElementById('leadCount');
const marketCountMetaEl = document.getElementById('marketCountMeta');
const propertyMatchMetaEl = document.getElementById('propertyMatchMeta');
const searchInputEl = document.getElementById('searchInput');
const cityFilterEl = document.getElementById('cityFilter');
const stateFilterEl = document.getElementById('stateFilter');
const statusFilterEl = document.getElementById('statusFilter');
const warningsEl = document.getElementById('warnings');
const allLicensesLinksEl = document.getElementById('allLicensesLinks');
const sourceScheduleGridEl = document.getElementById('sourceScheduleGrid');
const sourceToggleEl = document.getElementById('sourceToggle');
const sourcePanelBodyEl = document.getElementById('sourcePanelBody');
const summaryGridEl = document.getElementById('summaryGrid');
const callListEl = document.getElementById('callList');
const justMissedListEl = document.getElementById('justMissedList');
const regionalWatchListEl = document.getElementById('regionalWatchList');
const festivalListEl = document.getElementById('festivalList');
const marketListEl = document.getElementById('marketList');
const leadGridEl = document.getElementById('leadGrid');
const leadCardTemplate = document.getElementById('leadCardTemplate');
const marketCardTemplate = document.getElementById('marketCardTemplate');

let allLeads = [];
let allActivity = [];
let allSources = [];
let allMarkets = [];
let activeQuickFilter = 'all';

const LIVE_SOURCE_IDS = new Set([
  'mn-minneapolis-public-hearings',
  'mn-stpaul-license-hearings',
  'mn-duluth-agt',
  'nd-fargo-liquor-control-board',
  'sd-sioux-falls-council'
]);

const BLOCKED_SOURCE_IDS = new Set(['mn-age-public-data', 'sd-rapid-city-council-agendas', 'sd-rapid-city-license-holders']);

function preferredContactName(lead) {
  return lead.contact_name || lead.enriched_contact_name || '';
}

function hasAnyDirectContact(lead) {
  return Boolean(lead.contact_email || lead.contact_phone || lead.enriched_contact_email || lead.enriched_contact_phone);
}

function hasMarketContact(item) {
  return Boolean(item.phone || item.website_url);
}

function propertyRadarMatchCount(pool = []) {
  return pool.filter((lead) => lead.property_radar_status === 'matched').length;
}

function hasOfficialDirectContact(lead) {
  return Boolean(lead.contact_email || lead.contact_phone);
}

function hasEnrichedDirectContact(lead) {
  return Boolean(lead.enriched_contact_email || lead.enriched_contact_phone);
}

function hasDistributorSignal(lead) {
  return ['exact', 'brand_inferred'].includes(lead.distributor_signal_type);
}

function hasMenuChangeSignal(lead) {
  return ['stable', 'moderate_change', 'major_change'].includes(lead.menu_change_signal);
}

function isBarInTrouble(lead) {
  return (
    lead.property_radar_property_pressure_label === 'High' ||
    lead.property_radar_is_listed_for_sale ||
    lead.property_radar_is_underwater ||
    lead.property_radar_in_foreclosure ||
    lead.property_radar_in_tax_delinquency ||
    lead.property_radar_in_bankruptcy ||
    lead.property_radar_is_bank_owned
  );
}

function isFestivalOrTemporaryLead(lead) {
  return (
    lead.sales_fit === 'Temporary / event permit' ||
    lead.sales_fit === 'Temporary / consumption-only' ||
    isTemporaryPermitLead(lead) ||
    isConsumptionOnlyLead(lead)
  );
}

function formatContactLine(parts, fallback) {
  const text = parts.filter(Boolean).join(' | ');
  return text || fallback;
}

function priorityWeight(priority = '') {
  if (priority === 'high') return 0;
  if (priority === 'medium') return 1;
  return 2;
}

function titleCase(input = '') {
  return String(input)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function firstSentence(input = '') {
  const text = normalizeWhitespaceForUi(input);
  if (!text) return '';
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

function normalizeWhitespaceForUi(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

function cadenceCategory(cadence = '') {
  const text = cadence.toLowerCase();
  if (!text) return 'As needed';
  if (text.includes('daily') || text.includes('business days')) return 'Daily';
  if (text.includes('monday and friday') || text.includes('twice weekly')) return 'Twice weekly';
  if (text.includes('weekly')) return 'Weekly';
  if (text.includes('monthly') || text.includes('third wednesday')) return 'Monthly';
  if (text.includes('reference')) return 'Reference';
  return 'Check cycle';
}

function sourceBestFor(source = {}) {
  return firstSentence(source.notes || '') || source.record_type || 'Official source';
}

function sourceDetailNote(source = {}) {
  const notes = normalizeWhitespaceForUi(source.notes || '');
  const first = firstSentence(notes);
  if (!notes) return source.record_type || '';
  if (notes === first) return `Record type: ${source.record_type || 'Official source'}`;
  return notes.slice(first.length).trim() || `Record type: ${source.record_type || 'Official source'}`;
}

function sourceStatusInfo(source = {}) {
  if (LIVE_SOURCE_IDS.has(source.id)) return { label: 'Live', className: 'is-live', rank: 0 };
  if (BLOCKED_SOURCE_IDS.has(source.id)) return { label: 'Blocked', className: 'is-blocked', rank: 2 };
  if (source.tier === 'core') return { label: 'Watch', className: 'is-watch', rank: 1 };
  return { label: 'Reference', className: 'is-reference', rank: 3 };
}

function isAllLicenseSource(source = {}) {
  const text = [source.source_name, source.record_type, source.notes].filter(Boolean).join(' ');
  return /all active city licenses|license holder|holders|holder list|lookup|statewide lookup/i.test(text);
}

function labelStatus(status = '') {
  return status.replace(/_/g, ' ');
}

function labelScore(lead) {
  const score = Number(lead.sales_likelihood_score ?? 0);
  const label = lead.sales_likelihood_label || 'Unknown';
  return `${label} ${score}/100`;
}

function marketRating(item) {
  const rating = item.rating ? `${item.rating}` : 'No rating';
  const count = Number(item.review_count || 0);
  return count ? `${rating} • ${count} reviews` : rating;
}

function bestContactLine(lead) {
  return formatContactLine(
    [
      preferredContactName(lead),
      lead.contact_role || lead.enriched_contact_role,
      lead.contact_phone || lead.enriched_contact_phone,
      lead.contact_email || lead.enriched_contact_email
    ],
    'No direct contact yet'
  );
}

function barContactLine(lead) {
  return formatContactLine(
    [
      lead.contact_name || lead.enriched_contact_name,
      lead.contact_role || lead.enriched_contact_role,
      lead.contact_phone || lead.enriched_contact_phone,
      lead.contact_email || lead.enriched_contact_email
    ],
    'No bar contact yet'
  );
}

function propertyOwnerLine(lead) {
  return formatContactLine(
    [
      lead.property_radar_owner_name,
      lead.property_radar_owner_role,
      lead.property_radar_owner_phone,
      lead.property_radar_owner_email
    ],
    'No building-owner signal yet'
  );
}

function propertyPressureTopLine(lead) {
  if (lead.property_radar_status === 'not_configured') return 'Not loaded';
  if (lead.property_radar_status === 'error') return 'Lookup error';
  if (lead.property_radar_status === 'no_match') return 'No parcel match';
  if (lead.property_radar_status && lead.property_radar_status !== 'matched') return 'No parcel match';
  const bits = [lead.property_radar_property_pressure_label || 'Unknown'];
  if (lead.property_radar_is_listed_for_sale) bits.push('Listed');
  else if (lead.property_radar_is_underwater) bits.push('Underwater');
  else if (lead.property_radar_in_foreclosure) bits.push('Foreclosure');
  else bits.unshift('Matched');
  return bits.join(' | ');
}

function areaPressureTopLine(lead) {
  if (lead.property_radar_status === 'not_configured') return 'Not loaded';
  if (lead.property_radar_status === 'error') return 'Lookup error';
  if (lead.property_radar_status === 'no_match') return 'No parcel match';
  if (lead.property_radar_status && lead.property_radar_status !== 'matched') return 'No parcel match';
  const bits = [lead.property_radar_area_pressure_label || 'Unknown'];
  if (Number(lead.property_radar_area_for_sale_count || 0) > 0) {
    bits.push(`${lead.property_radar_area_for_sale_count} nearby`);
  }
  return bits.join(' | ');
}

function propertyListingLine(lead) {
  return formatContactLine(
    [
      lead.property_radar_listing_status || '',
      lead.property_radar_listing_type || '',
      lead.property_radar_listing_price || '',
      lead.property_radar_listing_date ? `Listed ${formatDate(lead.property_radar_listing_date)}` : '',
      lead.property_radar_days_on_market ? `${lead.property_radar_days_on_market} DOM` : ''
    ],
    'No PropertyRadar listing signal'
  );
}

function propertyBalanceLine(lead) {
  return formatContactLine(
    [
      lead.property_radar_available_equity ? `Equity ${lead.property_radar_available_equity}` : '',
      lead.property_radar_total_loan_balance ? `Loan ${lead.property_radar_total_loan_balance}` : '',
      lead.property_radar_equity_percent ? `Eq ${lead.property_radar_equity_percent}` : '',
      lead.property_radar_distress_score !== '' ? `Distress ${lead.property_radar_distress_score}` : ''
    ],
    'No PropertyRadar debt/equity read yet'
  );
}

function propertyMatchLine(lead) {
  if (lead.property_radar_status === 'matched') {
    return lead.property_radar_match_label || 'Matched parcel';
  }
  if (lead.property_radar_status === 'error') return 'Lookup error';
  if (lead.property_radar_status === 'not_configured') return 'PropertyRadar not configured';
  return 'No parcel match yet';
}

function peopleBrief(lead) {
  const bits = [];
  if (lead.contact_name || lead.contact_phone || lead.contact_email) bits.push('License');
  if (lead.enriched_contact_name || lead.enriched_contact_phone || lead.enriched_contact_email) bits.push('Web');
  if (lead.property_radar_owner_name || lead.property_radar_owner_phone || lead.property_radar_owner_email) bits.push('Owner');
  return bits.join(' + ') || 'No contacts';
}

function recordBrief(lead) {
  return formatContactLine(
    [lead.hearing_date ? formatDate(lead.hearing_date) : '', lead.status ? labelStatus(lead.status) : ''],
    'Record date'
  );
}

function distributorBrief(lead) {
  return formatContactLine(
    [lead.distributor_confidence_label || 'Unknown', lead.menu_change_label || '', lead.wholesaler_risk_label || ''],
    'Distributor read'
  );
}

function propertyBrief(lead) {
  return `${propertyPressureTopLine(lead)} | ${areaPressureTopLine(lead)}`;
}

function normalizeCompare(input = '') {
  return normalizeWhitespaceForUi(String(input || '').toLowerCase());
}

function isLicenseRedundant(lead) {
  const license = normalizeCompare(lead.license_type);
  if (!license) return true;

  const official = normalizeCompare([lead.official_title, lead.official_summary].filter(Boolean).join(' '));
  return official.includes(license);
}

function compactDates(lead) {
  const hearing = formatDate(lead.hearing_date);
  const first = formatDate(lead.first_public_record_date);

  if ((lead.hearing_date || '') && (lead.first_public_record_date || '') && lead.hearing_date === lead.first_public_record_date) {
    return `Record date: ${hearing}`;
  }

  return `Hearing: ${hearing}\nFirst public record: ${first}`;
}

function matchesQuickFilter(lead) {
  if (activeQuickFilter === 'bars_in_trouble') return isBarInTrouble(lead);
  return true;
}

function emphasizeHtml(input = '', phrases = []) {
  let html = escapeHtml(input);
  const uniquePhrases = [...new Set(phrases.map((value) => String(value || '').trim()).filter(Boolean))]
    .filter((value) => value.length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const phrase of uniquePhrases) {
    const escaped = escapeHtml(phrase);
    html = html.replaceAll(escaped, `<strong>${escaped}</strong>`);
  }

  return html;
}

function summaryCallouts(lead) {
  return [
    lead.business_name,
    lead.contact_name,
    lead.enriched_contact_name,
    lead.property_radar_owner_name,
    lead.distributor_name,
    lead.sales_fit,
    lead.sales_likelihood_label,
    lead.property_radar_property_pressure_label,
    lead.property_radar_area_pressure_label,
    lead.menu_change_label,
    lead.wholesaler_risk_label,
    'direct public contact',
    'named contact',
    'ownership',
    'operator-change',
    'brand-based distributor inference',
    'existing venue amendment',
    'generic code',
    'temporary or one-day permit'
  ];
}

function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(input = '') {
  if (!input) return 'Unavailable';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function leadText(lead) {
  return normalizeWhitespaceForUi([lead.official_title, lead.license_type, lead.official_summary].filter(Boolean).join(' '));
}

function isUpcomingLead(lead) {
  const date = new Date(lead.hearing_date || lead.first_public_record_date || '');
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= Date.now() - 24 * 60 * 60 * 1000;
}

function isTemporaryPermitLead(lead) {
  return /\bspecial one-day liquor license\b|\bone-day liquor\b|\btemporary permit\b|\bspecial event\b/i.test(leadText(lead));
}

function isConsumptionOnlyLead(lead) {
  return /\bconsume, but not sell, alcoholic beverages\b|\balcohol consumption request\b/i.test(leadText(lead));
}

function recordDate(lead) {
  return lead.first_public_record_date || lead.hearing_date || '';
}

function isWithinLastDays(lead, days) {
  const date = new Date(recordDate(lead));
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function isJustMissedLead(lead) {
  if (isUpcomingLead(lead)) return false;
  if (!isWithinLastDays(lead, 180)) return false;
  return !['Temporary / event permit', 'Temporary / consumption-only', 'Weak signal / generic code'].includes(
    lead.sales_fit
  );
}

function renderWarnings(meta) {
  warningsEl.innerHTML = '';
  warningsEl.hidden = true;
}

function renderSummary(leads) {
  const cards = [
    {
      label: 'Live now',
      value: leads.filter((lead) => ['pending_hearing', 'license_hearing'].includes(lead.status)).length
    },
    {
      label: 'Bars in trouble',
      value: leads.filter(isBarInTrouble).length,
      filterKey: 'bars_in_trouble'
    },
    {
      label: 'Named contacts',
      value: leads.filter((lead) => preferredContactName(lead)).length
    },
    {
      label: 'Direct phone/email',
      value: leads.filter((lead) => hasAnyDirectContact(lead)).length
    },
    {
      label: 'PR matches',
      value: propertyRadarMatchCount(allLeads)
    },
    {
      label: 'Property pressure',
      value: leads.filter((lead) => lead.property_radar_property_pressure_label === 'High').length
    },
    {
      label: 'Menu changed',
      value: leads.filter((lead) => ['moderate_change', 'major_change'].includes(lead.menu_change_signal)).length
    },
    {
      label: 'High fit',
      value: leads.filter((lead) => (lead.sales_likelihood_score ?? 0) >= 70).length
    },
    {
      label: 'Bars in area',
      value: allMarkets.filter(matchesMarketFilters).length
    }
  ];

  summaryGridEl.innerHTML = cards
    .map(
      (card) => `
        <article
          class="summary-card${card.filterKey ? ' is-actionable' : ''}${activeQuickFilter === card.filterKey ? ' is-active' : ''}"
          ${card.filterKey ? `data-filter-key="${escapeHtml(card.filterKey)}"` : ''}
        >
          <span>${escapeHtml(card.label)}</span>
          <strong>${card.value}</strong>
        </article>
      `
    )
    .join('');
}

function callPriority(lead) {
  let priority = Number(lead.sales_likelihood_score ?? 0);

  if (isUpcomingLead(lead)) priority += 28;
  else if (lead.status === 'pending_hearing') priority += 24;
  else if (lead.status === 'license_hearing' || lead.status === 'public_recorded') priority += 16;
  else if (lead.status === 'heard') priority += 6;

  if (preferredContactName(lead)) {
    priority += lead.contact_name ? 14 : 8;
  }

  if (hasOfficialDirectContact(lead)) priority += 22;
  else if (hasEnrichedDirectContact(lead)) priority += 10;

  if (lead.distributor_signal_type === 'exact') priority += 4;
  else if (lead.distributor_signal_type === 'brand_inferred') priority += 2;

  if (lead.property_radar_property_pressure_label === 'High') priority += 8;
  else if (lead.property_radar_property_pressure_label === 'Medium') priority += 4;

  if (lead.property_radar_area_pressure_label === 'High') priority += 4;
  else if (lead.property_radar_area_pressure_label === 'Medium') priority += 2;

  if (lead.sales_fit === 'Ownership / operator change') priority += 10;
  if (lead.sales_fit === 'New issuance' || lead.sales_fit === 'New / timely') priority += 10;
  if (lead.sales_fit === 'Existing venue / amendment') priority -= 18;
  if (lead.sales_fit === 'Weak signal / generic code') priority -= 28;
  if (lead.sales_fit === 'Temporary / event permit' || isTemporaryPermitLead(lead)) priority -= 40;
  if (lead.sales_fit === 'Temporary / consumption-only' || isConsumptionOnlyLead(lead)) priority -= 48;

  return priority;
}

function rankLeads(leads) {
  return [...leads]
    .sort((a, b) => {
      const priorityDelta = callPriority(b) - callPriority(a);
      if (priorityDelta !== 0) return priorityDelta;
      return (b.hearing_date || '').localeCompare(a.hearing_date || '');
    });
}

function isMissedConnectionLead(lead) {
  if (isUpcomingLead(lead)) return false;
  const date = new Date(recordDate(lead));
  if (Number.isNaN(date.getTime())) return false;
  const ageDays = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays >= 30 && ageDays <= 60;
}

function buildLeadCardNode(lead) {
  const node = leadCardTemplate.content.cloneNode(true);
  node.querySelector('.city-badge').textContent = lead.source_city;
  node.querySelector('.status-badge').textContent = labelStatus(lead.status);
  node.querySelector('.score-badge').textContent = labelScore(lead);
  node.querySelector('.lead-title').textContent = lead.business_name || 'Unnamed business';
  node.querySelector('.lead-subtitle').textContent = lead.address || lead.official_title || 'No address found yet';
  node.querySelector('.best-contact').textContent = barContactLine(lead);
  node.querySelector('.sales-fit-top').textContent = labelScore(lead);
  node.querySelector('.property-pressure-top').textContent = propertyPressureTopLine(lead);
  node.querySelector('.area-pressure-top').textContent = areaPressureTopLine(lead);
  node.querySelector('.record-brief').textContent = recordBrief(lead);
  node.querySelector('.people-brief').textContent = peopleBrief(lead);
  node.querySelector('.distributor-brief').textContent = distributorBrief(lead);
  node.querySelector('.property-brief').textContent = propertyBrief(lead);
  node.querySelector('.outreach-brief').textContent = 'Suggested note ready';
  node.querySelector('.applicant').textContent = lead.applicant_entity || 'Unavailable';
  const licenseEl = node.querySelector('.license');
  const licenseBlockEl = licenseEl.closest('div');
  if (isLicenseRedundant(lead)) {
    licenseBlockEl.hidden = true;
  } else {
    licenseEl.textContent = lead.license_type || 'Unavailable';
    licenseBlockEl.hidden = false;
  }
  node.querySelector('.dates').textContent = compactDates(lead);
  node.querySelector('.contact-official').textContent = formatContactLine(
    [lead.contact_name, lead.contact_role, lead.contact_email, lead.contact_phone],
    'No official contact signal captured yet'
  );
  node.querySelector('.contact-enriched').textContent = formatContactLine(
    [lead.enriched_contact_name, lead.enriched_contact_role, lead.enriched_contact_email, lead.enriched_contact_phone],
    'No enriched contact captured yet'
  );
  node.querySelector('.contact-owner').textContent = propertyOwnerLine(lead);
  node.querySelector('.property-match').textContent = propertyMatchLine(lead);
  node.querySelector('.property-listing').textContent = propertyListingLine(lead);
  node.querySelector('.property-balance').textContent = propertyBalanceLine(lead);

  const signals =
    lead.public_signals?.website_summary ||
    lead.official_summary ||
    'No additional public concept signal captured yet.';
  node.querySelector('.signals').textContent = signals;
  node.querySelector('.hearing-summary').innerHTML = emphasizeHtml(
    lead.hearing_purpose_summary || 'No hearing-purpose summary generated yet.',
    summaryCallouts(lead)
  );
  node.querySelector('.inclusion-summary').innerHTML = emphasizeHtml(
    lead.inclusion_summary || 'No inclusion summary generated yet.',
    summaryCallouts(lead)
  );
  node.querySelector('.sales-summary').innerHTML = emphasizeHtml(
    `${lead.sales_fit ? `${lead.sales_fit}. ` : ''}${lead.sales_likelihood_summary || 'No sale-likelihood summary generated yet.'}`,
    summaryCallouts(lead)
  );
  node.querySelector('.distributor-summary').innerHTML = emphasizeHtml(
    `${lead.distributor_confidence_label || 'Unknown'}${lead.distributor_name ? ` | ${lead.distributor_name}` : ''}. ${
      lead.distributor_summary || 'No distributor signal generated yet.'
    }`,
    summaryCallouts(lead)
  );
  node.querySelector('.distributor-next-step').textContent =
    lead.distributor_next_step || 'No next-step guidance generated yet.';
  node.querySelector('.menu-summary').innerHTML = emphasizeHtml(
    `${lead.menu_change_label || 'Unknown'}. ${lead.menu_change_summary || 'No menu-comparison summary generated yet.'}`,
    summaryCallouts(lead)
  );
  node.querySelector('.wholesaler-risk-summary').innerHTML = emphasizeHtml(
    `${lead.wholesaler_risk_label || 'Unknown'}. ${
      lead.wholesaler_risk_summary || 'No wholesaler-risk summary generated yet.'
    }`,
    summaryCallouts(lead)
  );
  node.querySelector('.property-pressure-summary').innerHTML = emphasizeHtml(
    lead.property_radar_property_pressure_summary || 'No PropertyRadar property pressure signal yet.',
    summaryCallouts(lead)
  );
  node.querySelector('.property-area-summary').innerHTML = emphasizeHtml(
    lead.property_radar_area_pressure_summary || 'No nearby sale activity signal yet.',
    summaryCallouts(lead)
  );
  node.querySelector('.property-next-step').textContent =
    lead.property_radar_next_step || 'No PropertyRadar next step yet.';

  node.querySelector('.followup-subject').textContent = lead.suggested_follow_up_subject || '';
  node.querySelector('.followup-body').textContent = lead.suggested_follow_up_body || '';
  node.querySelector('.copy-btn').addEventListener('click', async () => {
    const payload = `${lead.suggested_follow_up_subject}\n\n${lead.suggested_follow_up_body}`;
    await navigator.clipboard.writeText(payload);
  });

  const links = [
    linkHtml(lead.official_record_url, 'Official record'),
    linkHtml(lead.official_meeting_url, 'Meeting'),
    linkHtml(lead.website_url, 'Website')
  ].filter(Boolean);
  node.querySelector('.link-row').innerHTML = links.join('');
  return node;
}

function renderLeadSection(targetEl, leads, { eyebrow, title, copy, empty } = {}) {
  targetEl.innerHTML = '';

  if (!leads.length) {
    if (empty) targetEl.innerHTML = `<p class="empty-state">${escapeHtml(empty)}</p>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'call-list-head';
  head.innerHTML = `
    <div>
      <p class="eyebrow">${escapeHtml(eyebrow || '')}</p>
      <h2 class="section-title">${escapeHtml(title || '')}</h2>
    </div>
    <p class="section-copy">${escapeHtml(copy || '')}</p>
  `;
  targetEl.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'lead-grid';
  for (const lead of leads) {
    grid.appendChild(buildLeadCardNode(lead));
  }
  targetEl.appendChild(grid);
}

function renderCallList(leads) {
  const ranked = rankLeads(leads).slice(0, 4);

  if (!ranked.length) {
    callListEl.innerHTML = '';
    return;
  }

  renderLeadSection(callListEl, ranked, {
    eyebrow: 'Call First',
    title: 'Opportunities',
    copy: 'Best leads right now, with all of the important detail in one place.'
  });
}

function renderJustMissedList(leads) {
  const opportunityIds = new Set(rankLeads(leads).slice(0, 4).map((lead) => lead.id));
  const ranked = rankLeads(
    leads.filter((lead) => !opportunityIds.has(lead.id) && isJustMissedLead(lead) && isMissedConnectionLead(lead))
  ).slice(0, 4);

  if (!ranked.length) {
    renderLeadSection(justMissedListEl, [], {
      empty: 'No missed connections in the 1-2 month window right now.'
    });
    return;
  }

  renderLeadSection(justMissedListEl, ranked, {
    eyebrow: '1-2 Months Old',
    title: 'Missed Connections',
    copy: 'Leads not already in Opportunities that first showed up about 1-2 months ago.'
  });
}

function renderRegionalWatchList(leads, activity) {
  const opportunityIds = new Set(leads.map((lead) => lead.id));
  const ranked = rankLeads(
    activity.filter(
      (lead) =>
        ['ND', 'SD'].includes(lead.source_state) &&
        !opportunityIds.has(lead.id) &&
        !isFestivalOrTemporaryLead(lead) &&
        matchesFilters(lead)
    )
  ).slice(0, 6);

  if (!ranked.length) {
    regionalWatchListEl.innerHTML = '';
    return;
  }

  const state = stateFilterEl.value;
  const title =
    state === 'ND'
      ? 'North Dakota Watchlist'
      : state === 'SD'
        ? 'South Dakota Watchlist'
        : 'Dakota Watchlist';

  renderLeadSection(regionalWatchListEl, ranked, {
    eyebrow: 'Watchlist',
    title,
    copy: 'North and South Dakota activity that is not on the main board yet.',
    empty: ''
  });
}

function renderFestivalList(activity) {
  const ranked = rankLeads(activity.filter((lead) => matchesFilters(lead) && isFestivalOrTemporaryLead(lead))).slice(0, 8);

  if (!ranked.length) {
    festivalListEl.innerHTML = '';
    return;
  }

  renderLeadSection(festivalListEl, ranked, {
    eyebrow: 'Short-Term',
    title: 'Festivals + Temporary Licenses',
    copy: 'Event permits and one-day alcohol activity, kept separate from the main board.'
  });
}

function matchesMarketFilters(item) {
  const city = cityFilterEl.value;
  const state = stateFilterEl.value;
  const status = statusFilterEl.value;
  const search = searchInputEl.value.trim().toLowerCase();

  if (status !== 'all') return false;
  if (city !== 'all' && item.source_city !== city) return false;
  if (state !== 'all' && item.source_state !== state) return false;
  if (!search) return true;

  return [
    item.business_name,
    item.address,
    item.phone,
    item.website_url,
    item.primary_type,
    item.gap_label,
    item.gap_summary,
    item.recent_public_activity_summary
  ]
    .join(' ')
    .toLowerCase()
    .includes(search);
}

function buildMarketCardNode(item) {
  const node = marketCardTemplate.content.cloneNode(true);
  node.querySelector('.market-city').textContent = item.source_city;
  node.querySelector('.market-type').textContent = item.primary_type || 'Bar';
  node.querySelector('.market-gap').textContent = item.gap_label || 'Market';
  node.querySelector('.market-title').textContent = item.business_name || 'Unnamed bar';
  node.querySelector('.market-subtitle').textContent = item.address || 'No address captured';
  node.querySelector('.market-visible').textContent = item.oldest_visible_review_date
    ? formatDate(item.oldest_visible_review_date)
    : 'Unknown';
  node.querySelector('.market-rating').textContent = marketRating(item);
  node.querySelector('.market-phone').textContent = item.phone || 'No phone captured';
  node.querySelector('.market-website').textContent = item.website_url || 'No website captured';
  node.querySelector('.market-status').textContent = formatContactLine(
    [item.business_status || '', item.open_now ? 'Open now' : 'Hours unknown', item.price_range || ''],
    'Status unknown'
  );
  node.querySelector('.market-activity').textContent = item.recent_public_activity
    ? formatContactLine([item.recent_public_activity_date ? formatDate(item.recent_public_activity_date) : '', item.recent_public_activity_fit || ''], 'Recent public activity')
    : 'No recent public activity match';
  node.querySelector('.market-visible-summary').textContent =
    item.oldest_visible_review_summary || 'No dated review signal yet.';
  node.querySelector('.market-gap-summary').textContent = item.gap_summary || 'No gap summary yet.';
  node.querySelector('.market-links').innerHTML = [
    linkHtml(item.google_maps_url, 'Google Maps'),
    linkHtml(item.website_url, 'Website')
  ]
    .filter(Boolean)
    .join('');
  return node;
}

function renderMarketList(markets) {
  const filtered = markets.filter(matchesMarketFilters);

  if (!filtered.length) {
    marketListEl.innerHTML = '';
    return;
  }

  marketListEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'call-list-head';
  head.innerHTML = `
    <div>
      <p class="eyebrow">Area Inventory</p>
      <h2 class="section-title">Bars In Area</h2>
    </div>
    <p class="section-copy">Separate market coverage from Apify Google Maps. Showing ${filtered.length} bars so you can see who is already out there, how visible they are, and where recent public activity overlaps.</p>
  `;
  marketListEl.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'market-grid';
  for (const item of filtered) {
    grid.appendChild(buildMarketCardNode(item));
  }
  marketListEl.appendChild(grid);
}

function matchesBaseFilters(lead) {
  const city = cityFilterEl.value;
  const state = stateFilterEl.value;
  const status = statusFilterEl.value;
  const search = searchInputEl.value.trim().toLowerCase();

  if (city !== 'all' && lead.source_city !== city) return false;
  if (state !== 'all' && lead.source_state !== state) return false;
  if (status !== 'all' && lead.status !== status) return false;
  if (!search) return true;

  const haystack = [
    lead.business_name,
    lead.applicant_entity,
    lead.contact_name,
    lead.contact_role,
    lead.contact_email,
    lead.contact_phone,
    lead.enriched_contact_name,
    lead.enriched_contact_role,
    lead.enriched_contact_email,
    lead.enriched_contact_phone,
    lead.address,
    lead.license_type,
    lead.official_summary,
    lead.hearing_purpose_summary,
    lead.inclusion_summary,
    lead.sales_likelihood_summary,
    lead.sales_fit,
    lead.distributor_name,
    lead.distributor_summary,
    lead.distributor_next_step,
    lead.property_radar_owner_name,
    lead.property_radar_owner_email,
    lead.property_radar_owner_phone,
    lead.property_radar_listing_status,
    lead.property_radar_listing_type,
    lead.property_radar_property_pressure_summary,
    lead.property_radar_area_pressure_summary,
    lead.property_radar_next_step,
    lead.menu_change_summary,
    lead.wholesaler_risk_summary,
    ...(Array.isArray(lead.menu_brands) ? lead.menu_brands : [])
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(search);
}

function matchesFilters(lead) {
  return matchesBaseFilters(lead) && matchesQuickFilter(lead);
}

function linkHtml(href, label) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderAllLicenseLinks(sources) {
  const licenseSources = [...sources]
    .filter(isAllLicenseSource)
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority) || a.source_name.localeCompare(b.source_name));

  if (!licenseSources.length) {
    allLicensesLinksEl.innerHTML = '<p class="empty-inline">No broad license-holder sources loaded yet.</p>';
    return;
  }

  allLicensesLinksEl.innerHTML = licenseSources
    .map(
      (source) => `
        <a class="quick-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
          ${escapeHtml(source.source_name)}
        </a>
      `
    )
    .join('');
}

function renderSourceSchedule(sources) {
  const scheduleSources = [...sources].sort((a, b) => {
    const statusDelta = sourceStatusInfo(a).rank - sourceStatusInfo(b).rank;
    if (statusDelta !== 0) return statusDelta;
    return priorityWeight(a.priority) - priorityWeight(b.priority) || a.source_name.localeCompare(b.source_name);
  });

  if (!scheduleSources.length) {
    sourceScheduleGridEl.innerHTML = '<p class="empty-state">No source schedule loaded yet.</p>';
    return;
  }

  sourceScheduleGridEl.innerHTML = scheduleSources
    .map((source) => {
      const status = sourceStatusInfo(source);
      return `
        <details class="source-card">
          <summary class="source-summary">
            <div class="source-summary-main">
              <div class="badge-row">
                <span class="city-badge">${escapeHtml(source.state)}</span>
                <span class="status-badge">${escapeHtml(source.city)}</span>
                <span class="score-badge source-status-badge ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
              </div>
              <h3 class="source-title">${escapeHtml(source.source_name)}</h3>
              <p class="source-subtitle">${escapeHtml(sourceBestFor(source))}</p>
            </div>
            <div class="source-summary-side">
              <span class="score-badge source-check-badge">${escapeHtml(cadenceCategory(source.cadence || ''))}</span>
              <span class="meta-kicker">Check Back</span>
              <p class="source-cadence-preview">${escapeHtml(source.cadence || 'As needed')}</p>
              <span class="source-caret" aria-hidden="true"></span>
            </div>
          </summary>

          <div class="source-card-body">
            <div class="source-meta">
              <div>
                <span class="meta-kicker">Status</span>
                <p>${escapeHtml(status.label)}</p>
              </div>
              <div>
                <span class="meta-kicker">Check Back</span>
                <p>${escapeHtml(source.cadence || 'As needed')}</p>
              </div>
              <div>
                <span class="meta-kicker">Best For</span>
                <p>${escapeHtml(sourceBestFor(source))}</p>
              </div>
              <div>
                <span class="meta-kicker">Fields Exposed</span>
                <p>${escapeHtml((source.fields_expected || []).join(', ') || 'Not listed')}</p>
              </div>
            </div>

            <p class="source-notes">${escapeHtml(sourceDetailNote(source))}</p>
            <div class="link-row">${linkHtml(source.url, 'Open source')}</div>
          </div>
        </details>
      `;
    })
    .join('');
}

function updateSourceToggle() {
  const isExpanded = !sourcePanelBodyEl.hidden;
  sourceToggleEl.textContent = isExpanded ? 'Hide sources' : 'Show sources';
  sourceToggleEl.setAttribute('aria-expanded', String(isExpanded));
}

function renderLeads() {
  const summaryPool = (allActivity.length ? allActivity : allLeads).filter(matchesBaseFilters);
  const baseLeads = allLeads.filter(matchesBaseFilters);
  const leads = baseLeads.filter(matchesQuickFilter);
  renderSummary(summaryPool);
  renderCallList(leads);
  renderJustMissedList(leads);
  renderRegionalWatchList(leads, allActivity);
  renderFestivalList(allActivity);
  renderMarketList(allMarkets);
  leadCountEl.textContent = String(leads.length);
  marketCountMetaEl.textContent = String(allMarkets.filter(matchesMarketFilters).length);
  propertyMatchMetaEl.textContent = String(propertyRadarMatchCount(allLeads));
  leadGridEl.innerHTML = '';
  leadGridEl.hidden = true;

  if (!leads.length) {
    callListEl.innerHTML = '<p class="empty-state">No leads match the current filters.</p>';
    justMissedListEl.innerHTML = '';
  }
}

async function loadDashboard() {
  const [metaResponse, leadsResponse, activityResponse, sourcesResponse, marketResponse] = await Promise.all([
    fetch('./data/meta.json'),
    fetch('./data/leads.json'),
    fetch('./data/activity.json'),
    fetch('./data/sources.json'),
    fetch('./data/market.json')
  ]);
  const meta = await metaResponse.json();
  const leads = await leadsResponse.json();
  const activity = await activityResponse.json();
  const sources = await sourcesResponse.json();
  const market = await marketResponse.json();

  allLeads = Array.isArray(leads) ? leads : [];
  allActivity = Array.isArray(activity) ? activity : [];
  allSources = Array.isArray(sources) ? sources : [];
  allMarkets = Array.isArray(market) ? market : [];
  generatedAtEl.textContent = meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : 'Not refreshed yet';
  leadCountEl.textContent = String(allLeads.length);
  marketCountMetaEl.textContent = String(allMarkets.length);
  propertyMatchMetaEl.textContent = String(propertyRadarMatchCount(allLeads));
  renderWarnings(meta);
  renderAllLicenseLinks(allSources);
  renderSourceSchedule(allSources);

  const cityPool = [...allLeads, ...allActivity, ...allMarkets];
  const cities = [...new Set(cityPool.map((lead) => lead.source_city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  for (const city of cities) {
    const option = document.createElement('option');
    option.value = city;
    option.textContent = city;
    cityFilterEl.appendChild(option);
  }

  const statePool = [
    ...cityPool.map((lead) => lead.source_state),
    ...allSources.map((source) => source.state)
  ].filter((value) => value && value !== 'Statewide');
  const states = [...new Set(statePool)].sort((a, b) => a.localeCompare(b));
  for (const state of states) {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = state;
    stateFilterEl.appendChild(option);
  }

  renderLeads();
}

searchInputEl.addEventListener('input', renderLeads);
cityFilterEl.addEventListener('change', renderLeads);
stateFilterEl.addEventListener('change', renderLeads);
statusFilterEl.addEventListener('change', renderLeads);
sourceToggleEl.addEventListener('click', () => {
  sourcePanelBodyEl.hidden = !sourcePanelBodyEl.hidden;
  updateSourceToggle();
});
summaryGridEl.addEventListener('click', (event) => {
  const card = event.target.closest('[data-filter-key]');
  if (!card) return;
  const key = card.getAttribute('data-filter-key') || 'all';
  activeQuickFilter = activeQuickFilter === key ? 'all' : key;
  renderLeads();
});

updateSourceToggle();

loadDashboard().catch((error) => {
  warningsEl.hidden = false;
  warningsEl.innerHTML = `<div class="warning-chip">Dashboard load failed: ${escapeHtml(error.message)}</div>`;
});
