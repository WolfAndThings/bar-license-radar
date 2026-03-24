const generatedAtEl = document.getElementById('generatedAt');
const leadCountEl = document.getElementById('leadCount');
const searchInputEl = document.getElementById('searchInput');
const cityFilterEl = document.getElementById('cityFilter');
const statusFilterEl = document.getElementById('statusFilter');
const warningsEl = document.getElementById('warnings');
const allLicensesLinksEl = document.getElementById('allLicensesLinks');
const sourceScheduleGridEl = document.getElementById('sourceScheduleGrid');
const sourceToggleEl = document.getElementById('sourceToggle');
const sourcePanelBodyEl = document.getElementById('sourcePanelBody');
const summaryGridEl = document.getElementById('summaryGrid');
const callListEl = document.getElementById('callList');
const leadGridEl = document.getElementById('leadGrid');
const leadCardTemplate = document.getElementById('leadCardTemplate');

let allLeads = [];
let allSources = [];

function preferredContactName(lead) {
  return lead.contact_name || lead.enriched_contact_name || '';
}

function hasAnyDirectContact(lead) {
  return Boolean(lead.contact_email || lead.contact_phone || lead.enriched_contact_email || lead.enriched_contact_phone);
}

function hasDistributorSignal(lead) {
  return ['exact', 'brand_inferred'].includes(lead.distributor_signal_type);
}

function hasMenuChangeSignal(lead) {
  return ['stable', 'moderate_change', 'major_change'].includes(lead.menu_change_signal);
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

function renderWarnings(meta) {
  warningsEl.innerHTML = '';
  if (!meta?.warnings?.length) return;
  warningsEl.innerHTML = meta.warnings
    .map((warning) => `<div class="warning-chip">${escapeHtml(warning)}</div>`)
    .join('');
}

function renderSummary(leads) {
  const cards = [
    {
      label: 'Current / upcoming',
      value: leads.filter((lead) => ['pending_hearing', 'license_hearing'].includes(lead.status)).length
    },
    {
      label: 'Named contact',
      value: leads.filter((lead) => preferredContactName(lead)).length
    },
    {
      label: 'Direct contact',
      value: leads.filter((lead) => hasAnyDirectContact(lead)).length
    },
    {
      label: 'Needs website/contact',
      value: leads.filter((lead) => !lead.website_url && !hasAnyDirectContact(lead)).length
    },
    {
      label: 'Distributor mapped',
      value: leads.filter((lead) => hasDistributorSignal(lead)).length
    },
    {
      label: 'Menu changed',
      value: leads.filter((lead) => ['moderate_change', 'major_change'].includes(lead.menu_change_signal)).length
    },
    {
      label: 'High-likelihood',
      value: leads.filter((lead) => (lead.sales_likelihood_score ?? 0) >= 70).length
    }
  ];

  summaryGridEl.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${card.value}</strong>
        </article>
      `
    )
    .join('');
}

function callPriority(lead) {
  const score = Number(lead.sales_likelihood_score ?? 0);
  const statusBoost = ['pending_hearing', 'license_hearing'].includes(lead.status)
    ? 35
    : lead.status === 'heard'
      ? 20
      : 10;
  const contactBoost = hasAnyDirectContact(lead) ? 12 : 0;
  const namedBoost = preferredContactName(lead) ? 8 : 0;
  const distributorPenalty = lead.distributor_signal_type === 'exact' ? -2 : 0;

  return score + statusBoost + contactBoost + namedBoost + distributorPenalty;
}

function renderCallList(leads) {
  const ranked = [...leads]
    .sort((a, b) => {
      const priorityDelta = callPriority(b) - callPriority(a);
      if (priorityDelta !== 0) return priorityDelta;
      return (b.hearing_date || '').localeCompare(a.hearing_date || '');
    })
    .slice(0, 4);

  if (!ranked.length) {
    callListEl.innerHTML = '';
    return;
  }

  callListEl.innerHTML = `
    <div class="call-list-head">
      <div>
        <p class="eyebrow">Call First</p>
        <h2 class="section-title">Who should I be calling today?</h2>
      </div>
      <p class="section-copy">
        Ranked from the current board based on timing, likelihood, and whether there is a real person or direct line to contact.
      </p>
    </div>
    <div class="call-list-grid">
      ${ranked
        .map(
          (lead) => `
            <article class="call-card">
              <div class="badge-row">
                <span class="city-badge">${escapeHtml(lead.source_city)}</span>
                <span class="status-badge">${escapeHtml(labelStatus(lead.status))}</span>
                <span class="score-badge">${escapeHtml(labelScore(lead))}</span>
              </div>
              <h3 class="call-card-title">${escapeHtml(lead.business_name || 'Unnamed business')}</h3>
              <p class="call-card-subtitle">${escapeHtml(lead.address || 'No address found yet')}</p>
              <div class="call-card-meta">
                <div>
                  <span class="meta-kicker">Call</span>
                  <p>${escapeHtml(bestContactLine(lead))}</p>
                </div>
                <div>
                  <span class="meta-kicker">Why now</span>
                  <p>${escapeHtml(lead.sales_fit || lead.sales_likelihood_label || 'Active lead')}</p>
                </div>
              </div>
              <p class="call-card-summary">${escapeHtml(lead.sales_likelihood_summary || lead.inclusion_summary || '')}</p>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function matchesFilters(lead) {
  const city = cityFilterEl.value;
  const status = statusFilterEl.value;
  const search = searchInputEl.value.trim().toLowerCase();

  if (city !== 'all' && lead.source_city !== city) return false;
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
    lead.menu_change_summary,
    lead.wholesaler_risk_summary,
    ...(Array.isArray(lead.menu_brands) ? lead.menu_brands : [])
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(search);
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
  const coreSources = [...sources]
    .filter((source) => source.tier === 'core')
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority) || a.source_name.localeCompare(b.source_name));

  if (!coreSources.length) {
    sourceScheduleGridEl.innerHTML = '<p class="empty-state">No source schedule loaded yet.</p>';
    return;
  }

  sourceScheduleGridEl.innerHTML = coreSources
    .map(
      (source) => `
        <details class="source-card">
          <summary class="source-summary">
            <div class="source-summary-main">
              <div class="badge-row">
                <span class="city-badge">${escapeHtml(source.state)}</span>
                <span class="status-badge">${escapeHtml(source.city)}</span>
                <span class="score-badge">${escapeHtml(titleCase(source.priority || 'reference'))}</span>
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
      `
    )
    .join('');
}

function updateSourceToggle() {
  const isExpanded = !sourcePanelBodyEl.hidden;
  sourceToggleEl.textContent = isExpanded ? 'Hide sources' : 'Show sources';
  sourceToggleEl.setAttribute('aria-expanded', String(isExpanded));
}

function renderLeads() {
  const leads = allLeads.filter(matchesFilters);
  renderSummary(leads);
  renderCallList(leads);
  leadCountEl.textContent = String(leads.length);

  const fragment = document.createDocumentFragment();

  for (const lead of leads) {
    const node = leadCardTemplate.content.cloneNode(true);
    node.querySelector('.city-badge').textContent = lead.source_city;
    node.querySelector('.status-badge').textContent = labelStatus(lead.status);
    node.querySelector('.score-badge').textContent = labelScore(lead);
    node.querySelector('.lead-title').textContent = lead.business_name || 'Unnamed business';
    node.querySelector('.lead-subtitle').textContent = lead.address || lead.official_title || 'No address found yet';
    node.querySelector('.applicant').textContent = lead.applicant_entity || 'Unavailable';
    node.querySelector('.license').textContent = lead.license_type || 'Unavailable';
    node.querySelector('.dates').textContent = `Hearing: ${formatDate(lead.hearing_date)}\nFirst public record: ${formatDate(
      lead.first_public_record_date
    )}`;
    node.querySelector('.contact-official').textContent = formatContactLine(
      [lead.contact_name, lead.contact_role, lead.contact_email, lead.contact_phone],
      'No official contact signal captured yet'
    );
    node.querySelector('.contact-enriched').textContent = formatContactLine(
      [lead.enriched_contact_name, lead.enriched_contact_role, lead.enriched_contact_email, lead.enriched_contact_phone],
      'No enriched contact captured yet'
    );

    const signals =
      lead.public_signals?.website_summary ||
      lead.official_summary ||
      'No additional public concept signal captured yet.';
    node.querySelector('.signals').textContent = signals;
    node.querySelector('.hearing-summary').textContent =
      lead.hearing_purpose_summary || 'No hearing-purpose summary generated yet.';
    node.querySelector('.inclusion-summary').textContent =
      lead.inclusion_summary || 'No inclusion summary generated yet.';
    node.querySelector('.sales-summary').textContent =
      `${lead.sales_fit ? `${lead.sales_fit}. ` : ''}${lead.sales_likelihood_summary || 'No sale-likelihood summary generated yet.'}`;
    node.querySelector('.distributor-summary').textContent =
      `${lead.distributor_confidence_label || 'Unknown'}${lead.distributor_name ? ` | ${lead.distributor_name}` : ''}. ${
        lead.distributor_summary || 'No distributor signal generated yet.'
      }`;
    node.querySelector('.distributor-next-step').textContent =
      lead.distributor_next_step || 'No next-step guidance generated yet.';
    node.querySelector('.menu-summary').textContent =
      `${lead.menu_change_label || 'Unknown'}. ${lead.menu_change_summary || 'No menu-comparison summary generated yet.'}`;
    node.querySelector('.wholesaler-risk-summary').textContent =
      `${lead.wholesaler_risk_label || 'Unknown'}. ${
        lead.wholesaler_risk_summary || 'No wholesaler-risk summary generated yet.'
      }`;

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
    fragment.appendChild(node);
  }

  leadGridEl.innerHTML = '';
  if (!leads.length) {
    leadGridEl.innerHTML = '<p class="empty-state">No leads match the current filters.</p>';
    return;
  }
  leadGridEl.appendChild(fragment);
}

async function loadDashboard() {
  const [metaResponse, leadsResponse, sourcesResponse] = await Promise.all([
    fetch('./data/meta.json'),
    fetch('./data/leads.json'),
    fetch('./data/sources.json')
  ]);
  const meta = await metaResponse.json();
  const leads = await leadsResponse.json();
  const sources = await sourcesResponse.json();

  allLeads = Array.isArray(leads) ? leads : [];
  allSources = Array.isArray(sources) ? sources : [];
  generatedAtEl.textContent = meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : 'Not refreshed yet';
  leadCountEl.textContent = String(allLeads.length);
  renderWarnings(meta);
  renderAllLicenseLinks(allSources);
  renderSourceSchedule(allSources);

  const cities = [...new Set(allLeads.map((lead) => lead.source_city).filter(Boolean))];
  for (const city of cities) {
    const option = document.createElement('option');
    option.value = city;
    option.textContent = city;
    cityFilterEl.appendChild(option);
  }

  renderLeads();
}

searchInputEl.addEventListener('input', renderLeads);
cityFilterEl.addEventListener('change', renderLeads);
statusFilterEl.addEventListener('change', renderLeads);
sourceToggleEl.addEventListener('click', () => {
  sourcePanelBodyEl.hidden = !sourcePanelBodyEl.hidden;
  updateSourceToggle();
});

updateSourceToggle();

loadDashboard().catch((error) => {
  warningsEl.innerHTML = `<div class="warning-chip">Dashboard load failed: ${escapeHtml(error.message)}</div>`;
});
