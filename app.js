const generatedAtEl = document.getElementById('generatedAt');
const leadCountEl = document.getElementById('leadCount');
const searchInputEl = document.getElementById('searchInput');
const cityFilterEl = document.getElementById('cityFilter');
const statusFilterEl = document.getElementById('statusFilter');
const warningsEl = document.getElementById('warnings');
const summaryGridEl = document.getElementById('summaryGrid');
const leadGridEl = document.getElementById('leadGrid');
const leadCardTemplate = document.getElementById('leadCardTemplate');

let allLeads = [];

function labelStatus(status = '') {
  return status.replace(/_/g, ' ');
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
      label: 'Pending / new',
      value: leads.filter((lead) => ['pending_hearing', 'license_hearing'].includes(lead.status)).length
    },
    {
      label: 'With a person name',
      value: leads.filter((lead) => lead.contact_name).length
    },
    {
      label: 'With email or phone',
      value: leads.filter((lead) => lead.contact_email || lead.contact_phone).length
    },
    {
      label: 'Need enrichment',
      value: leads.filter((lead) => !lead.website_url && !lead.contact_email && !lead.contact_phone).length
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
    lead.contact_email,
    lead.contact_phone,
    lead.address,
    lead.license_type,
    lead.official_summary
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(search);
}

function linkHtml(href, label) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderLeads() {
  const leads = allLeads.filter(matchesFilters);
  renderSummary(leads);
  leadCountEl.textContent = String(leads.length);

  const fragment = document.createDocumentFragment();

  for (const lead of leads) {
    const node = leadCardTemplate.content.cloneNode(true);
    node.querySelector('.city-badge').textContent = lead.source_city;
    node.querySelector('.status-badge').textContent = labelStatus(lead.status);
    node.querySelector('.lead-title').textContent = lead.business_name || 'Unnamed business';
    node.querySelector('.lead-subtitle').textContent = lead.address || lead.official_title || 'No address found yet';
    node.querySelector('.applicant').textContent = lead.applicant_entity || 'Unavailable';
    node.querySelector('.license').textContent = lead.license_type || 'Unavailable';
    node.querySelector('.dates').textContent = `Hearing: ${formatDate(lead.hearing_date)}\nFirst public record: ${formatDate(
      lead.first_public_record_date
    )}`;
    node.querySelector('.contact').textContent =
      [lead.contact_name, lead.contact_role, lead.contact_email, lead.contact_phone].filter(Boolean).join(' | ') ||
      'No public contact signal captured yet';

    const signals =
      lead.public_signals?.website_summary ||
      lead.official_summary ||
      'No additional public concept signal captured yet.';
    node.querySelector('.signals').textContent = signals;

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
  const [metaResponse, leadsResponse] = await Promise.all([fetch('./data/meta.json'), fetch('./data/leads.json')]);
  const meta = await metaResponse.json();
  const leads = await leadsResponse.json();

  allLeads = Array.isArray(leads) ? leads : [];
  generatedAtEl.textContent = meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : 'Not refreshed yet';
  leadCountEl.textContent = String(allLeads.length);
  renderWarnings(meta);

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

loadDashboard().catch((error) => {
  warningsEl.innerHTML = `<div class="warning-chip">Dashboard load failed: ${escapeHtml(error.message)}</div>`;
});
