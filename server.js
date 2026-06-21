const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { APPS_SCRIPT_SNIPPET, exportToAppsScript, exportToServiceAccount } = require('./googleSheets');
const { formatForGoogleSheets } = require('./parser');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large payloads for export

// Serve React static files in production
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// 1. Get Google Apps Script code snippet
app.get('/api/apps-script-snippet', (req, res) => {
  res.json({ snippet: APPS_SCRIPT_SNIPPET });
});

// 2. Start Apify Scrape Run
app.post('/api/scrape/start', async (req, res) => {
  const { apifyToken, actorId, inputConfig } = req.body;

  if (!apifyToken || !actorId) {
    return res.status(400).json({ error: 'Missing apifyToken or actorId' });
  }

  try {
    // Format actorId (e.g. replacing slash if encoded)
    const formattedActorId = encodeURIComponent(actorId.trim());
    
    // Call Apify API to start the actor run
    const url = `https://api.apify.com/v2/actors/${formattedActorId}/runs?token=${apifyToken}`;
    
    const response = await axios.post(url, inputConfig || {}, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const runInfo = response.data.data;
    
    res.json({
      success: true,
      runId: runInfo.id,
      datasetId: runInfo.defaultDatasetId,
      status: runInfo.status,
      startedAt: runInfo.startedAt
    });
  } catch (error) {
    console.error('Error starting Apify actor:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to start Apify actor',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 3. Get Apify Scrape Status
app.get('/api/scrape/status/:runId', async (req, res) => {
  const { runId } = req.params;
  const { token } = req.query;

  if (!runId || !token) {
    return res.status(400).json({ error: 'Missing runId or token' });
  }

  try {
    const url = `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`;
    const response = await axios.get(url);
    const runInfo = response.data.data;

    res.json({
      success: true,
      status: runInfo.status,
      isFinished: ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(runInfo.status),
      startedAt: runInfo.startedAt,
      finishedAt: runInfo.finishedAt,
      durationMillis: runInfo.durationMillis,
      datasetId: runInfo.defaultDatasetId
    });
  } catch (error) {
    console.error('Error fetching run status:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to check run status',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 3.1 Get Apify Run Logs for diagnostics
app.get('/api/scrape/log/:runId', async (req, res) => {
  const { runId } = req.params;
  const { token } = req.query;

  if (!runId || !token) {
    return res.status(400).json({ error: 'Missing runId or token' });
  }

  try {
    const url = `https://api.apify.com/v2/actor-runs/${runId}/log?token=${token}`;
    const response = await axios.get(url, { responseType: 'text' });
    res.send(response.data);
  } catch (error) {
    console.error('Error fetching run logs:', error.message);
    res.status(500).json({
      error: 'Failed to check run logs',
      details: error.message
    });
  }
});

// 4. Fetch Dataset Items and Parse Leads
app.get('/api/scrape/dataset/:datasetId', async (req, res) => {
  const { datasetId } = req.params;
  const { token } = req.query;

  if (!datasetId || !token) {
    return res.status(400).json({ error: 'Missing datasetId or token' });
  }

  try {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;
    const response = await axios.get(url);
    const rawItems = response.data;

    if (!Array.isArray(rawItems)) {
      return res.status(500).json({ error: 'Dataset items are not in list format' });
    }

    // Parse items into the 26 columns
    const { headers, rows } = formatForGoogleSheets(rawItems);

    res.json({
      success: true,
      rawCount: rawItems.length,
      headers,
      rows
    });
  } catch (error) {
    console.error('Error fetching dataset items:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to retrieve dataset items',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 5. Export formatted leads to Google Sheet
app.post('/api/export', async (req, res) => {
  const { method, config, data } = req.body;

  if (!method || !data || !data.headers || !data.rows) {
    return res.status(400).json({ error: 'Missing method, config or lead data' });
  }

  try {
    if (method === 'apps-script') {
      const { url, spreadsheetId, sheetName } = config;
      if (!url) {
        return res.status(400).json({ error: 'Missing Apps Script Web App URL' });
      }

      const result = await exportToAppsScript(url, {
        headers: data.headers,
        rows: data.rows,
        spreadsheetId,
        sheetName
      });
      return res.json({ success: true, count: result.count });

    } else if (method === 'service-account') {
      const { credentials, spreadsheetId, sheetName } = config;
      if (!credentials || !spreadsheetId) {
        return res.status(400).json({ error: 'Missing credentials JSON or Spreadsheet ID' });
      }

      let parsedCreds;
      try {
        parsedCreds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid service account credentials JSON string' });
      }

      const result = await exportToServiceAccount(parsedCreds, spreadsheetId, sheetName, data);
      return res.json({ success: true, count: result.count, range: result.updatedRange });
    } else {
      return res.status(400).json({ error: 'Unsupported export method' });
    }
  } catch (error) {
    console.error('Error exporting leads:', error.message);
    res.status(500).json({
      error: 'Google Sheet Export Failed',
      details: error.message
    });
  }
});

// For any other requests, serve React build in production
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
