import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeHtmlEntities,
  extractByIdHtml,
  extractByIdText,
  extractCells,
  extractRows,
  firstMatch,
  normalizeWhitespace,
  slugify,
  stripTags
} from './html.mjs';

const USER_AGENT = 'Mozilla/5.0 (compatible; BarLicenseRadar/1.0; +https://github.com)';
const ST_PAUL_BASE = 'https://stpaul.legistar.com/';
const ST_PAUL_CALENDAR_URL = new URL('Calendar.aspx', ST_PAUL_BASE).toString();
const MINNEAPOLIS_BASE = 'https://lims.minneapolismn.gov/';
const MINNEAPOLIS_PUBLIC_HEARINGS_URL = new URL('Reports/PublicHearings', MINNEAPOLIS_BASE).toString();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function absoluteUrl(base, href = '') {
  return new URL(decodeHtmlEntities(href), base).toString();
}

function isoDate(input = '') {
  const value = String(input).trim();
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function isRecent(dateString, daysBack) {
  if (!dateString) return false;
  const now = Date.now();
  const then = new Date(dateString).getTime();
  if (Number.isNaN(then)) return false;
  return now - then <= daysBack * 24 * 60 * 60 * 1000;
}

function isWithinDateWindow(dateString, { daysBack = 180, futureDays = 45 } = {}) {
  if (!dateString) return false;
  const target = new Date(dateString).getTime();
  if (Number.isNaN(target)) return false;
  const now = Date.now();
  const pastBoundary = now - daysBack * 24 * 60 * 60 * 1000;
  const futureBoundary = now + futureDays * 24 * 60 * 60 * 1000;
  return target >= pastBoundary && target <= futureBoundary;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

function parseAddressFromText(text = '') {
  const pattern =
    /\b\d{2,5}\s+[A-Za-z0-9.'#-]+(?:\s+[A-Za-z0-9.'#-]+){0,8}\s(?:Ave|Avenue|St|Street|Blvd|Boulevard|Rd|Road|Dr|Drive|Ct|Court|Pl|Place|Way|Pkwy|Parkway|Ln|Lane)\b(?:\s+[NSEW]{1,2})?/i;
  const match = text.match(pattern);
  return match ? normalizeWhitespace(match[0]) : '';
}

function parseStPaulTitle(title = '') {
  const clean = normalizeWhitespace(title);
  const applicantEntity = firstMatch(clean, /License Application Summary for (.+?) \(License ID#/i);
  const licenseId = firstMatch(clean, /License ID#\s*([A-Z0-9-]+)/i);
  const dbaMatch =
    clean.match(/(?:d\/b\/a|doing business as)\s+([^,]+),\s+([^,]+),\s+([^,]+),\s+([0-9().\-+ ]+)/i) || [];

  return {
    applicantEntity,
    licenseId,
    businessName: normalizeWhitespace(dbaMatch[1] || ''),
    contactName: normalizeWhitespace(dbaMatch[2] || ''),
    contactRole: normalizeWhitespace(String(dbaMatch[3] || '').toLowerCase()),
    contactPhone: normalizeWhitespace(dbaMatch[4] || '').replace(/[.,;:]+$/, '')
  };
}

function parseStPaulApplicationFor(fullTextHtml = '') {
  const match = fullTextHtml.match(
    /Application for<\/span><\/p>\s*<p[^>]*><span[^>]*>([\s\S]*?)<\/span>/i
  );
  return match ? stripTags(match[1]) : '';
}

function parseStPaulAttachmentLinks(detailHtml = '') {
  const attachmentsHtml = extractByIdHtml(detailHtml, 'ctl00_ContentPlaceHolder1_lblAttachments2');
  return Array.from(attachmentsHtml.matchAll(/href="([^"]+)"/gi), (match) => absoluteUrl(ST_PAUL_BASE, match[1]));
}

function buildStPaulLead({ meetingDate, meetingUrl, detailUrl, title, detailHtml, fullTextHtml }) {
  const titleParts = parseStPaulTitle(title);
  const fullText = stripTags(fullTextHtml);
  const applicationFor = parseStPaulApplicationFor(fullTextHtml);
  const finalActionDate = extractByIdText(detailHtml, 'ctl00_ContentPlaceHolder1_lblPassed2');
  const attachments = parseStPaulAttachmentLinks(detailHtml);
  const historyDate = firstMatch(detailHtml, /<td class="rgSorted">([^<]+)<\/td>/i);
  const address = parseAddressFromText(fullText);
  const businessName = titleParts.businessName || titleParts.applicantEntity;

  return {
    id: `stpaul-${slugify(titleParts.licenseId || `${businessName}-${meetingDate}`)}`,
    source_city: 'St. Paul',
    source_state: 'MN',
    source_stage: 'license_hearing',
    business_name: businessName,
    dba_name: businessName,
    applicant_entity: titleParts.applicantEntity,
    contact_name: titleParts.contactName,
    contact_role: titleParts.contactRole,
    contact_phone: titleParts.contactPhone,
    contact_email: '',
    website_url: '',
    address,
    license_type: applicationFor,
    license_id: titleParts.licenseId,
    hearing_date: isoDate(historyDate || meetingDate),
    first_public_record_date: isoDate(historyDate || meetingDate),
    application_date: '',
    application_date_note: 'Exact filed date not exposed in the public record; using first public hearing/record date.',
    official_record_url: detailUrl,
    official_meeting_url: meetingUrl,
    official_title: title,
    official_summary: applicationFor,
    official_attachments: attachments,
    status: finalActionDate ? 'heard' : 'public_recorded'
  };
}

async function collectStPaulMeetingLeads(meeting) {
  const meetingHtml = await fetchText(meeting.meetingUrl);
  const rows = extractRows(meetingHtml);
  const leads = [];

  for (const rowHtml of rows) {
    if (!rowHtml.includes('LegislationDetail.aspx')) continue;
    const cells = extractCells(rowHtml);
    if (cells.length < 6) continue;

    const detailHref = rowHtml.match(/href="(LegislationDetail\.aspx\?ID=\d+&amp;GUID=[^"]+)"/i)?.[1];
    const title = stripTags(cells[4] || '');
    if (!/License Application Summary/i.test(title)) continue;

    const detailUrl = absoluteUrl(ST_PAUL_BASE, detailHref);
    const detailHtml = await fetchText(detailUrl);
    const fullTextUrl = detailUrl.includes('?') ? `${detailUrl}&FullText=1` : `${detailUrl}?FullText=1`;
    const fullTextHtml = await fetchText(fullTextUrl);

    leads.push(
      buildStPaulLead({
        meetingDate: meeting.meetingDate,
        meetingUrl: meeting.meetingUrl,
        detailUrl,
        title,
        detailHtml,
        fullTextHtml
      })
    );
  }

  return leads;
}

export async function collectStPaulLeads({ daysBack = 180 } = {}) {
  const calendarHtml = await fetchText(ST_PAUL_CALENDAR_URL);
  const rows = extractRows(calendarHtml);
  const meetings = [];

  for (const rowHtml of rows) {
    if (!/>Licensing Hearing</i.test(rowHtml)) continue;
    const dateText = rowHtml.match(/<td class="rgSorted">([^<]+)<\/td>/i)?.[1] || '';
    const meetingHref = rowHtml.match(/href="(MeetingDetail\.aspx\?ID=\d+&amp;GUID=[^"]+)"/i)?.[1] || '';
    const meetingDate = isoDate(dateText);
    if (!meetingHref || !meetingDate || !isRecent(meetingDate, daysBack)) continue;

    meetings.push({
      meetingDate,
      meetingUrl: absoluteUrl(ST_PAUL_BASE, meetingHref)
    });
  }

  const uniqueMeetingUrls = [...new Map(meetings.map((meeting) => [meeting.meetingUrl, meeting])).values()];
  const leads = [];

  for (const meeting of uniqueMeetingUrls) {
    const meetingLeads = await collectStPaulMeetingLeads(meeting);
    leads.push(...meetingLeads);
  }

  return leads;
}

function loadPlaywright() {
  const candidates = [
    'playwright',
    path.join(__dirname, '..', '..', 'master_bot', 'node_modules', 'playwright'),
    path.join(__dirname, '..', '..', 'LoopWorker', 'engagement', 'node_modules', 'playwright')
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      continue;
    }
  }

  throw new Error('Playwright is not installed. Run npm install in bar-license-radar or point to an existing local install.');
}

function parseMinneapolisAddress(text = '') {
  const match = text.match(/,\s+([^,]+(?:,\s*[^,]+)*?)\s+Minneapolis,\s*MN/i);
  if (!match) return '';
  return normalizeWhitespace(`${match[1]} Minneapolis, MN`);
}

function parseMinneapolisPublicHearingLead(row) {
  const text = normalizeWhitespace(row.title || row.publicHearing || '');
  const isLiquorSignal =
    /\bBL[A-Za-z]+\b/.test(text) ||
    /\bLIC\d+\b/i.test(text) ||
    /liquor|wine on sale|malt on sale|beer|brewery|distillery|taproom|cocktail room/i.test(text);

  if (!isLiquorSignal) return null;

  const businessName = normalizeWhitespace(text.split(',')[0] || '');
  const applicantEntity = firstMatch(text, /submitted by ([^,]+?)(?:,\s*BL[A-Za-z]+|,|$)/i);
  const licenseTypeCode = firstMatch(text, /\b(BL[A-Za-z]+)\b/);
  const hearingDate = isoDate(row.hearingDate);
  const today = new Date().toISOString().slice(0, 10);
  const fileNumber = firstMatch(row.fileUrl, /\/File\/(\d{4}-\d+)/i);

  return {
    id: `mpls-${slugify(fileNumber || `${businessName}-${hearingDate}`)}`,
    source_city: 'Minneapolis',
    source_state: 'MN',
    source_stage: 'public_hearing',
    business_name: businessName,
    dba_name: businessName,
    applicant_entity: applicantEntity,
    contact_name: '',
    contact_role: '',
    contact_phone: '',
    contact_email: '',
    website_url: '',
    address: parseMinneapolisAddress(text) || parseAddressFromText(text),
    license_type: licenseTypeCode,
    license_id: firstMatch(text, /\b(LIC\d+)\b/i),
    hearing_date: hearingDate,
    first_public_record_date: hearingDate,
    application_date: '',
    application_date_note: 'Exact filed date not exposed in the public hearings report; using the published hearing date.',
    official_record_url: row.fileUrl,
    official_meeting_url: MINNEAPOLIS_PUBLIC_HEARINGS_URL,
    official_title: text,
    official_summary: `${row.committeeName} public hearing`,
    official_attachments: [],
    status: hearingDate >= today ? 'pending_hearing' : 'public_recorded'
  };
}

async function parseMinneapolisPublicHearings(page) {
  await page.goto(MINNEAPOLIS_PUBLIC_HEARINGS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    const select = Array.from(document.querySelectorAll('select')).find((element) =>
      Array.from(element.options || []).some((option) => option.value === '100')
    );
    if (!select) return false;
    select.value = '100';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(1500);

  return page.evaluate(() =>
    Array.from(document.querySelectorAll('table tbody tr'))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => (cell.innerText || '').trim());
        const fileAnchor = row.querySelector('a[href^="/File/"]');
        const hearingDate =
          String(cells[0] || '')
            .split('\n')
            .map((value) => value.trim())
            .find((value) => /\b[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}\b/.test(value)) || cells[0] || '';
        return {
          hearingDate,
          committeeName: cells[1] || '',
          title: cells[2] || '',
          publicHearing: cells[2] || '',
          fileUrl: fileAnchor ? fileAnchor.getAttribute('href') || '' : ''
        };
      })
      .filter((row) => row.hearingDate && row.title)
  );
}

export async function collectMinneapolisLeads({ daysBack = 180 } = {}) {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: USER_AGENT
  });
  const page = await context.newPage();

  try {
    const rows = await parseMinneapolisPublicHearings(page);
    return rows
      .filter((row) => isWithinDateWindow(isoDate(row.hearingDate), { daysBack, futureDays: 45 }))
      .map((row) => ({
        ...row,
        fileUrl: row.fileUrl ? absoluteUrl(MINNEAPOLIS_BASE, row.fileUrl) : ''
      }))
      .map((row) => parseMinneapolisPublicHearingLead(row))
      .filter(Boolean);
  } finally {
    await context.close();
    await browser.close();
  }
}
