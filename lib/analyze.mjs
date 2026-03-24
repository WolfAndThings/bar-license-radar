function compactSentence(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

function preferredContactName(lead) {
  return lead.contact_name || lead.enriched_contact_name || '';
}

function hasDirectContact(lead) {
  return Boolean(lead.contact_email || lead.contact_phone || lead.enriched_contact_email || lead.enriched_contact_phone);
}

function hasEnrichedContact(lead) {
  return Boolean(
    lead.enriched_contact_name || lead.enriched_contact_role || lead.enriched_contact_email || lead.enriched_contact_phone
  );
}

function hasDistributorSignal(lead) {
  return ['exact', 'brand_inferred'].includes(lead.distributor_signal_type);
}

function hasMenuChangeSignal(lead) {
  return ['stable', 'moderate_change', 'major_change'].includes(lead.menu_change_signal);
}

function titleText(lead) {
  return compactSentence([lead.official_title, lead.license_type, lead.official_summary].filter(Boolean).join(' '));
}

function hasFutureHearing(lead) {
  const hearingDate = new Date(lead.hearing_date || '');
  if (Number.isNaN(hearingDate.getTime())) return false;
  return hearingDate.getTime() >= Date.now() - 24 * 60 * 60 * 1000;
}

function isRecentRecord(lead, days = 21) {
  const dateText = lead.hearing_date || lead.first_public_record_date || '';
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function isLikelyExistingVenue(text = '') {
  return /\b(existing|upgrade|amend|adding|added|extension|extended hours|gambling|patio|outdoor service area)\b/i.test(text);
}

function isLiquorOpeningSignal(text = '') {
  return /\b(on sale liquor|liquor on sale|wine on sale|malt on sale|strong beer|taproom|cocktail room|brewery|distillery)\b/i.test(
    text
  );
}

function isOwnershipSignal(text = '') {
  return /\b(change of ownership|ownership transfer|transfer|new owner|new operator|new d\/b\/a|doing business as)\b/i.test(text);
}

function isGenericMinneapolisCode(text = '') {
  return /\bBL(?:Amend|General)\b/.test(text) && !isLiquorOpeningSignal(text);
}

function describeHearingPurpose(lead, text) {
  const business = lead.business_name || 'this business';

  if (/adding a gambling location/i.test(text) && /upgrade to full liquor on sale/i.test(text)) {
    return `The hearing is for ${business} to add gambling and upgrade an existing beer-or-wine style program into full liquor on-sale and Sunday sales.`;
  }

  if (/extended hours/i.test(text)) {
    return `The hearing is for ${business} to extend its hours of operation, not to open a brand-new bar.`;
  }

  if (/entertainment upgrade/i.test(text)) {
    return `The hearing is for ${business} to upgrade its entertainment permissions; this is not a clear new-liquor-opening signal by itself.`;
  }

  if (/change of ownership|ownership transfer|transfer/i.test(text)) {
    return `The hearing appears to be for an ownership or license transfer involving ${business}.`;
  }

  if (/\bBLAmend\b/.test(text)) {
    return `The hearing page labels ${business} as BLAmend, which reads like a license amendment. The public row does not clearly show a brand-new opening.`;
  }

  if (/\bBLGeneral\b/.test(text)) {
    return `The hearing page labels ${business} as BLGeneral, which is a generic business-license code. The public row does not clearly explain the exact liquor action.`;
  }

  if (/liquor on sale|on sale liquor|wine on sale|malt on sale|strong beer/i.test(text)) {
    return `The hearing appears to be for a liquor-license action tied to ${business}, likely involving on-sale alcohol service.`;
  }

  return `The hearing is tied to a public licensing action involving ${business}, but the public record does not explain the purpose very clearly.`;
}

export function analyzeLead(lead) {
  const text = titleText(lead);
  const reasons = [];
  const salesReasons = [];
  const hearingPurposeSummary = describeHearingPurpose(lead, text);
  let score = 50;

  if (lead.source_city === 'Minneapolis') {
    reasons.push(
      `Included because the Minneapolis Public Hearings report listed ${lead.business_name || 'this business'} on ${lead.hearing_date || 'the hearing date'}${lead.license_id ? ` under ${lead.license_id}` : ''}.`
    );
    if (lead.license_type) {
      reasons.push(`The Minneapolis row matched the current filter because it contained the code ${lead.license_type}.`);
    }
  }

  if (lead.source_city === 'St. Paul') {
    reasons.push(
      `Included because the St. Paul License Hearing calendar had a License Application Summary record for ${lead.business_name || 'this business'}.`
    );
    if (lead.contact_name || lead.contact_phone) {
      reasons.push(
        `The official St. Paul record exposed a named contact${lead.contact_name ? ` (${lead.contact_name})` : ''}${lead.contact_phone ? ` and phone (${lead.contact_phone})` : ''}.`
      );
    }
  }

  if (hasEnrichedContact(lead)) {
    const enrichedBits = [
      lead.enriched_contact_name ? `name (${lead.enriched_contact_name})` : '',
      lead.enriched_contact_role ? `role (${lead.enriched_contact_role})` : '',
      lead.enriched_contact_email ? `email (${lead.enriched_contact_email})` : '',
      lead.enriched_contact_phone ? `phone (${lead.enriched_contact_phone})` : ''
    ].filter(Boolean);
    if (enrichedBits.length) reasons.push(`Enrichment also found ${enrichedBits.join(', ')}.`);
  }

  if (hasDistributorSignal(lead)) {
    reasons.push(lead.distributor_summary);
  }

  if (hasMenuChangeSignal(lead)) {
    reasons.push(lead.menu_change_summary);
  }

  if (hasFutureHearing(lead)) {
    score += 15;
    salesReasons.push('The hearing date is current or upcoming, so the timing is actionable.');
  } else if (isRecentRecord(lead, 30)) {
    score += 4;
    salesReasons.push('The public record is still recent enough to be worth checking.');
  } else {
    score -= 12;
    salesReasons.push('The public record is already aging, so the window may be weaker.');
  }

  if (preferredContactName(lead)) {
    score += 10;
    salesReasons.push(
      lead.contact_name ? 'A named person is attached to the official record.' : 'Enrichment found a likely named contact.'
    );
  }

  if (hasDirectContact(lead)) {
    score += 8;
    salesReasons.push(
      lead.contact_email || lead.contact_phone
        ? 'There is direct public contact information available.'
        : 'Enrichment found a likely direct contact channel.'
    );
  } else {
    score -= 6;
    salesReasons.push('There is no public or enriched direct contact on the lead yet.');
  }

  if (isLiquorOpeningSignal(text)) {
    score += 14;
    salesReasons.push('The record reads like a real liquor-program or on-sale signal.');
  }

  if (isOwnershipSignal(text)) {
    score += 12;
    salesReasons.push('Ownership or operator-change language usually maps better to a real distributor opportunity.');
  }

  if (isLikelyExistingVenue(text)) {
    score -= 22;
    salesReasons.push('The record looks more like an existing venue amendment or upgrade than a brand-new opening.');
  }

  if (isGenericMinneapolisCode(text)) {
    score -= 22;
    salesReasons.push('The Minneapolis code is generic and does not by itself prove a new liquor opening.');
  }

  if (lead.website_url) {
    score += 5;
    salesReasons.push('There is at least one public website signal to follow up from.');
  }

  if (lead.distributor_signal_type === 'exact') {
    score += 9;
    salesReasons.push('A direct public distributor signal is attached to the lead.');
  } else if (lead.distributor_signal_type === 'brand_inferred') {
    score += 4;
    salesReasons.push('There is a brand-based distributor inference, but it is not account-level proof.');
  }

  if (lead.menu_change_signal === 'major_change') {
    score += 5;
    salesReasons.push('The menu appears to have changed materially in the last 6 months, which can signal active beverage-program movement.');
  } else if (lead.menu_change_signal === 'moderate_change') {
    score += 2;
    salesReasons.push('The menu appears to have changed in the last 6 months, which may indicate beverage-program movement.');
  }

  score = Math.max(0, Math.min(100, score));

  let label = 'Medium';
  if (score >= 70) label = 'High';
  if (score <= 39) label = 'Low';

  let fit = 'Mixed';
  if (isGenericMinneapolisCode(text)) fit = 'Weak signal / generic code';
  else if (isOwnershipSignal(text)) fit = 'Ownership / operator change';
  else if (isLikelyExistingVenue(text)) fit = 'Existing venue / amendment';
  else if (hasFutureHearing(lead) && isLiquorOpeningSignal(text)) fit = 'New / timely';

  return {
    hearing_purpose_summary: hearingPurposeSummary,
    inclusion_summary: compactSentence(reasons.join(' ')),
    inclusion_reasons: reasons,
    sales_likelihood_score: score,
    sales_likelihood_label: label,
    sales_fit: fit,
    sales_likelihood_summary: compactSentence(salesReasons.join(' ')),
    sales_likelihood_reasons: salesReasons
  };
}
