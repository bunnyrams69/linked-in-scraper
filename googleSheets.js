const { google } = require('googleapis');
const axios = require('axios');

/**
 * Apps Script deployment snippet that we share with the user.
 */
const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = data.spreadsheetId ? SpreadsheetApp.openById(data.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    
    // Check if the user is requesting a list of sheets/tabs
    if (data.action === "getSheets") {
      var sheets = ss.getSheets();
      var names = [];
      for (var i = 0; i < sheets.length; i++) {
        names.push(sheets[i].getName());
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success", sheets: names }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = data.sheetName ? ss.getSheetByName(data.sheetName) : ss.getActiveSheet();
    
    if (!sheet && data.sheetName) {
      sheet = ss.insertSheet(data.sheetName);
    }
    
    // Write headers if the sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(data.headers);
    }
    
    // Append all rows in a batch
    if (data.rows && data.rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, data.rows.length, data.headers.length).setValues(data.rows);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", count: data.rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

/**
 * Exports data to Google Sheets using a Google Apps Script Web App URL.
 */
async function exportToAppsScript(url, { headers, rows, spreadsheetId, sheetName }) {
  try {
    const response = await axios.post(url, { headers, rows, spreadsheetId, sheetName }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.status === 'success') {
      return { success: true, count: response.data.count };
    } else {
      throw new Error(response.data?.message || 'Apps Script returned an error status.');
    }
  } catch (error) {
    throw new Error(`Failed exporting via Apps Script: ${error.message}`);
  }
}

/**
 * Lists sheet tabs (sub-sheets) from an Apps Script Web App.
 */
async function listAppsScriptSheets(url, spreadsheetId) {
  try {
    const response = await axios.post(url, { action: 'getSheets', spreadsheetId }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.status === 'success') {
      return response.data.sheets || [];
    } else {
      throw new Error(response.data?.message || 'Apps Script failed to list sheets.');
    }
  } catch (error) {
    throw new Error(`Failed listing sheets via Apps Script: ${error.message}`);
  }
}

/**
 * Lists all spreadsheets accessible by the Service Account.
 */
async function listSpreadsheets(credentials) {
  try {
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly'
      ]
    );

    const drive = google.drive({ version: 'v3', auth });
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id, name)',
      pageSize: 100,
      orderBy: 'name'
    });

    return response.data.files || [];
  } catch (error) {
    throw new Error(`Failed to list spreadsheets via Drive API: ${error.message}`);
  }
}

/**
 * Lists all sheet tabs (sub-sheets) within a specific spreadsheet using Service Account.
 */
async function listSpreadsheetSheets(credentials, spreadsheetId) {
  try {
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.get({
      spreadsheetId
    });

    if (response.data && response.data.sheets) {
      return response.data.sheets.map(s => s.properties.title);
    }
    return [];
  } catch (error) {
    throw new Error(`Failed to retrieve sheets from spreadsheet: ${error.message}`);
  }
}

/**
 * Exports data to Google Sheets using a Google Cloud Service Account.
 */
async function exportToServiceAccount(credentials, spreadsheetId, sheetName, { headers, rows }) {
  try {
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });

    // Verify if the sheet tab exists, and if not, create it
    if (sheetName) {
      try {
        const ssMeta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetExists = ssMeta.data.sheets.some(s => s.properties.title === sheetName);
        if (!sheetExists) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: sheetName
                    }
                  }
                }
              ]
            }
          });
        }
      } catch (e) {
        throw new Error(`Failed to check or create sheet tab "${sheetName}": ${e.message}`);
      }
    }

    const rangeName = sheetName ? `${sheetName}!A1` : 'A1';

    // Check if sheet has headers
    let hasHeaders = false;
    try {
      const checkRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName ? `${sheetName}!A1:Z1` : 'A1:Z1',
      });
      hasHeaders = !!(checkRes.data.values && checkRes.data.values.length > 0);
    } catch (e) {
      // Range check failed or sheet was just created empty
    }

    const payload = [];
    if (!hasHeaders) {
      payload.push(headers);
    }
    payload.push(...rows);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: rangeName,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: payload
      }
    });

    return { success: true, count: rows.length, updatedRange: response.data.updates?.updatedRange };
  } catch (error) {
    throw new Error(`Failed exporting via Service Account: ${error.message}`);
  }
}

module.exports = {
  APPS_SCRIPT_SNIPPET,
  exportToAppsScript,
  exportToServiceAccount,
  listSpreadsheets,
  listSpreadsheetSheets,
  listAppsScriptSheets
};

