'use strict';

const { JWT } = require('google-auth-library');
const { normalizeTransaction } = require('./finance');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let authClient;

function credentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!email || !key || !sheetId) throw configurationError('Credenciais do Google Sheets nao configuradas.');
  if (!email.endsWith('.iam.gserviceaccount.com')) {
    throw configurationError('GOOGLE_SERVICE_ACCOUNT_EMAIL nao e um e-mail de Service Account valido.');
  }
  if (!key.startsWith('-----BEGIN PRIVATE KEY-----') || !key.endsWith('-----END PRIVATE KEY-----')) {
    throw configurationError('GOOGLE_PRIVATE_KEY nao contem uma chave privada PEM valida.');
  }
  return { email, key, sheetId };
}

function configurationError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

async function accessToken() {
  const { email, key } = credentials();
  authClient ||= new JWT({ email, key, scopes: [SHEETS_SCOPE] });
  const token = await authClient.getAccessToken();
  return token.token;
}

async function sheetsRequest(path, options = {}) {
  const { sheetId } = credentials();
  const token = await accessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Google Sheets:', detail);
    throw new Error('Falha ao acessar a planilha financeira.');
  }
  return response.status === 204 ? null : response.json();
}

async function getRange(range) {
  return sheetsRequest(`/values/${encodeURIComponent(range)}`).then((data) => data.values || []);
}

async function listTransactions(month) {
  const transactions = await listAllTransactions();
  return transactions.filter((item) => item.mesRef === month);
}

async function listAllTransactions() {
  const rows = await getRange('Lancamentos!A2:O');
  return rows.map(normalizeTransaction).filter((item) => item.id);
}

async function getConfiguration() {
  const rows = await getRange('Configuracoes!A2:E');
  const categorias = [...new Set(rows.map((row) => String(row[0] || '').trim()).filter(Boolean))];
  const responsaveis = [...new Set(rows.map((row) => String(row[1] || '').trim()).filter(Boolean))];
  const caixinhas = rows
    .filter((row) => row[2])
    .map((row) => ({ nome: String(row[2]).trim(), meta: Number(row[3]) || 0, favorito: String(row[4]).trim().toLowerCase() === 'true' }));
  return { categorias, responsaveis, caixinhas };
}

async function findRow(id) {
  const rows = await getRange('Lancamentos!A2:A');
  const index = rows.findIndex((row) => row[0] === id);
  return index < 0 ? null : index + 2;
}

async function appendTransaction(row) {
  return sheetsRequest(`/values/${encodeURIComponent('Lancamentos!A:O')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] })
  });
}

async function updateTransaction(rowNumber, row) {
  return sheetsRequest(`/values/${encodeURIComponent(`Lancamentos!A${rowNumber}:O${rowNumber}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] })
  });
}

async function deleteTransaction(rowNumber) {
  const metadata = await sheetsRequest('?fields=sheets.properties');
  const sheet = metadata.sheets.find((entry) => entry.properties.title === 'Lancamentos');
  if (!sheet) throw new Error('A aba Lancamentos nao existe.');
  return sheetsRequest(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber }
        }
      }]
    })
  });
}

module.exports = { listTransactions, listAllTransactions, getConfiguration, findRow, appendTransaction, updateTransaction, deleteTransaction };
