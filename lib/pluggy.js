'use strict';

const BASE_URL = 'https://api.pluggy.ai';
let cachedKey;
let keyExpiresAt = 0;

function credentials() {
  const clientId = process.env.PLUGGY_CLIENT_ID?.trim();
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    const error = new Error('Credenciais da Pluggy nao configuradas.');
    error.statusCode = 503;
    throw error;
  }
  return { clientId, clientSecret };
}

async function apiKey() {
  if (cachedKey && Date.now() < keyExpiresAt) return cachedKey;
  const response = await fetch(`${BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials())
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.apiKey) throw pluggyError(response.status, body);
  cachedKey = body.apiKey;
  keyExpiresAt = Date.now() + 110 * 60 * 1000;
  return cachedKey;
}

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey(), ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw pluggyError(response.status, body);
  return body;
}

function pluggyError(status, body) {
  const error = new Error(body.message || 'Falha ao acessar a Pluggy.');
  error.statusCode = status >= 400 && status < 500 ? status : 502;
  error.code = body.codeDescription;
  return error;
}

function getItem(itemId) {
  return request(`/items/${encodeURIComponent(itemId)}`);
}

function listAccounts(itemId) {
  return request(`/accounts?itemId=${encodeURIComponent(itemId)}`).then((data) => data.results || []);
}

async function listTransactions(accountId) {
  let path = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;
  const transactions = [];
  while (path) {
    const page = await request(path);
    transactions.push(...(page.results || []));
    path = page.next ? `/v2/transactions${page.next}` : '';
  }
  return transactions;
}

function mapTransaction(transaction, account) {
  const billPayment = transaction.operationType === 'PAGAMENTO_FATURA';
  if (billPayment) return null;
  if (transaction.type === 'CREDIT' && !['ESTORNO', 'CASHBACK'].includes(transaction.operationType)) return null;
  const type = transaction.type === 'CREDIT' ? 'Estorno' : 'Despesa';
  const date = String(transaction.date || '').slice(0, 10);
  return {
    id: String(transaction.id),
    itemId: String(account.itemId),
    accountId: String(account.id),
    accountName: cardName(account),
    descricao: String(transaction.description || transaction.descriptionRaw || 'Compra no cartao').trim().slice(0, 100),
    valor: Math.abs(Number(transaction.amount) || 0),
    data: date,
    status: transaction.status === 'PENDING' ? 'Pendente' : 'Pago',
    tipo: type,
    categoria: String(transaction.category || 'Sem categoria').trim(),
    ordem: Number(transaction.order) || 0,
    parcelaAtual: Number(transaction.creditCardMetadata?.installmentNumber) || 1,
    totalParcelas: Number(transaction.creditCardMetadata?.totalInstallments) || 1,
    operacao: String(transaction.operationType || ''),
    updatedAt: String(transaction.updatedAt || transaction.createdAt || '')
  };
}

function cardName(account) {
  const ending = String(account.number || '').replace(/\D/g, '').slice(-4);
  return `${account.name || account.marketingName || 'Cartao'}${ending ? ` • ${ending}` : ''}`;
}

module.exports = { getItem, listAccounts, listTransactions, mapTransaction, cardName };
