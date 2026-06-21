/**
 * Parses and maps Apify LinkedIn scraper output items to the requested columns.
 */
function parseLinkedInProfile(item) {
  if (!item) return {};

  // 1. Helper to find current position
  const positions = item.positionHistory || item.positions || item.experience || [];
  const currentPos = positions[0] || {};

  // 2. Helper to extract names
  let firstName = item.firstName || '';
  let lastName = item.lastName || '';
  let fullName = item.fullName || item.name || '';

  if (!fullName && (firstName || lastName)) {
    fullName = `${firstName} ${lastName}`.trim();
  } else if (fullName && (!firstName || !lastName)) {
    const parts = fullName.trim().split(/\s+/);
    if (!firstName && parts.length > 0) firstName = parts[0];
    if (!lastName && parts.length > 1) lastName = parts.slice(1).join(' ');
  }

  // 3. URLs
  let companyUrl = currentPos.companyUrl || currentPos.url || '';
  const profileUrl = item.url || item.profileUrl || item.linkedinUrl || '';

  // 4. Locations
  const personalLocation = item.location || item.locationName || '';
  const companyLocation = currentPos.location || currentPos.companyLocation || '';

  // 5. Industry
  const industry = item.industryName || item.industry || currentPos.industry || '';

  // 6. Summary / Description
  const summary = item.summary || item.about || item.aboutMe || '';
  const titleDescription = currentPos.description || currentPos.titleDescription || '';

  // 7. Company info
  const companyName = currentPos.companyName || currentPos.company || '';
  const jobTitle = currentPos.title || item.occupation || item.headline || '';
  const companySize = currentPos.companySize || currentPos.employeeCount || '';

  // Email extraction
  const email = item.email || (Array.isArray(item.emails) ? item.emails[0] : item.emails) || '';

  return {
    profileUrl: profileUrl,
    firstName: firstName,
    lastName: lastName,
    fullName: fullName,
    jobTitle: jobTitle,
    companyName: companyName,
    location: personalLocation,
    companyUrl: companyUrl,
    industry: industry,
    companySize: companySize,
    companylocation: companyLocation,
    summary: summary,
    titlediscription: titleDescription,
    email: email
  };
}

/**
 * Maps an array of scraped items to flat arrays ready for Google Sheet writing.
 * Returns both the headers (13 columns, plus email if present) and rows.
 */
function formatForGoogleSheets(items) {
  const headers = [
    'profileUrl',
    'firstName',
    'lastName',
    'fullName',
    'jobTitle',
    'companyName',
    'location',
    'companyUrl',
    'industry',
    'companySize',
    'companylocation',
    'summary',
    'titlediscription'
  ];

  // Check if any item has an email address scraped
  const hasEmail = items.some(item => {
    const email = item.email || (Array.isArray(item.emails) && item.emails.length > 0) || item.emails;
    return !!email;
  });
  
  if (hasEmail) {
    headers.push('email');
  }

  const parsedList = items.map(parseLinkedInProfile);

  const rows = parsedList.map(lead => {
    return headers.map(header => {
      return lead[header] || '';
    });
  });

  return { headers, rows };
}

module.exports = {
  parseLinkedInProfile,
  formatForGoogleSheets
};
