import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:5000' 
  : '';

const detectCountry = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes('Calcutta') || tz.includes('Kolkata') || tz.includes('Asia/Kolkata') || tz.includes('India')) return 'IN';
    if (tz.includes('London') || tz.includes('Europe/London')) return 'GB';
    if (tz.includes('New_York') || tz.includes('Chicago') || tz.includes('Denver') || tz.includes('Los_Angeles')) return 'US';
  } catch (e) {}
  return 'US'; // Default fallback
};

function App() {
  // Credentials & Config
  const [apifyToken, setApifyToken] = useState(() => localStorage.getItem('apifyToken') || '');
  const [actorId, setActorId] = useState('harvestapi/linkedin-profile-search');
  const [googleMethod, setGoogleMethod] = useState('apps-script'); // 'apps-script' | 'service-account'
  const [proxyCountry, setProxyCountry] = useState('NONE');
  
  // Scraper inputs
  const [scrapeMode, setScrapeMode] = useState('niche');
  const [nicheQuery, setNicheQuery] = useState('');
  const [maxItems, setMaxItems] = useState(10);
  const [takePages, setTakePages] = useState(1);
  const [startPage, setStartPage] = useState(1);
  const [scrapeEmails, setScrapeEmails] = useState(false);
  const [profileUrls, setProfileUrls] = useState('');
  const [linkedinCookies, setLinkedinCookies] = useState('');
  const [customJsonInput, setCustomJsonInput] = useState('');
  const [useCustomJson, setUseCustomJson] = useState(false);

  // Google Sheets credentials
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => localStorage.getItem('appsScriptUrl') || '');
  const [spreadsheetId, setSpreadsheetId] = useState(() => localStorage.getItem('spreadsheetId') || '');
  const [serviceAccountJson, setServiceAccountJson] = useState(() => localStorage.getItem('serviceAccountJson') || '');
  const [sheetName, setSheetName] = useState('Sheet1');

  // Apps Script snippet
  const [appsScriptSnippet, setAppsScriptSnippet] = useState('');
  const [copied, setCopied] = useState(false);

  // State of the execution
  const [runId, setRunId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [status, setStatus] = useState('IDLE'); // IDLE, RUNNING, SUCCEEDED, FAILED
  const [scrapedCount, setScrapedCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  
  // Parsed Leads Data
  const [parsedLeads, setParsedLeads] = useState(null);
  
  // UI states
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const logEndRef = useRef(null);

  // Save values to localStorage for convenience
  useEffect(() => {
    localStorage.setItem('apifyToken', apifyToken);
  }, [apifyToken]);

  useEffect(() => {
    localStorage.setItem('appsScriptUrl', appsScriptUrl);
  }, [appsScriptUrl]);

  useEffect(() => {
    localStorage.setItem('spreadsheetId', spreadsheetId);
  }, [spreadsheetId]);

  useEffect(() => {
    localStorage.setItem('serviceAccountJson', serviceAccountJson);
  }, [serviceAccountJson]);

  // Fetch the Apps Script snippet on load
  useEffect(() => {
    fetch(`${API_BASE}/api/apps-script-snippet`)
      .then(res => res.json())
      .then(data => {
        if (data.snippet) setAppsScriptSnippet(data.snippet);
      })
      .catch(err => console.error('Failed to load Apps Script snippet', err));
  }, []);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const addLog = (text, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, text, type }]);
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(appsScriptSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Build input for Apify Actor
  const getActorInput = () => {
    if (useCustomJson) {
      if (!customJsonInput.trim()) {
        throw new Error('Advanced Input Configuration JSON is empty.');
      }
      try {
        return JSON.parse(customJsonInput);
      } catch (e) {
        let errorMsg = `Invalid JSON in Advanced Input: ${e.message}`;
        if (customJsonInput.includes('linkedin.com') && !customJsonInput.trim().startsWith('{')) {
          errorMsg += ' (It looks like you pasted plain URLs. Please uncheck "Advanced Raw JSON" to input plain URLs, or format it as valid JSON e.g., { "urls": ["https://linkedin.com/..."] })';
        }
        throw new Error(errorMsg);
      }
    }

    let urls = [];
    
    if (scrapeMode === 'niche') {
      if (!nicheQuery.trim()) {
        throw new Error('Please enter niche search keywords (e.g. "Software Engineer Miami").');
      }
      // Generate LinkedIn standard search URL
      const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(nicheQuery.trim())}`;
      urls = [searchUrl];
    } else {
      urls = profileUrls
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0);

      if (urls.length === 0) {
        throw new Error('Please enter at least one LinkedIn Profile URL.');
      }
    }

    // Check if using harvestapi profile scraper which doesn't need cookies or proxy country
    if (actorId === 'harvestapi/linkedin-profile-scraper') {
      return {
        profileScraperMode: scrapeEmails 
          ? "Profile details + email search ($10 per 1k)" 
          : "Profile details no email ($4 per 1k)",
        queries: urls
      };
    }

    // Check if using harvestapi profile search which doesn't need cookies or proxy country
    if (actorId === 'harvestapi/linkedin-profile-search') {
      return {
        searchQuery: nicheQuery.trim(),
        profileScraperMode: scrapeEmails ? "Full + email search" : "Full",
        startPage: parseInt(startPage) || 1,
        takePages: parseInt(takePages) || 1,
        maxItems: parseInt(maxItems) || 10
      };
    }

    if (!linkedinCookies.trim()) {
      throw new Error('LinkedIn Session Cookies are required. Please paste your "li_at" cookie value.');
    }

    // Determine config keys based on actor type
    const isSearchActor = actorId.includes('search') || actorId.includes('people-search');
    
    const proxyObj = {
      useApifyProxy: true
    };
    if (proxyCountry && proxyCountry !== 'NONE') {
      proxyObj.apifyProxyCountry = proxyCountry;
    }

    const config = {
      userAgent: navigator.userAgent,
      proxy: proxyObj
    };

    if (isSearchActor) {
      config.searchUrls = urls;
    } else {
      config.urls = urls;
    }

    // Parse cookies as JSON if pasted as JSON, otherwise wrap the raw li_at value in the required array format
    let cookieParsed;
    try {
      cookieParsed = JSON.parse(linkedinCookies);
      if (!Array.isArray(cookieParsed)) {
        cookieParsed = [cookieParsed];
      }
    } catch (e) {
      const cookieValue = linkedinCookies.trim();
      cookieParsed = [
        {
          name: 'li_at',
          value: cookieValue,
          domain: '.linkedin.com',
          path: '/',
          hostOnly: false,
          httpOnly: true,
          secure: true,
          session: false
        }
      ];
    }
    config.cookie = cookieParsed;

    return config;
  };

  // Start Scraper
  const handleStartScrape = async () => {
    setExportResult(null);
    setParsedLeads(null);
    setLogs([]);
    setScrapedCount(0);
    setProgress(5);

    if (!apifyToken) {
      addLog('Error: Apify API token is required.', 'error');
      return;
    }

    let inputConfig;
    try {
      inputConfig = getActorInput();
    } catch (e) {
      addLog(`Error: ${e.message}`, 'error');
      return;
    }

    setStatus('RUNNING');
    addLog(`Initiating scraper Actor: "${actorId}"...`, 'info');

    try {
      const response = await fetch(`${API_BASE}/api/scrape/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apifyToken, actorId, inputConfig })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to start run');
      }

      setRunId(data.runId);
      setDatasetId(data.datasetId);
      addLog(`Scraper Actor started successfully. Run ID: ${data.runId}`, 'success');
      addLog(`Dataset ID: ${data.datasetId}. Polling for completion...`, 'info');
      
      // Start polling
      pollScraper(data.runId, data.datasetId);

    } catch (err) {
      setStatus('FAILED');
      setProgress(100);
      addLog(`Failed to start run: ${err.message}`, 'error');
    }
  };

  // Poll Apify
  const pollScraper = (currentRunId, currentDatasetId) => {
    let elapsedSeconds = 0;
    const interval = setInterval(async () => {
      elapsedSeconds += 4;
      try {
        const res = await fetch(`${API_BASE}/api/scrape/status/${currentRunId}?token=${apifyToken}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.details || 'Error checking status');
        }

        addLog(`Run Status: ${data.status} (Elapsed: ${elapsedSeconds}s)`, 'info');

        if (data.status === 'SUCCEEDED') {
          clearInterval(interval);
          setStatus('SUCCEEDED');
          setProgress(90);
          addLog('Scraper finished successfully! Retrieving dataset items...', 'success');
          fetchDataset(currentRunId, currentDatasetId);
        } else if (data.isFinished) {
          clearInterval(interval);
          setStatus('FAILED');
          setProgress(100);
          addLog(`Scraper run ended with non-success status: ${data.status}`, 'error');
        } else {
          // Increment mock progress to make the UI feel alive
          setProgress(prev => Math.min(85, prev + 3));
        }

      } catch (err) {
        clearInterval(interval);
        setStatus('FAILED');
        setProgress(100);
        addLog(`Polling error: ${err.message}`, 'error');
      }
    }, 4000);
  };

  // Fetch Dataset
  const fetchDataset = async (currentRunId, currentDatasetId) => {
    try {
      const res = await fetch(`${API_BASE}/api/scrape/dataset/${currentDatasetId}?token=${apifyToken}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.details || 'Failed to fetch dataset');
      }

      setParsedLeads({ headers: data.headers, rows: data.rows });
      setScrapedCount(data.rawCount);
      setProgress(100);
      addLog(`Successfully loaded and parsed ${data.rawCount} profiles. Ready to export!`, 'success');

      if (data.rawCount === 0) {
        addLog('Warning: 0 profiles scraped. Retrieving Apify run logs for diagnostics...', 'warn');
        try {
          const logRes = await fetch(`${API_BASE}/api/scrape/log/${currentRunId}?token=${apifyToken}`);
          if (logRes.ok) {
            const logText = await logRes.text();
            const logLines = logText.split('\n').filter(line => line.trim().length > 0);
            
            addLog('--- APIFY ACTOR DIAGNOSTIC LOGS (Last 25 lines) ---', 'info');
            logLines.slice(-25).forEach(line => {
              let type = 'info';
              const upper = line.toUpperCase();
              if (upper.includes('ERROR') || upper.includes('FAIL') || upper.includes('EXCEPTION')) {
                type = 'error';
              } else if (upper.includes('WARN')) {
                type = 'warn';
              } else if (upper.includes('SUCCESS') || upper.includes('DONE')) {
                type = 'success';
              }
              addLog(line, type);
            });
            addLog('--- END OF DIAGNOSTICS ---', 'info');
            addLog('Tip: Check if your cookies are valid and not expired, and make sure your LinkedIn account is not showing a security checkpoint verification wall.', 'warn');
          }
        } catch (logErr) {
          addLog(`Failed to load diagnostics: ${logErr.message}`, 'error');
        }
      }

    } catch (err) {
      setProgress(100);
      addLog(`Dataset retrieval error: ${err.message}`, 'error');
    }
  };

  // Load Mock Data for Testing
  const handleLoadMockData = () => {
    setExportResult(null);
    const mockHeaders = [
      'firstName', 'lastName', 'fullName', 'jobTitle', 'companyName', 
      'location', 'profileUrl', 'companyUrl', 'industry', 'companySize',
      'profileurl', 'fullname', 'firstname', 'lastname', 'companyname', 
      'title', 'companyid', 'companyurl', 'reguralcompany', 'summary', 
      'titlediscription', 'industry', 'companylocation', 'location', 
      'durationrole', 'durationcompany'
    ];
    
    const mockRows = [
      [
        'John', 'Doe', 'John Doe', 'Senior Software Engineer', 'Google',
        'San Francisco, CA', 'https://linkedin.com/in/johndoe', 'https://linkedin.com/company/google', 'Technology', '10,000+',
        'https://linkedin.com/in/johndoe', 'John Doe', 'John', 'Doe', 'Google',
        'Senior Software Engineer', 'google', 'https://linkedin.com/company/google', 'true', 'Experienced backend engineer specializing in cloud systems.',
        'Building scalable search APIs and indexing architecture.', 'Technology', 'Mountain View, CA', 'San Francisco, CA',
        '3 years 2 months', '5 years'
      ],
      [
        'Jane', 'Smith', 'Jane Smith', 'Product Manager', 'Stripe',
        'New York, NY', 'https://linkedin.com/in/janesmith', 'https://linkedin.com/company/stripe', 'Financial Services', '5001-10000',
        'https://linkedin.com/in/janesmith', 'Jane Smith', 'Jane', 'Smith', 'Stripe',
        'Product Manager', 'stripe', 'https://linkedin.com/company/stripe', 'true', 'Passionate about crafting simple APIs for complex financial tasks.',
        'Leading billing infrastructure expansion in European markets.', 'Financial Services', 'Dublin, Ireland', 'New York, NY',
        '1 year 6 months', '1 year 6 months'
      ]
    ];

    setParsedLeads({ headers: mockHeaders, rows: mockRows });
    setScrapedCount(2);
    setProgress(100);
    setStatus('SUCCEEDED');
    addLog('Loaded 2 mock leads for demo preview. You can test your Google Sheets setup using these leads!', 'success');
  };

  // Export to Google Sheets
  const handleExportToSheets = async () => {
    if (!parsedLeads) {
      addLog('No lead data available. Please scrape or load mock data first.', 'warn');
      return;
    }

    setIsExporting(true);
    setExportResult(null);
    addLog(`Exporting leads using Google ${googleMethod === 'apps-script' ? 'Apps Script URL' : 'Service Account'}...`, 'info');

    let config = {};
    if (googleMethod === 'apps-script') {
      if (!appsScriptUrl) {
        addLog('Error: Google Apps Script Web App URL is required.', 'error');
        setIsExporting(false);
        return;
      }
      config = { url: appsScriptUrl.trim() };
    } else {
      if (!spreadsheetId || !serviceAccountJson) {
        addLog('Error: Spreadsheet ID and Service Account JSON credentials are required.', 'error');
        setIsExporting(false);
        return;
      }
      config = {
        spreadsheetId: spreadsheetId.trim(),
        credentials: serviceAccountJson,
        sheetName: sheetName.trim()
      };
    }

    try {
      const response = await fetch(`${API_BASE}/api/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: googleMethod,
          config,
          data: parsedLeads
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to export');
      }

      addLog(`Successfully exported ${data.count} leads to Google Sheets!`, 'success');
      setExportResult({ success: true, message: `Successfully exported ${data.count} leads to Google Sheets!` });

    } catch (err) {
      addLog(`Export failed: ${err.message}`, 'error');
      setExportResult({ success: false, message: `Export failed: ${err.message}` });
    } finally {
      setIsExporting(false);
    }
  };

  // Download Leads as CSV File
  const handleDownloadCSV = () => {
    if (!parsedLeads) return;
    
    // Create CSV content by joining headers and rows
    const csvContent = [
      parsedLeads.headers.join(','),
      ...parsedLeads.rows.map(row => 
        row.map(val => {
          // Escape quotes and wrap in quotes to prevent breaking csv format
          const cleanVal = String(val || '').replace(/"/g, '""');
          return `"${cleanVal}"`;
        }).join(',')
      )
    ].join('\n');

    // Create file blob and trigger browser download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `linkedin_leads_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog('Successfully downloaded leads as CSV file.', 'success');
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <h1>LinkedIn Lead Center</h1>
        <p>Run high-performing LinkedIn profile scraping workflows on Apify and export data instantly to your Google Sheets.</p>
      </header>

      {/* Main Grid: Control Panels */}
      <div className="dashboard-grid">
        
        {/* Left Side: Setup API Credentials & Google Sheets */}
        <div className="glass-panel">
          <h2 className="section-title">
            <span>1</span> Configuration Setup
          </h2>
          
          <div className="form-group">
            <label>Apify API Token <span className="required">*</span></label>
            <input 
              type="password" 
              placeholder="Paste your Apify API Token (e.g. apify_api_...)" 
              value={apifyToken}
              onChange={(e) => setApifyToken(e.target.value)}
            />
          </div>

          {!actorId.startsWith('harvestapi/') && (
            <div className="form-group">
              <label>Proxy Location Country Code</label>
              <select 
                value={proxyCountry}
                onChange={(e) => setProxyCountry(e.target.value)}
              >
                <option value="NONE">Automatic / Platform Default (Free Plans)</option>
                <option value="IN">India (IN)</option>
                <option value="US">United States (US)</option>
                <option value="GB">United Kingdom (GB)</option>
                <option value="DE">Germany (DE)</option>
                <option value="FR">France (FR)</option>
                <option value="CA">Canada (CA)</option>
                <option value="AU">Australia (AU)</option>
              </select>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                We recommend selecting the country matching your physical LinkedIn login location to avoid 403 blocks.
              </span>
            </div>
          )}

          <div className="form-group">
            <label>Google Sheets Sync Method</label>
            <div className="tabs">
              <button 
                className={`tab ${googleMethod === 'apps-script' ? 'active' : ''}`}
                onClick={() => setGoogleMethod('apps-script')}
              >
                Apps Script (Easiest)
              </button>
              <button 
                className={`tab ${googleMethod === 'service-account' ? 'active' : ''}`}
                onClick={() => setGoogleMethod('service-account')}
              >
                Service Account
              </button>
            </div>
          </div>

          {/* Conditional Google Sheets Form Fields */}
          {googleMethod === 'apps-script' ? (
            <div>
              <div className="alert alert-info">
                <strong>How to connect:</strong> Open Google Sheets &rarr; <strong>Extensions &rarr; Apps Script</strong>. Paste our script snippet, click <strong>Deploy &rarr; New Deployment</strong> (as Web App, Access: Anyone), and paste the URL below.
              </div>
              <div className="form-group">
                <label>Apps Script Web App URL <span className="required">*</span></label>
                <input 
                  type="text" 
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={appsScriptUrl}
                  onChange={(e) => setAppsScriptUrl(e.target.value)}
                />
              </div>

              {appsScriptSnippet && (
                <div className="form-group">
                  <label>Copy Apps Script Code</label>
                  <div className="snippet-box">
                    <span className="copy-badge" onClick={copySnippet}>
                      {copied ? 'Copied!' : 'Copy Code'}
                    </span>
                    <pre><code>{appsScriptSnippet}</code></pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="alert alert-info">
                <strong>How to connect:</strong> Create a Google Cloud Project, enable the Sheets API, and create a Service Account. Share the Google Sheet with your Service Account email (with Editor permissions).
              </div>
              <div className="form-group">
                <label>Google Spreadsheet ID <span className="required">*</span></label>
                <input 
                  type="text" 
                  placeholder="e.g. 1a2b3c4d5e6f7g8h9i0j..."
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Sheet Name (Tab Name)</label>
                <input 
                  type="text" 
                  placeholder="Sheet1"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Service Account JSON Credentials File <span className="required">*</span></label>
                <textarea 
                  placeholder='Paste service_account.json contents here...'
                  value={serviceAccountJson}
                  onChange={(e) => setServiceAccountJson(e.target.value)}
                  style={{ height: '140px' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Scraper Parameters & Live Logs */}
        <div className="glass-panel">
          <h2 className="section-title">
            <span>2</span> Scraper Parameters
          </h2>

          <div className="form-group">
            <label>Apify Actor ID</label>
            <input 
              type="text" 
              placeholder="curious_coder/linkedin-scraper"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label style={{ margin: 0 }}>Input Format Configuration</label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', margin: 0, cursor: 'pointer', fontSize: '0.8rem' }}>
                <input 
                  type="checkbox" 
                  checked={useCustomJson} 
                  onChange={(e) => setUseCustomJson(e.target.checked)}
                  style={{ width: 'auto', margin: 0 }}
                />
                Advanced Raw JSON
              </label>
            </div>

            {!useCustomJson && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Scrape Targeting Mode</label>
                <div className="tabs">
                  <button 
                    type="button"
                    className={`tab ${scrapeMode === 'niche' ? 'active' : ''}`}
                    onClick={() => {
                      setScrapeMode('niche');
                      setActorId('harvestapi/linkedin-profile-search');
                    }}
                  >
                    Niche Search (Automated)
                  </button>
                  <button 
                    type="button"
                    className={`tab ${scrapeMode === 'profiles' ? 'active' : ''}`}
                    onClick={() => {
                      setScrapeMode('profiles');
                      setActorId('harvestapi/linkedin-profile-scraper');
                    }}
                  >
                    Paste Specific Profiles
                  </button>
                </div>
              </div>
            )}

            {useCustomJson ? (
              <textarea 
                placeholder='{ "urls": ["https://linkedin.com/in/..."], "cookie": "li_at=..." }'
                value={customJsonInput}
                onChange={(e) => setCustomJsonInput(e.target.value)}
                style={{ height: '172px', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
            ) : (
              <>
                {scrapeMode === 'niche' ? (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Niche Search Keywords <span className="required">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Software Engineer Miami or Real Estate Agent New York" 
                      value={nicheQuery}
                      onChange={(e) => setNicheQuery(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem 1rem', background: 'rgba(10, 15, 26, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff' }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                      The system will automatically generate the LinkedIn search query URL and scrape leads within this niche.
                    </span>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Start Page</label>
                        <input 
                          type="number" 
                          value={startPage}
                          onChange={(e) => setStartPage(e.target.value)}
                          style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'rgba(10, 15, 26, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Pages Depth</label>
                        <input 
                          type="number" 
                          value={takePages}
                          onChange={(e) => setTakePages(e.target.value)}
                          style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'rgba(10, 15, 26, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Max Profiles</label>
                        <input 
                          type="number" 
                          value={maxItems}
                          onChange={(e) => setMaxItems(e.target.value)}
                          style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'rgba(10, 15, 26, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff' }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Specific Profile URLs <span className="required">*</span></label>
                    <textarea 
                      placeholder="Enter LinkedIn Profile URLs (one URL per line)..."
                      value={profileUrls}
                      onChange={(e) => setProfileUrls(e.target.value)}
                      style={{ height: '100px', width: '100%', padding: '0.75rem 1rem', background: 'rgba(10, 15, 26, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', resize: 'vertical' }}
                    />
                  </div>
                )}
                
                {!actorId.startsWith('harvestapi/') && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>LinkedIn Cookies (e.g. li_at) <span className="required">*</span></label>
                    <input 
                      type="password" 
                      placeholder="Paste your 'li_at' cookie value or full cookies array..." 
                      value={linkedinCookies}
                      onChange={(e) => setLinkedinCookies(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem 1rem', background: 'rgba(10, 15, 26, 0.8)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff' }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                      Required for authentication. Get it from Chrome DevTools &rarr; Application &rarr; Cookies &rarr; 'li_at'.
                    </span>
                  </div>
                )}
              </>
            )}
            {actorId.startsWith('harvestapi/') && (
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input 
                  type="checkbox" 
                  id="scrapeEmails"
                  checked={scrapeEmails} 
                  onChange={(e) => setScrapeEmails(e.target.checked)}
                  style={{ width: 'auto', margin: 0, cursor: 'pointer' }}
                />
                <label htmlFor="scrapeEmails" style={{ margin: 0, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Scrape Email Addresses <span style={{ color: 'var(--color-warning)', fontSize: '0.75rem', marginLeft: '0.25rem' }}>(Uses more Apify credits)</span>
                </label>
              </div>
            )}
          </div>

          {/* Trigger Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.75rem' }}>
            <button 
              className="btn btn-secondary" 
              onClick={handleLoadMockData}
              disabled={status === 'RUNNING'}
              style={{ width: '40%' }}
            >
              Demo Mock Data
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleStartScrape}
              disabled={status === 'RUNNING'}
              style={{ width: '60%' }}
            >
              {status === 'RUNNING' ? (
                <>
                  <svg className="spinner" viewBox="0 0 50 50">
                    <circle className="path" cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
                  </svg>
                  Scraping...
                </>
              ) : 'Start Scraping'}
            </button>
          </div>
        </div>

      </div>

      {/* Logging & Progress Monitor */}
      {(logs.length > 0 || status === 'RUNNING') && (
        <div className="glass-panel" style={{ marginBottom: '2.5rem' }}>
          <h2 className="section-title">
            Execution Live Monitor
          </h2>
          
          <div className="progress-bar-wrapper">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
          </div>

          <div className="stats-row">
            <div className="stat-box">
              <div className="stat-val">{status}</div>
              <div className="stat-lbl">Status</div>
            </div>
            <div className="stat-box">
              <div className="stat-val">{scrapedCount}</div>
              <div className="stat-lbl">Leads Scraped</div>
            </div>
            <div className="stat-box">
              <div className="stat-val">{progress}%</div>
              <div className="stat-lbl">Progress</div>
            </div>
          </div>

          <div className="log-container">
            {logs.map((log, index) => (
              <div key={index} className={`log-entry ${log.type}`}>
                [{log.time}] {log.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Preview and Google Sheets Export Panel */}
      {parsedLeads && (
        <div className="glass-panel preview-panel">
          <div className="table-header-bar">
            <div>
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                Parsed Leads Preview <span className="badge">{scrapedCount} Mapped Rows</span>
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'left', marginTop: '0.2rem' }}>
                All leads are automatically formatted into the 26 required columns.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', minWidth: '350px' }}>
               <button 
                 className="btn btn-secondary" 
                 onClick={handleDownloadCSV}
                 style={{ whiteSpace: 'nowrap' }}
               >
                 Download CSV
               </button>
               <button 
                 className="btn btn-primary" 
                 onClick={handleExportToSheets}
                 disabled={isExporting}
                 style={{ whiteSpace: 'nowrap' }}
               >
                 {isExporting ? (
                   <>
                     <svg className="spinner" viewBox="0 0 50 50">
                       <circle className="path" cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
                     </svg>
                     Syncing...
                   </>
                 ) : 'Sync to Google Sheets'}
               </button>
             </div>
          </div>

          {/* Export Success/Error Feedback Alerts */}
          {exportResult && (
            <div className={`alert ${exportResult.success ? 'alert-success' : 'alert-error'}`}>
              <div>
                <strong>{exportResult.success ? 'Success!' : 'Sync Failed:'}</strong> {exportResult.message}
              </div>
            </div>
          )}

          {/* Preview Table */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  {parsedLeads.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedLeads.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((val, cellIdx) => (
                      <td key={cellIdx} title={String(val || '')}>
                        {String(val || '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        LinkedIn Lead Center &copy; 2026. Built with Antigravity for automated lead intelligence.
      </footer>
    </div>
  );
}

export default App;
