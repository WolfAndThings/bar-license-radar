import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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
const FARGO_BASE = 'https://fargond.gov/';
const FARGO_LCB_INDEX_PATH = 'city-government/boards-commissions/liquor-control-board/agendas-minutes';
const SIOUX_FALLS_ONBASE_BASE = 'https://amv.siouxfalls.gov/OnBaseAgendaOnline/';
const SIOUX_FALLS_SEARCH_URL = new URL('Meetings/Search?dropid=4', SIOUX_FALLS_ONBASE_BASE).toString();
const DULUTH_BASE = 'https://duluthmn.gov/';
const DULUTH_AGT_URL = absoluteUrl(DULUTH_BASE, 'boards-commissions/alcohol-gambling-tobacco-commission/');
const FETCH_TIMEOUT_MS = 20000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const execFile = promisify(execFileCb);

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function pdfBufferToText(buffer) {
  const tempPath = path.join(os.tmpdir(), `bar-license-radar-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  await fs.writeFile(tempPath, buffer);
  try {
    const { stdout } = await execFile('pdftotext', [tempPath, '-']);
    return stdout;
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
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

function fargoYearUrl(year) {
  return absoluteUrl(FARGO_BASE, `${FARGO_LCB_INDEX_PATH}/${year}-agendas-minutes`);
}

function listFargoYearPages(daysBack = 365) {
  const nowYear = new Date().getFullYear();
  const earliestYear = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).getFullYear();
  const years = [];
  for (let year = nowYear; year >= earliestYear; year -= 1) years.push(year);
  return years;
}

function parseFargoYearRows(html, yearUrl) {
  const rows = extractRows(html);
  const meetings = [];

  for (const rowHtml of rows) {
    const cells = extractCells(rowHtml);
    if (cells.length < 3) continue;

    const meetingDate = isoDate(stripTags(cells[0] || ''));
    const minutesHref = cells[2]?.match(/href="([^"]+)"/i)?.[1] || '';
    if (!meetingDate || !minutesHref || /\.(?:pdf|docx?)(?:$|\?)/i.test(minutesHref)) continue;

    meetings.push({
      meetingDate,
      minutesUrl: absoluteUrl(FARGO_BASE, minutesHref),
      officialMeetingUrl: yearUrl
    });
  }

  return meetings;
}

function extractFargoApplicationItems(minutesHtml = '') {
  const text = stripTags(minutesHtml);
  const sectionMatch = text.match(/2\.\s*Review Liquor Applications([\s\S]*?)(?:\n\d+\.\s+[A-Z]|$)/i);
  if (!sectionMatch) return [];

  return Array.from(
    sectionMatch[1].matchAll(/(?:^|\n)([a-z])\.\s+([\s\S]*?)(?=(?:\n[a-z]\.\s+)|(?:\n\d+\.\s+[A-Z])|$)/gi),
    (match) => normalizeWhitespace(String(match[2] || '').split(/\nMotion\b/i)[0])
  ).filter(Boolean);
}

function parseFargoApplicationText(text = '') {
  const clean = normalizeWhitespace(text);
  const licenseType =
    firstMatch(clean, /^(Issuance of (?:an?|a) .*? license)/i) || firstMatch(clean, /^(Conditional .*? license)/i);
  const applicantWithDba = clean.match(/license(?: to)?\s+(.+?)\s+d\/b\/a\s+(.+?)\s+(?:to be )?located at\s+(.+?)(?:\s+presented by|,|$)/i);
  if (applicantWithDba) {
    return {
      applicantEntity: normalizeWhitespace(applicantWithDba[1]),
      businessName: normalizeWhitespace(applicantWithDba[2]),
      address: normalizeWhitespace(applicantWithDba[3]),
      licenseType: licenseType || 'Liquor license action'
    };
  }

  const applicantNoDba = clean.match(/license(?: to)?\s+(.+?)\s+(?:to be )?located at\s+(.+?)(?:\s+presented by|,|$)/i);
  if (applicantNoDba) {
    return {
      applicantEntity: normalizeWhitespace(applicantNoDba[1]),
      businessName: normalizeWhitespace(applicantNoDba[1]),
      address: normalizeWhitespace(applicantNoDba[2]),
      licenseType: licenseType || 'Liquor license action'
    };
  }

  return {
    applicantEntity: '',
    businessName: '',
    address: parseAddressFromText(clean),
    licenseType: licenseType || 'Liquor license action'
  };
}

function buildFargoLead(applicationText, meeting) {
  const parsed = parseFargoApplicationText(applicationText);
  const businessName = parsed.businessName || parsed.applicantEntity || 'Unlabeled liquor applicant';

  return {
    id: `fargo-${slugify(`${meeting.meetingDate}-${businessName}`)}`,
    source_city: 'Fargo',
    source_state: 'ND',
    source_stage: 'board_minutes',
    business_name: businessName,
    dba_name: parsed.businessName || businessName,
    applicant_entity: parsed.applicantEntity || businessName,
    contact_name: '',
    contact_role: '',
    contact_phone: '',
    contact_email: '',
    website_url: '',
    address: parsed.address || '',
    license_type: parsed.licenseType,
    license_id: '',
    hearing_date: meeting.meetingDate,
    first_public_record_date: meeting.meetingDate,
    application_date: '',
    application_date_note: 'Exact filed date not exposed in the Fargo Liquor Control Board minutes; using the meeting date.',
    official_record_url: meeting.minutesUrl,
    official_meeting_url: meeting.officialMeetingUrl,
    official_title: applicationText,
    official_summary: 'Fargo Liquor Control Board minutes',
    official_attachments: [],
    status: 'heard'
  };
}

export async function collectFargoLeads({ daysBack = 365 } = {}) {
  const meetings = [];
  for (const year of listFargoYearPages(daysBack)) {
    const yearUrl = fargoYearUrl(year);
    const yearHtml = await fetchText(yearUrl);
    meetings.push(...parseFargoYearRows(yearHtml, yearUrl));
  }

  const recentMeetings = [...new Map(meetings.map((meeting) => [meeting.minutesUrl, meeting])).values()].filter((meeting) =>
    isRecent(meeting.meetingDate, daysBack)
  );

  const leads = [];
  for (const meeting of recentMeetings) {
    const minutesHtml = await fetchText(meeting.minutesUrl);
    const items = extractFargoApplicationItems(minutesHtml);
    for (const item of items) leads.push(buildFargoLead(item, meeting));
  }

  return leads;
}

function parseSiouxFallsSearchResults(html = '') {
  const match = html.match(/showSearchResults\(new SearchResults\((\{[\s\S]*?\})\)\);/i);
  if (!match) throw new Error('Could not locate embedded Sioux Falls meeting search results JSON.');
  return JSON.parse(match[1]);
}

function buildSiouxFallsAgendaUrl(meetingId) {
  return absoluteUrl(SIOUX_FALLS_ONBASE_BASE, `Documents/ViewAgenda?meetingId=${meetingId}&type=agenda&doctype=1`);
}

function buildSiouxFallsMeetingUrl(meetingId, docType = 1) {
  return absoluteUrl(SIOUX_FALLS_ONBASE_BASE, `Meetings/ViewMeeting?id=${meetingId}&doctype=${docType}`);
}

function extractSiouxFallsAgendaItems(agendaHtml = '') {
  const text = stripTags(agendaHtml);
  const matches = new Set();
  const patterns = [
    /Special One-Day Liquor License for .*?\./gi,
    /Approval of a request pursuant to SDCL 35-1-5\.5 from .*?\./gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      matches.add(normalizeWhitespace(match[0]));
    }
  }

  return [...matches];
}

function parseSiouxFallsAgendaItem(summary = '') {
  const clean = normalizeWhitespace(summary);

  if (/^Special One-Day Liquor License for /i.test(clean)) {
    const applicantEntity = firstMatch(clean, /Special One-Day Liquor License for (.+?), to be operated at/i);
    const address = parseAddressFromText(clean);
    const businessName =
      firstMatch(clean, /to be operated at (.+?),\s+\d/i) || firstMatch(clean, /to be operated at (.+?),\s+for /i) || applicantEntity;

    return {
      applicantEntity,
      businessName,
      address,
      licenseType: 'Special One-Day Liquor License'
    };
  }

  if (/consume, but not sell, alcoholic beverages/i.test(clean)) {
    const applicantEntity = firstMatch(clean, /from (.+?) to consume/i);
    const address = parseAddressFromText(clean);
    const businessName = firstMatch(clean, /at (.+?),\s+\d/i) || applicantEntity;

    return {
      applicantEntity,
      businessName,
      address,
      licenseType: 'Alcohol consumption request'
    };
  }

  return {
    applicantEntity: '',
    businessName: '',
    address: parseAddressFromText(clean),
    licenseType: 'Council alcohol item'
  };
}

function buildSiouxFallsLead(summary, meeting) {
  const parsed = parseSiouxFallsAgendaItem(summary);
  const meetingDate = isoDate(meeting.Time || meeting.TimeString || '');

  return {
    id: `siouxfalls-${meeting.ID}-${slugify(parsed.businessName || parsed.applicantEntity || summary.slice(0, 48))}`,
    source_city: 'Sioux Falls',
    source_state: 'SD',
    source_stage: 'council_agenda',
    business_name: parsed.businessName || parsed.applicantEntity || 'Sioux Falls applicant',
    dba_name: parsed.businessName || parsed.applicantEntity || 'Sioux Falls applicant',
    applicant_entity: parsed.applicantEntity || parsed.businessName || 'Sioux Falls applicant',
    contact_name: '',
    contact_role: '',
    contact_phone: '',
    contact_email: '',
    website_url: '',
    address: parsed.address || '',
    license_type: parsed.licenseType,
    license_id: '',
    hearing_date: meetingDate,
    first_public_record_date: meetingDate,
    application_date: '',
    application_date_note: 'Exact filed date not exposed in the Sioux Falls council agenda; using the agenda meeting date.',
    official_record_url: buildSiouxFallsAgendaUrl(meeting.ID),
    official_meeting_url: buildSiouxFallsMeetingUrl(meeting.ID, meeting.LatestDocumentType || 1),
    official_title: summary,
    official_summary: summary,
    official_attachments: [],
    status: meetingDate >= currentIsoDate() ? 'license_update' : 'heard'
  };
}

export async function collectSiouxFallsLeads({ daysBack = 120 } = {}) {
  const searchHtml = await fetchText(SIOUX_FALLS_SEARCH_URL);
  const searchResults = parseSiouxFallsSearchResults(searchHtml);
  const meetings = (searchResults?.Meetings || []).filter((meeting) => {
    const meetingType = meeting?.MeetingTypeName || '';
    const meetingDate = isoDate(meeting?.Time || meeting?.TimeString || '');
    if (!meetingDate || !isWithinDateWindow(meetingDate, { daysBack, futureDays: 30 })) return false;
    return meetingType === 'City Council Meeting' || meetingType === 'Special City Council Meeting';
  });

  const leads = [];
  for (const meeting of meetings) {
    if (!meeting?.IsAgendaAvailable) continue;
    const agendaHtml = await fetchText(buildSiouxFallsAgendaUrl(meeting.ID));
    const items = extractSiouxFallsAgendaItems(agendaHtml);
    for (const item of items) leads.push(buildSiouxFallsLead(item, meeting));
  }

  return leads;
}

function parseDuluthAgendaRows(html = '') {
  const rows = extractRows(html);
  const agendas = [];

  for (const rowHtml of rows) {
    const cells = extractCells(rowHtml);
    if (cells.length < 2) continue;
    const postedDate = isoDate(stripTags(cells[0] || ''));
    const title = normalizeWhitespace(stripTags(cells[1] || ''));
    const href = cells[1]?.match(/href=['"]([^'"]+)['"]/i)?.[1] || rowHtml.match(/href=['"]([^'"]+)['"]/i)?.[1] || '';
    if (!postedDate || !href || !/agenda/i.test(title)) continue;
    agendas.push({
      postedDate,
      title,
      pdfUrl: absoluteUrl(DULUTH_BASE, href)
    });
  }

  return agendas;
}

function parseDuluthMeetingDate(pdfText = '') {
  return isoDate(firstMatch(pdfText, /\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/));
}

function extractDuluthAgendaItems(pdfText = '') {
  const normalized = String(pdfText || '').replace(/\r/g, '').replace(/[\u2013\u2014]/g, '-');
  const sectionMatch = normalized.match(/NEW BUSINESS:\s*([\s\S]*?)(?:\n[A-Z][A-Z ]*:\s*|$)/i);
  if (!sectionMatch) return [];

  const collapsed = normalizeWhitespace(sectionMatch[1].replace(/\f/g, ' '));
  const pattern =
    /([A-Z0-9&'’.,()\/\- ]+?)\s*-\s*APPLICATION\s+FOR\s+(.*?)(?=(?:[A-Z0-9&'’.,()\/\- ]+?\s*-\s*APPLICATION\s+FOR)|$)/g;

  return Array.from(collapsed.matchAll(pattern), (match) =>
    normalizeWhitespace(`${match[1]} - APPLICATION FOR ${match[2]}`)
  ).filter(Boolean);
}

function parseDuluthAgendaItem(summary = '') {
  const clean = normalizeWhitespace(summary.replace(/[\u2013\u2014]/g, '-'));
  const head = firstMatch(clean, /^(.+?)\s+-\s+APPLICATION FOR/i);
  const applicationText = firstMatch(clean, /-\s+APPLICATION FOR\s+(.+)$/i);
  const businessMatch = head.match(/^(.*?)\s*\((.*?)\)$/);
  const applicantEntity = normalizeWhitespace(businessMatch?.[1] || head);
  const businessName = normalizeWhitespace(businessMatch?.[2] || applicantEntity);
  const address = parseAddressFromText(clean);
  const licenseType =
    firstMatch(applicationText, /^(.*?)(?:\s+(?:FOR|AT)\s+\d{2,5}\b|$)/i) || 'Duluth AGT agenda item';

  return {
    applicantEntity,
    businessName,
    address,
    licenseType: normalizeWhitespace(licenseType)
  };
}

function buildDuluthLead(summary, agenda) {
  const parsed = parseDuluthAgendaItem(summary);
  const meetingDate = agenda.meetingDate || agenda.postedDate;
  const businessName = parsed.businessName || parsed.applicantEntity || 'Duluth applicant';

  return {
    id: `duluth-${slugify(`${meetingDate}-${businessName}`)}`,
    source_city: 'Duluth',
    source_state: 'MN',
    source_stage: 'agt_agenda',
    business_name: businessName,
    dba_name: parsed.businessName || businessName,
    applicant_entity: parsed.applicantEntity || businessName,
    contact_name: '',
    contact_role: '',
    contact_phone: '',
    contact_email: '',
    website_url: '',
    address: parsed.address || '',
    license_type: parsed.licenseType,
    license_id: '',
    hearing_date: meetingDate,
    first_public_record_date: meetingDate,
    application_date: '',
    application_date_note: 'Exact filed date not exposed in the Duluth AGT agenda; using the agenda meeting date.',
    official_record_url: agenda.pdfUrl,
    official_meeting_url: DULUTH_AGT_URL,
    official_title: summary,
    official_summary: 'Duluth Alcohol, Gambling & Tobacco Commission agenda',
    official_attachments: [],
    status: meetingDate >= currentIsoDate() ? 'pending_hearing' : 'heard'
  };
}

export async function collectDuluthLeads({ daysBack = 180 } = {}) {
  const html = await fetchText(DULUTH_AGT_URL);
  const agendas = parseDuluthAgendaRows(html).filter((agenda) => isWithinDateWindow(agenda.postedDate, { daysBack, futureDays: 45 }));
  const uniqueAgendas = [...new Map(agendas.map((agenda) => [agenda.pdfUrl, agenda])).values()];
  const leads = [];

  for (const agenda of uniqueAgendas) {
    if (!/\.pdf(?:$|\?)/i.test(agenda.pdfUrl)) continue;
    const buffer = await fetchBuffer(agenda.pdfUrl);
    const pdfText = await pdfBufferToText(buffer);
    const meetingDate = parseDuluthMeetingDate(pdfText) || agenda.postedDate;
    const items = extractDuluthAgendaItems(pdfText);
    for (const item of items) {
      leads.push(buildDuluthLead(item, { ...agenda, meetingDate }));
    }
  }

  return leads;
}
