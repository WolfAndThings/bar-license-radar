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

  if (lead.opening_stage_label === 'Opening soon') {
    return 'The record still looks like an active opening window, which is usually the best time to get supplier options in front of the operator.';
  }
  if (lead.opening_stage_label === 'Ownership change') {
    return 'The ownership-change angle makes this feel more like a real reset point than routine paperwork.';
  }
  if (lead.property_radar_property_pressure_label === 'High') {
    return 'The owner/property read suggests pressure on the account, which can make fresh support and new energy more relevant.';
  }
  if (lead.account_type_label) {
    return `It reads like a ${lead.account_type_label.toLowerCase()} account, which helps frame the opening mix and support plan.`;
  }

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
  if (lead.ownership_change_signal_label === 'Strong') {
    return 'I help operators in changeover moments tighten the first supplier mix, opening orders, and feature plan without adding noise to the transition.';
  }
  if (lead.underserved_program_label === 'High') {
    return 'I help bars sharpen the drink program, refresh the supplier mix, and build a lineup that gives the account more energy without overcomplicating it.';
  }
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
  const closeLine =
    lead.opening_stage_label === 'Opening soon' || lead.opening_stage_label === 'Just opened'
      ? 'If you are still locking in distribution, I can send a short opening-order recommendation and brand mix built around what you are opening.'
      : 'If you are open to a fresh look at the current mix, I can send a short recommendation on where a supplier reset could add energy without disrupting the program.';

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
