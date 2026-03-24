function firstName(fullName = '') {
  return String(fullName).trim().split(/\s+/)[0] || 'there';
}

function compactSentence(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

function preferredContactName(lead) {
  return lead.contact_name || lead.enriched_contact_name || '';
}

function buildConceptLine(lead) {
  const summary = lead?.website_url ? compactSentence(lead?.public_signals?.website_summary || '') : '';
  if (summary) return `The public-facing footprint suggests ${summary.replace(/[.]+$/, '')}.`;

  const licenseType = `${lead.license_type || ''} ${lead.application_summary || ''}`.toLowerCase();
  if (licenseType.includes('patio')) {
    return 'The patio piece makes it look like you are building around neighborhood traffic and longer dwell time.';
  }
  if (licenseType.includes('upgrade')) {
    return 'The upgrade angle makes this feel like a real beverage-program expansion, not a minor paperwork change.';
  }
  if (licenseType.includes('on sale liquor')) {
    return 'The licensing path points to a full-service beverage program rather than a light beer-and-wine setup.';
  }
  return '';
}

function buildValueLine(lead) {
  const licenseType = `${lead.license_type || ''} ${lead.application_summary || ''}`.toLowerCase();
  if (licenseType.includes('patio')) {
    return 'I help bars line up opening orders, patio-friendly SKU mixes, and supplier support without overbuying in month one.';
  }
  if (licenseType.includes('upgrade')) {
    return 'I help operators moving into fuller liquor programs tighten the opening mix, speed-to-menu decisions, and supplier plan.';
  }
  return 'I help new and expanding bars put together opening orders, supplier mixes, and feature plans that actually fit the concept and neighborhood.';
}

export function buildSuggestedFollowUp(lead) {
  const business = lead.business_name || lead.dba_name || lead.applicant_entity || 'your bar';
  const helloName = preferredContactName(lead) ? firstName(preferredContactName(lead)) : 'there';
  const locationLine = lead.address ? ` at ${lead.address}` : '';
  const recordLine = lead.license_type
    ? `I saw the public ${lead.source_city} record for ${business}${locationLine} tied to ${lead.license_type}.`
    : `I saw the public ${lead.source_city} licensing record for ${business}${locationLine}.`;
  const conceptLine = buildConceptLine(lead);
  const valueLine = buildValueLine(lead);
  const closeLine = 'If you are still locking in distribution, I can send a short opening-order recommendation and brand mix built around what you are opening.';

  return {
    subject: `${business}${lead.license_type ? ` | ${lead.license_type.slice(0, 42)}` : ''}`,
    body: [
      `Hi ${helloName},`,
      '',
      compactSentence([recordLine, conceptLine].filter(Boolean).join(' ')),
      '',
      valueLine,
      '',
      closeLine,
      '',
      'Best,',
      '[Your Name]'
    ].join('\n')
  };
}
