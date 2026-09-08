'use strict';

const { JWT } = require('google-auth-library');
const { normalizeTransaction, parseMoney, billSituation, currentMonth, defaultCardResponsible } = require('./finance');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let authClient;
let pluggyStoragePromise;

const PLUGGY_SHEETS = {
  PluggyItens: ['ID', 'Instituicao', 'Imagem', 'Status', 'UltimaSincronizacao', 'Erro', 'AtualizadoEm'],
  PluggyContas: ['ID', 'ItemID', 'Tipo', 'Subtipo', 'Nome', 'Numero', 'Saldo', 'Moeda', 'LimiteTotal', 'LimiteDisponivel', 'LimiteUsado', 'Bandeira', 'Fechamento', 'Vencimento', 'Status', 'AtualizadoEm', 'Responsavel'],
  PluggyTransacoes: ['ID', 'ItemID', 'ContaID', 'Conta', 'Descricao', 'Valor', 'Data', 'Status', 'Tipo', 'Categoria', 'Ordem', 'Parcela', 'TotalParcelas', 'Operacao', 'AtualizadoEm'],
  PluggyFaturas: ['ID', 'ItemID', 'ContaID', 'Conta', 'Vencimento', 'Fechamento', 'Valor', 'Pagamentos', 'StatusProvedor', 'StatusLocal', 'Estimada', 'AtualizadoEm', 'ValorLocal', 'FontePagamento'],
  PluggyEventos: ['ID', 'Evento', 'RecebidoEm', 'Status'],
  OrcamentosMensais: ['Mes', 'Media90', 'Teto', 'HistoricoJSON', 'CriadoEm', 'Versao'],
  MentorInsights: ['ID', 'Cenario', 'Mes', 'Mensagem', 'Percepcao', 'Provocacao', 'ContextoHash', 'AtualizadoEm']
};

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

async function ensurePluggyStorage() {
  if (pluggyStoragePromise) return pluggyStoragePromise;
  pluggyStoragePromise = (async () => {
    const metadata = await sheetsRequest('?fields=sheets.properties');
    const existing = new Set(metadata.sheets.map((entry) => entry.properties.title));
    const missing = Object.keys(PLUGGY_SHEETS).filter((name) => !existing.has(name));
    if (missing.length) {
      try {
        await sheetsRequest(':batchUpdate', {
          method: 'POST',
          body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) })
        });
      } catch (error) {
        const refreshed = await sheetsRequest('?fields=sheets.properties');
        const titles = new Set(refreshed.sheets.map((entry) => entry.properties.title));
        if (missing.some((name) => !titles.has(name))) throw error;
      }
    }
    await sheetsRequest('/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: Object.entries(PLUGGY_SHEETS).map(([name, headers]) => ({ range: `${name}!A1:${columnName(headers.length)}1`, values: [headers] }))
      })
    });
  })().catch((error) => {
    pluggyStoragePromise = null;
    throw error;
  });
  return pluggyStoragePromise;
}

function columnName(number) {
  let result = '';
  while (number > 0) {
    number--;
    result = String.fromCharCode(65 + number % 26) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

async function upsertRows(sheet, rows) {
  await ensurePluggyStorage();
  if (!rows.length) return;
  const existing = await getRange(`${sheet}!A2:A`);
  const positions = new Map(existing.map((row, index) => [String(row[0] || ''), index + 2]));
  const updates = [];
  const inserts = [];
  for (const row of rows) {
    const rowNumber = positions.get(String(row[0]));
    if (rowNumber) updates.push({ range: `${sheet}!A${rowNumber}:${columnName(row.length)}${rowNumber}`, values: [row] });
    else inserts.push(row);
  }
  if (updates.length) {
    await sheetsRequest('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
  }
  if (inserts.length) {
    await sheetsRequest(`/values/${encodeURIComponent(`${sheet}!A:${columnName(inserts[0].length)}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: inserts })
    });
  }
}

async function savePluggyItem(item) {
  const error = item.error?.message || item.error?.code || '';
  await upsertRows('PluggyItens', [[item.id, item.connector?.name || 'Instituicao conectada', item.connector?.imageUrl || '', item.status || '', item.lastUpdatedAt || '', error, new Date().toISOString()]]);
}

async function listPluggyItems() {
  await ensurePluggyStorage();
  return (await getRange('PluggyItens!A2:G')).filter((row) => row[0]).map((row) => ({
    id: String(row[0]), institution: String(row[1] || ''), imageUrl: String(row[2] || ''), status: String(row[3] || ''), lastUpdatedAt: String(row[4] || ''), error: String(row[5] || '')
  }));
}

async function savePluggyAccounts(accounts) {
  const rows = accounts.map((account) => [
    account.id, account.itemId, account.type, account.subtype, account.name || account.marketingName || '', account.number || '', Number(account.balance) || 0,
    account.currencyCode || 'BRL', Number(account.creditData?.creditLimit) || 0, Number(account.creditData?.availableCreditLimit) || 0,
    usedCreditLimit(account), account.creditData?.brand || '', account.creditData?.balanceCloseDate || '', account.creditData?.balanceDueDate || '',
    account.creditData?.status || '', account.updatedAt || ''
  ]);
  await upsertRows('PluggyContas', rows);
}

function usedCreditLimit(account) {
  const limits = account.creditData?.disaggregatedCreditLimits || [];
  const consolidated = limits.find((limit) => limit.creditLineLimitType === 'LIMITE_CREDITO_TOTAL' && limit.consolidationType === 'CONSOLIDATED');
  if (Number.isFinite(Number(consolidated?.usedAmount))) return Math.max(0, Number(consolidated.usedAmount));
  const total = Number(account.creditData?.creditLimit);
  const available = Number(account.creditData?.availableCreditLimit);
  if (Number.isFinite(total) && Number.isFinite(available)) return Math.max(0, total - available);
  return Math.max(0, Number(account.balance) || 0);
}

async function listPluggyAccounts() {
  await ensurePluggyStorage();
  const accounts = (await getRange('PluggyContas!A2:Q')).filter((row) => row[0]).map((row) => ({
    id: String(row[0]), itemId: String(row[1]), type: String(row[2]), subtype: String(row[3]), name: String(row[4] || ''), number: String(row[5] || ''),
    balance: parseMoney(row[6]), currencyCode: String(row[7] || 'BRL'), creditLimit: parseMoney(row[8]), availableLimit: parseMoney(row[9]),
    usedLimit: parseMoney(row[10]), brand: String(row[11] || ''), closeDate: String(row[12] || ''), dueDate: String(row[13] || ''), status: String(row[14] || ''), updatedAt: String(row[15] || ''),
    responsavel: String(row[16] || defaultCardResponsible(row[4]))
  }));
  return [...new Map(accounts.map((account) => [account.id, account])).values()];
}

async function updatePluggyAccountResponsible(id, responsible) {
  await ensurePluggyStorage();
  if (!['Ele', 'Ela', 'Nós'].includes(responsible)) {
    const error = new Error('Responsavel invalido.');
    error.statusCode = 400;
    throw error;
  }
  const rows = await getRange('PluggyContas!A2:A');
  const index = rows.findIndex((row) => String(row[0]) === String(id));
  if (index < 0) {
    const error = new Error('Cartao nao encontrado.');
    error.statusCode = 404;
    throw error;
  }
  await sheetsRequest(`/values/${encodeURIComponent(`PluggyContas!Q${index + 2}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[responsible]] })
  });
}

async function savePluggyTransactions(transactions) {
  await upsertRows('PluggyTransacoes', transactions.map((item) => [
    item.id, item.itemId, item.accountId, item.accountName, item.descricao, item.valor, item.data, item.status, item.tipo, item.categoria,
    item.ordem, item.parcelaAtual, item.totalParcelas, item.operacao, item.updatedAt
  ]));
}

async function listPluggyTransactions(month) {
  await ensurePluggyStorage();
  const transactions = (await getRange('PluggyTransacoes!A2:O')).filter((row) => row[0] && (!month || String(row[6]).startsWith(month))).map((row) => ({
    id: `pluggy:${row[0]}`, externalId: String(row[0]), itemId: String(row[1]), accountId: String(row[2]), origem: String(row[3]), descricao: String(row[4]),
    valor: parseMoney(row[5]), data: String(row[6]), dataPg: String(row[7]) === 'Pago' ? String(row[6]) : '', mesRef: String(row[6]).slice(0, 7), status: String(row[7]),
    tipo: String(row[8]), categoria: String(row[9] || 'Sem categoria'), ordem: Number(row[10]) || 0, parcelaAtual: Number(row[11]) || 1,
    totalParcelas: Number(row[12]) || 1, idParcelamento: '', recorrente: false, responsavel: 'Nós', fonte: 'pluggy'
  }));
  return [...new Map(transactions.map((item) => [item.externalId, item])).values()];
}

async function savePluggyBills(bills) {
  await ensurePluggyStorage();
  if (!bills.length) return;
  const existing = await getRange('PluggyFaturas!A2:J');
  const localStatuses = new Map(existing.map((row) => [String(row[0] || ''), String(row[9] || '')]));
  await upsertRows('PluggyFaturas', bills.map((bill) => [
    bill.id, bill.itemId, bill.accountId, bill.accountName, bill.dueDate, bill.closingDate, bill.total, bill.payments,
    bill.providerStatus, localStatuses.get(bill.id) || '', bill.estimated ? 'TRUE' : 'FALSE', bill.updatedAt
  ]));
}

async function listPluggyBills(month) {
  await ensurePluggyStorage();
  const [billRows, accountRows] = await Promise.all([getRange('PluggyFaturas!A2:N'), getRange('PluggyContas!A2:Q')]);
  const responsibles = new Map(accountRows.filter((row) => row[0]).map((row) => [String(row[0]), String(row[16] || defaultCardResponsible(row[4]))]));
  const bills = billRows.filter((row) => row[0] && (!month || String(row[4]).startsWith(month))).map((row) => {
    const date = String(row[4]);
    const monthRef = date.slice(0, 7);
    const referenceMonth = currentMonth();
    const closed = monthRef <= referenceMonth;
    const providerStatus = String(row[9] || row[8] || 'Pendente');
    const status = closed ? providerStatus : 'Pendente';
    const hasLocalValue = row[12] !== undefined && row[12] !== '';
    return {
      id: `pluggy-bill:${row[0]}`, externalId: String(row[0]), itemId: String(row[1]), accountId: String(row[2]), origem: String(row[3]),
      descricao: `Fatura ${String(row[3])}`, valor: closed && hasLocalValue ? parseMoney(row[12]) : parseMoney(row[6]), data: date, dataPg: status === 'Pago' ? date : '', mesRef: monthRef,
      status, tipo: 'Pagamento Fatura', categoria: 'Fatura de cartão', responsavel: responsibles.get(String(row[2])) || 'Nós', parcelaAtual: 1, totalParcelas: 1, idParcelamento: '',
      recorrente: false, fonte: 'pluggy-bill', estimada: String(row[10]).toLowerCase() === 'true', ajustada: closed && hasLocalValue,
      situacao: billSituation(monthRef, status, referenceMonth),
      fontePagamento: String(row[13] || 'Conta Corrente')
    };
  });
  const unique = new Map();
  for (const bill of bills) {
    const key = `${bill.accountId}:${bill.mesRef}`;
    const current = unique.get(key);
    if (!current || bill.ajustada || (!current.ajustada && current.estimada && !bill.estimada)) unique.set(key, bill);
  }
  return [...unique.values()];
}

async function updatePluggyBillStatus(id, status) {
  await ensurePluggyStorage();
  if (!['Pago', 'Pendente'].includes(status)) {
    const error = new Error('Status de fatura invalido.');
    error.statusCode = 400;
    throw error;
  }
  const rows = await getRange('PluggyFaturas!A2:A');
  const index = rows.findIndex((row) => String(row[0]) === String(id));
  if (index < 0) {
    const error = new Error('Fatura nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  await sheetsRequest(`/values/${encodeURIComponent(`PluggyFaturas!J${index + 2}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[status]] })
  });
}

async function updatePluggyBill(id, value, source) {
  await ensurePluggyStorage();
  if (!(value > 0) || !source || source.length > 100) {
    const error = new Error('Informe valor e fonte de pagamento validos.');
    error.statusCode = 400;
    throw error;
  }
  const rows = await getRange('PluggyFaturas!A2:A');
  const index = rows.findIndex((row) => String(row[0]) === String(id));
  if (index < 0) {
    const error = new Error('Fatura nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  await sheetsRequest(`/values/${encodeURIComponent(`PluggyFaturas!M${index + 2}:N${index + 2}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[value, source]] })
  });
}

async function registerPluggyEvent(eventId, eventName) {
  await ensurePluggyStorage();
  const rows = await getRange('PluggyEventos!A2:D');
  const existing = rows.filter((row) => row[0] === eventId).at(-1);
  if (existing && String(existing[3] || 'Concluido') !== 'Falhou') return false;
  await upsertRows('PluggyEventos', [[eventId, eventName, new Date().toISOString(), 'Processando']]);
  return true;
}

async function updatePluggyEventStatus(eventId, status) {
  await ensurePluggyStorage();
  const rows = await getRange('PluggyEventos!A2:A');
  const index = rows.map((row) => String(row[0])).lastIndexOf(String(eventId));
  if (index < 0) return;
  await sheetsRequest(`/values/${encodeURIComponent(`PluggyEventos!D${index + 2}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[status]] })
  });
}

async function hasPluggyEvent(eventId) {
  await ensurePluggyStorage();
  return (await getRange('PluggyEventos!A2:A')).some((row) => row[0] === eventId);
}

async function deletePluggyTransactions(ids) {
  await ensurePluggyStorage();
  const targets = new Set(ids.map(String));
  if (!targets.size) return;
  const rows = await getRange('PluggyTransacoes!A2:A');
  const positions = rows.map((row, index) => targets.has(String(row[0])) ? index + 2 : 0).filter(Boolean).sort((a, b) => b - a);
  if (!positions.length) return;
  const metadata = await sheetsRequest('?fields=sheets.properties');
  const sheet = metadata.sheets.find((entry) => entry.properties.title === 'PluggyTransacoes');
  await sheetsRequest(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: positions.map((row) => ({ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } })) })
  });
}

async function deletePluggyItem(itemId) {
  await ensurePluggyStorage();
  await Promise.all([
    deleteRowsMatching('PluggyItens', 0, itemId),
    deleteRowsMatching('PluggyContas', 1, itemId),
    deleteRowsMatching('PluggyTransacoes', 1, itemId),
    deleteRowsMatching('PluggyFaturas', 1, itemId)
  ]);
}

async function deleteRowsMatching(sheetName, columnIndex, value) {
  const rows = await getRange(`${sheetName}!A2:${columnName(columnIndex + 1)}`);
  const positions = rows.map((row, index) => String(row[columnIndex] || '') === String(value) ? index + 2 : 0).filter(Boolean).sort((a, b) => b - a);
  if (!positions.length) return;
  const metadata = await sheetsRequest('?fields=sheets.properties');
  const sheet = metadata.sheets.find((entry) => entry.properties.title === sheetName);
  await sheetsRequest(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: positions.map((row) => ({ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } })) })
  });
}

async function listTransactions(month) {
  const transactions = await listAllTransactions();
  return transactions.filter((item) => item.mesRef === month);
}

async function listAllTransactions() {
  const rows = await getRange('Lancamentos!A2:P');
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
  await ensureTransactionCardHeader();
  return sheetsRequest(`/values/${encodeURIComponent('Lancamentos!A:P')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] })
  });
}

async function updateTransaction(rowNumber, row) {
  await ensureTransactionCardHeader();
  return sheetsRequest(`/values/${encodeURIComponent(`Lancamentos!A${rowNumber}:P${rowNumber}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] })
  });
}

async function ensureTransactionCardHeader() {
  await sheetsRequest(`/values/${encodeURIComponent('Lancamentos!P1')}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [['Cartao']] })
  });
}

async function getMonthlyBudget(month) {
  await ensurePluggyStorage();
  const row = (await getRange('OrcamentosMensais!A2:F')).filter((entry) => String(entry[0]) === month).at(-1);
  if (!row || row[5] !== 'faturas-v1') return null;
  return { month, historicalAverage: parseMoney(row[1]), ceiling: parseMoney(row[2]), historicalTotals: parseJson(row[3], []), createdAt: String(row[4] || '') };
}

async function saveMonthlyBudget(budget) {
  await upsertRows('OrcamentosMensais', [[budget.month, budget.historicalAverage, budget.ceiling, JSON.stringify(budget.historicalTotals), new Date().toISOString(), 'faturas-v1']]);
  return getMonthlyBudget(budget.month);
}

async function saveMentorInsight(insight) {
  const id = insight.scenario === 'month_start' ? `month_start:${insight.month}` : 'sync:latest';
  await upsertRows('MentorInsights', [[id, insight.scenario, insight.month, insight.message || '', insight.perception || '', insight.question || '', insight.contextHash || '', new Date().toISOString()]]);
}

async function getMentorInsights(month) {
  await ensurePluggyStorage();
  const rows = await getRange('MentorInsights!A2:H');
  const mapRow = (row) => ({ scenario: String(row[1]), month: String(row[2]), message: String(row[3] || ''), perception: String(row[4] || ''), question: String(row[5] || ''), contextHash: String(row[6] || ''), updatedAt: String(row[7] || '') });
  const sync = rows.filter((row) => row[0] === 'sync:latest').at(-1);
  const monthly = rows.filter((row) => row[0] === `month_start:${month}`).at(-1);
  return { sync: sync ? mapRow(sync) : null, monthly: monthly ? mapRow(monthly) : null };
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
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

async function updateBox(box) {
  const [configurationRows, transactionRows] = await Promise.all([
    getRange('Configuracoes!C2:E'),
    getRange('Lancamentos!A2:O')
  ]);
  const boxIndex = configurationRows.findIndex((row) => sameLabel(row[0], box.currentName));
  if (boxIndex < 0) {
    const error = new Error('Caixinha nao encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const data = [{ range: `Configuracoes!C${boxIndex + 2}:D${boxIndex + 2}`, values: [[box.nome, box.meta]] }];
  if (box.currentName !== box.nome) {
    transactionRows.forEach((row, index) => {
      const rowNumber = index + 2;
      if (['Depósito', 'Depósito Caixinha'].includes(row[1]) && sameLabel(row[8], box.currentName)) data.push({ range: `Lancamentos!I${rowNumber}`, values: [[box.nome]] });
      if (sameLabel(row[14], box.currentName)) data.push({ range: `Lancamentos!O${rowNumber}`, values: [[box.nome]] });
    });
  }
  await sheetsRequest('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  });
}

function sameLabel(left, right) {
  return String(left || '').trim().toLocaleLowerCase('pt-BR') === String(right || '').trim().toLocaleLowerCase('pt-BR');
}

module.exports = {
  listTransactions, listAllTransactions, getConfiguration, findRow, appendTransaction, updateTransaction, deleteTransaction, updateBox,
  savePluggyItem, listPluggyItems, savePluggyAccounts, listPluggyAccounts, updatePluggyAccountResponsible, savePluggyTransactions, listPluggyTransactions,
  savePluggyBills, listPluggyBills, updatePluggyBillStatus, updatePluggyBill, registerPluggyEvent, updatePluggyEventStatus, hasPluggyEvent, deletePluggyTransactions, deletePluggyItem,
  getMonthlyBudget, saveMonthlyBudget, saveMentorInsight, getMentorInsights
};
