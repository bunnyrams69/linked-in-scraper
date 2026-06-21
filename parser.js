/**
 * Parses and maps Apify LinkedIn scraper output items to the exact 26 fields requested.
 */
function parseLinkedInProfile(item) {
  if (!item) return {};

  // 1. Helper to find current position
  // Scrapers return positions in different arrays: positionHistory, positions, or experience
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

  // 3. Helper to extract company ID from URL
  let companyUrl = currentPos.companyUrl || currentPos.url || '';
  let companyId = currentPos.companyId || '';
  if (!companyId && companyUrl) {
    // Attempt to extract from linkedin.com/company/ID or linkedin.com/company/name
    const match = companyUrl.match(/company\/([^\/]+)/);
    if (match && match[1]) {
      companyId = match[1];
    }
  }

  // 4. Personal & Company locations
  const personalLocation = item.location || item.locationName || '';
  const companyLocation = currentPos.location || currentPos.companyLocation || '';

  // 5. Industry
  const industry = item.industryName || item.industry || currentPos.industry || '';

  // 6. Summary / Description
  const summary = item.summary || item.about || item.aboutMe || '';
  const titleDescription = currentPos.description || currentPos.titleDescription || '';

  // 7. Durations
  let durationRole = currentPos.duration || currentPos.timeSpent || '';
  if (!durationRole && currentPos.startDate) {
    const start = currentPos.startDate;
    const end = currentPos.endDate || 'Present';
    durationRole = `${start} - ${end}`;
  }
  
  // Calculate company duration. Some scrapers group roles under a company.
  // If not explicitly provided, we fallback to current role duration.
  let durationCompany = currentPos.durationCompany || '';
  if (!durationCompany) {
    durationCompany = durationRole;
  }

  // Regular Company flag (sometimes returned as a boolean or type)
  const regularCompany = currentPos.regularCompany !== undefined ? String(currentPos.regularCompany) : '';

  // Current company name
  const companyName = currentPos.companyName || currentPos.company || '';

  // Current job title
  const jobTitle = currentPos.title || item.occupation || item.headline || '';

  // Profile URL
  const profileUrl = item.url || item.profileUrl || item.linkedinUrl || '';

  // Company size
  const companySize = currentPos.companySize || currentPos.employeeCount || '';

  // Email extraction
  const email = item.email || (Array.isArray(item.emails) ? item.emails[0] : item.emails) || '';

  // Return the mapped object containing all 27 requested fields
  return {
    firstName: firstName,
    lastName: lastName,
    fullName: fullName,
    jobTitle: jobTitle,
    companyName: companyName,
    location: personalLocation, // personal location
    profileUrl: profileUrl,
    companyUrl: companyUrl,
    industry: industry,
    companySize: companySize,
    profileurl: profileUrl,       // duplicate lowercase
    fullname: fullName,           // duplicate lowercase
    firstname: firstName,         // duplicate lowercase
    lastname: lastName,           // duplicate lowercase
    companyname: companyName,     // duplicate lowercase
    title: jobTitle,              // duplicate lowercase / alternative
    companyid: companyId,
    companyurl: companyUrl,       // duplicate lowercase
    reguralcompany: regularCompany, // custom spelling
    summary: summary,
    titlediscription: titleDescription, // custom spelling
    industry_dup: industry, // Note: the prompt lists 'industry' twice. We will populate both columns.
    companylocation: companyLocation,
    location_dup: personalLocation, // Note: the prompt lists 'location' twice. We will populate both.
    durationrole: durationRole,
    durationcompany: durationCompany,
    email: email
  };
}

/**
 * Maps an array of scraped items to flat arrays ready for Google Sheet writing.
 * Returns both the headers (27 columns) and rows.
 */
function formatForGoogleSheets(items) {
  const headers = [
    'firstName', 'lastName', 'fullName', 'jobTitle', 'companyName', 
    'location', 'profileUrl', 'companyUrl', 'industry', 'companySize',
    'profileurl', 'fullname', 'firstname', 'lastname', 'companyname', 
    'title', 'companyid', 'companyurl', 'reguralcompany', 'summary', 
    'titlediscription', 'industry', 'companylocation', 'location', 
    'durationrole', 'durationcompany', 'email'
  ];

  const parsedList = items.map(parseLinkedInProfile);

  const rows = parsedList.map(lead => {
    // Map each header to the exact parsed field (handling duplicates as specified in headers)
    return headers.map((header, idx) => {
      // Handle duplicates by indexing if needed, but since we parsed them with the exact names:
      if (header === 'industry') {
        // First occurrence is index 8, second is index 21
        return lead.industry;
      }
      if (header === 'location') {
        // First occurrence is index 5, second is index 23
        return lead.location;
      }
      return lead[header] || '';
    });
  });

  return { headers, rows };
}

module.exports = {
  parseLinkedInProfile,
  formatForGoogleSheets
};
