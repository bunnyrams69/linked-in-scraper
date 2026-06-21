const { google } = require('googleapis');
const axios = require('axios');

/**
 * Apps Script deployment snippet that we share with the user.
 */
const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
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
async function exportToAppsScript(url, { headers, rows }) {
  try {
    const response = await axios.post(url, { headers, rows }, {
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
      // If the sheet doesn't exist, we'll try to let sheets API create it or write it
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
  exportToServiceAccount
};
