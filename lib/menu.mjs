import { decodeHtmlEntities, normalizeWhitespace, stripTags } from './html.mjs';

const USER_AGENT = 'Mozilla/5.0 (compatible; BarLicenseRadar/1.0; +https://github.com)';
const MENU_KEYWORDS = ['menu', 'drink', 'cocktail', 'wine', 'beer', 'spirits', 'beverage', 'bar'];
const STOPWORDS = new Set([
  'and',
  'the',
  'with',
  'from',
  'for',
  'your',
  'house',
  'draft',
  'tap',
  'glass',
  'bottle',
  'can',
  'cans',
  'beer',
  'beers',
  'wine',
  'wines',
  'cocktail',
  'cocktails',
  'spirits',
  'drinks',
  'menu',
  'menus',
  'food',
  'brunch',
  'happy',
  'hour',
  'served'
]);

function compactSentence(input = '') {
  return normalizeWhitespace(String(input).replace(/[ \t]+/g, ' '));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function sixMonthWindow(now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  start.setMonth(start.getMonth() - 6);
  return {
    start,
    end,
    startIso: isoDate(start),
    endIso: isoDate(end)
  };
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function absoluteUrl(base, href = '') {
  try {
    return new URL(decodeHtmlEntities(href), base).toString();
  } catch {
    return '';
  }
}

function extractLinks(html = '', baseUrl = '') {
  return Array.from(String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi), (match) => ({
    href: absoluteUrl(baseUrl, match[1]),
    text: compactSentence(stripTags(match[2]))
  })).filter((link) => link.href);
}

function menuScore(link) {
  const text = `${link.href} ${link.text}`.toLowerCase();
  let score = 0;
  for (const keyword of MENU_KEYWORDS) {
    if (text.includes(keyword)) score += 2;
  }
  if (/pdf(?:$|\?)/i.test(link.href)) score -= 3;
  if (/food-menu|drink-menu|cocktail-menu|beer-list|wine-list|menu/i.test(link.href)) score += 3;
  return score;
}

async function fetchCurrentMenu(websiteUrl = '') {
  if (!websiteUrl) {
    return {
      menu_source_url: '',
      menu_current_text: '',
      menu_source_note: 'No website URL available yet for menu scraping.'
    };
  }

  try {
    const homepageHtml = await fetchText(websiteUrl);
    const links = extractLinks(homepageHtml, websiteUrl)
      .map((link) => ({ ...link, score: menuScore(link) }))
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score || a.href.localeCompare(b.href));

    const candidates = [];
    if (menuScore({ href: websiteUrl, text: '' }) > 0) candidates.push({ href: websiteUrl, text: '', score: 1 });
    candidates.push(...links);

    const seen = new Set();
    const uniqueCandidates = candidates.filter((candidate) => {
      if (!candidate.href || seen.has(candidate.href)) return false;
      seen.add(candidate.href);
      return true;
    });

    for (const candidate of uniqueCandidates.slice(0, 4)) {
      if (/pdf(?:$|\?)/i.test(candidate.href)) {
        return {
          menu_source_url: candidate.href,
          menu_current_text: '',
          menu_source_note: 'A likely menu PDF was found, but PDF parsing is not wired in yet.'
        };
      }

      const html = await fetchText(candidate.href, 15000).catch(() => '');
      const text = compactSentence(stripTags(html)).slice(0, 20000);
      if (text.length < 250) continue;
      return {
        menu_source_url: candidate.href,
        menu_current_text: text,
        menu_source_note: candidate.href === websiteUrl ? 'Using the venue homepage as the current menu source.' : 'Using a likely menu page on the venue website.'
      };
    }

    return {
      menu_source_url: websiteUrl,
      menu_current_text: '',
      menu_source_note: 'A website was found, but no menu page with enough readable text was detected.'
    };
  } catch {
    return {
      menu_source_url: websiteUrl,
      menu_current_text: '',
      menu_source_note: 'The venue website could not be fetched for menu comparison.'
    };
  }
}

async function fetchWaybackSnapshot(url, aroundDate) {
  if (!url || /pdf(?:$|\?)/i.test(url)) return null;

  const cdxUrl =
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}` +
    `&from=${aroundDate.replace(/-/g, '')}&to=${aroundDate.replace(/-/g, '')}` +
    '&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1';

  try {
    const response = await fetchText(cdxUrl, 15000);
    const rows = JSON.parse(response);
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const [timestamp, original] = rows[1];
    if (!timestamp || !original) return null;
    const archiveUrl = `https://web.archive.org/web/${timestamp}id_/${original}`;
    const archiveHtml = await fetchText(archiveUrl, 20000).catch(() => '');
    const archiveText = compactSentence(stripTags(archiveHtml)).slice(0, 20000);
    if (archiveText.length < 250) return null;
    return {
      menu_archive_url: archiveUrl,
      menu_archive_timestamp: timestamp,
      menu_archive_text: archiveText
    };
  } catch {
    return null;
  }
}

function tokenize(text = '') {
  return [...new Set(
    compactSentence(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  )];
}

function similarityScore(a = '', b = '') {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function classifyMenuChange(currentText, archiveText) {
  const score = similarityScore(currentText, archiveText);
  if (score >= 0.72) return { signal: 'stable', similarity: score };
  if (score >= 0.44) return { signal: 'moderate_change', similarity: score };
  return { signal: 'major_change', similarity: score };
}

function riskFromMenuSignal(signal = '') {
  if (signal === 'stable') return 'low';
  if (signal === 'moderate_change') return 'medium';
  if (signal === 'major_change') return 'high';
  return 'unknown';
}

function signalLabel(signal = '') {
  if (signal === 'stable') return 'Stable';
  if (signal === 'moderate_change') return 'Moderate change';
  if (signal === 'major_change') return 'Major change';
  return 'Unknown';
}

function riskLabel(signal = '') {
  if (signal === 'low') return 'Low';
  if (signal === 'medium') return 'Medium';
  if (signal === 'high') return 'High';
  return 'Unknown';
}

function buildCandidatePhrases(line = '') {
  const cleaned = line
    .replace(/\$?\d+(?:\.\d{2})?/g, ' ')
    .replace(/\b\d{1,3}%\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[|/]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned || cleaned.length > 80) return [];

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean);

  if (!tokens.length) return [];

  const phrases = [];
  for (let start = 0; start < Math.min(tokens.length, 3); start += 1) {
    for (let size = 1; size <= 4 && start + size <= tokens.length; size += 1) {
      const slice = tokens.slice(start, start + size);
      if (!slice.some((token) => /^[A-Z0-9]/.test(token))) continue;
      const normalized = slice.join(' ');
      const key = normalized.toLowerCase();
      if (STOPWORDS.has(key)) continue;
      if (/^(draft|tap|glass|bottle|cocktails?|wines?|beers?|spirits?)$/i.test(normalized)) continue;
      phrases.push(normalized);
    }
  }

  return phrases;
}

function extractMenuBrands(text = '') {
  const lines = compactSentence(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 400);

  const candidates = [];
  for (const line of lines) {
    candidates.push(...buildCandidatePhrases(line));
  }

  return [...new Set(candidates.map((value) => compactSentence(value)).filter((value) => value.length >= 3))].slice(0, 18);
}

function menuSummary(lead, state) {
  const business = lead.business_name || 'This venue';

  if (!state.menu_source_url) {
    return `No current menu source was found for ${business}, so no 6-month comparison was possible yet.`;
  }

  if (!state.menu_current_text) {
    return `${business} has a likely menu source, but the current menu text was not readable enough to compare.`;
  }

  if (!state.menu_archive_url || !state.menu_archive_text) {
    return `${business} has a current menu source, but no readable public snapshot from ${state.menu_change_window_start} to ${state.menu_change_window_end} was available for comparison.`;
  }

  if (state.menu_change_signal === 'stable') {
    return `${business}'s current menu looks broadly stable versus the public snapshot from about 6 months ago.`;
  }

  if (state.menu_change_signal === 'moderate_change') {
    return `${business}'s current menu looks meaningfully different from the public snapshot from about 6 months ago.`;
  }

  return `${business}'s current menu looks materially different from the public snapshot from about 6 months ago.`;
}

function riskSummary(state) {
  if (state.wholesaler_risk_signal === 'low') {
    return 'The public menu looks fairly stable. That does not suggest obvious supplier churn from menu evidence alone.';
  }
  if (state.wholesaler_risk_signal === 'medium') {
    return 'The menu appears to have changed meaningfully. That can signal beverage-program movement, but it is not proof of a wholesaler problem.';
  }
  if (state.wholesaler_risk_signal === 'high') {
    return 'The menu appears to have changed materially. That can create a sales opening, but it is still not proof of a bad wholesaler.';
  }
  return 'No menu-comparison evidence is available yet, so no wholesaler-risk signal should be inferred from menu history.';
}

function nextStep(state) {
  if (!state.menu_source_url) {
    return 'Find the venue website or menu page first, then compare it against archived snapshots and social/menu-photo history.';
  }
  if (!state.menu_current_text) {
    return 'Pull a readable HTML menu page or parse the menu PDF before trying to compare brand changes.';
  }
  if (!state.menu_archive_url) {
    return 'Check Wayback, Google Maps photos, Instagram, Toast, SinglePlatform, or PDF archives for an older menu snapshot.';
  }
  return 'Review added and removed brands from the current versus archived menu before drawing any supplier conclusion.';
}

export async function hydrateMenuSignals(lead) {
  const window = sixMonthWindow();
  const current = await fetchCurrentMenu(lead.website_url || '');
  const archive = current.menu_source_url ? await fetchWaybackSnapshot(current.menu_source_url, window.startIso) : null;

  const compared = current.menu_current_text && archive?.menu_archive_text ? classifyMenuChange(current.menu_current_text, archive.menu_archive_text) : null;
  const menu_change_signal = compared?.signal || 'unknown';
  const wholesaler_risk_signal = riskFromMenuSignal(menu_change_signal);

  const state = {
    menu_change_window_start: window.startIso,
    menu_change_window_end: window.endIso,
    menu_source_url: current.menu_source_url || '',
    menu_archive_url: archive?.menu_archive_url || '',
    menu_archive_timestamp: archive?.menu_archive_timestamp || '',
    menu_change_signal,
    menu_change_label: signalLabel(menu_change_signal),
    menu_change_similarity: compared ? Number(compared.similarity.toFixed(3)) : null,
    menu_source_note: current.menu_source_note || '',
    menu_brands: extractMenuBrands(current.menu_current_text || ''),
    wholesaler_risk_signal,
    wholesaler_risk_label: riskLabel(wholesaler_risk_signal)
  };

  return {
    ...lead,
    ...state,
    menu_change_summary: menuSummary(lead, state),
    menu_next_step: nextStep(state),
    wholesaler_risk_summary: riskSummary(state)
  };
}
