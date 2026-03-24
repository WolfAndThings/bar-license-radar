const ENTITY_MAP = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"'
};

function decodeNumericEntity(_, dec, hex) {
  const codePoint = Number.parseInt(dec || hex, dec ? 10 : 16);
  if (!Number.isFinite(codePoint)) return _;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return _;
  }
}

export function decodeHtmlEntities(input = '') {
  return String(input)
    .replace(/&#(\d+);/g, decodeNumericEntity)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeNumericEntity(_, '', hex))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITY_MAP[name.toLowerCase()] ?? match);
}

export function normalizeWhitespace(input = '') {
  return String(input)
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripTags(input = '') {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(input)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

export function escapeRegExp(input = '') {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractByIdText(html, id) {
  const pattern = new RegExp(`id="${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const match = String(html).match(pattern);
  return match ? stripTags(match[1]) : '';
}

export function extractByIdHtml(html, id) {
  const pattern = new RegExp(`id="${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const match = String(html).match(pattern);
  return match ? match[1] : '';
}

export function extractRows(html) {
  return Array.from(String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi), (match) => match[0]);
}

export function extractCells(rowHtml) {
  return Array.from(String(rowHtml).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (match) => match[1]);
}

export function slugify(input = '') {
  return normalizeWhitespace(String(input))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function firstMatch(input, pattern, group = 1) {
  const match = String(input).match(pattern);
  return match ? normalizeWhitespace(match[group] || '') : '';
}
