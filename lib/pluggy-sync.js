'use strict';

const pluggy = require('./pluggy');
const sheets = require('./sheets');

async function syncItem(itemId) {
  const item = await pluggy.getItem(itemId);
  // O titular só é buscado quando ainda não está salvo, para não gastar uma chamada extra a cada sincronização.
  const knownHolder = (await sheets.listPluggyItems()).find((saved) => saved.id === itemId)?.holder || '';
  const holder = knownHolder || await pluggy.getHolderName(itemId).catch(() => '');
  await sheets.savePluggyItem(item, holder);
  if (!['UPDATED', 'OUTDATED'].includes(item.status)) return { item, accounts: 0, transactions: 0, billErrors: [] };

  const accounts = await pluggy.listAccounts(itemId);
  await sheets.savePluggyAccounts(accounts);
  const creditAccounts = accounts.filter((account) => account.type === 'CREDIT' && account.subtype === 'CREDIT_CARD');
  let transactionCount = 0;
  const billErrors = [];
  for (const account of creditAccounts) {
    const rawTransactions = await pluggy.listTransactions(account.id);
    const transactions = rawTransactions.map((entry) => pluggy.mapTransaction(entry, account)).filter(Boolean);
    const bills = await listBillsOrReport(account, billErrors);
    await sheets.savePluggyTransactions(transactions);
    await sheets.savePluggyBills(pluggy.mapBills(bills, account, rawTransactions));
    transactionCount += transactions.length;
  }
  return { item, accounts: accounts.length, transactions: transactionCount, billErrors };
}

// Não engole o erro: a fatura some em silêncio se /bills falhar, então registramos o motivo e a resposta.
async function listBillsOrReport(account, billErrors) {
  try {
    const bills = await pluggy.listBills(account.id);
    console.info('Pluggy /bills', account.id, JSON.stringify(bills.map((bill) => ({ dueDate: bill.dueDate, closingDate: bill.billClosingDate, totalAmount: bill.totalAmount, status: bill.status }))));
    return bills;
  } catch (error) {
    console.error('Pluggy /bills falhou', account.id, error.statusCode, error.message);
    billErrors.push({ accountId: account.id, status: error.statusCode, message: error.message });
    return [];
  }
}

async function syncAllItems() {
  const savedItems = await sheets.listPluggyItems();
  const configuredIds = (process.env.PLUGGY_ITEM_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  const itemIds = [...new Set([...savedItems.map((item) => item.id), ...configuredIds])];
  if (!itemIds.length) {
    const error = new Error('Configure PLUGGY_ITEM_IDS com o ID da conexao criada na Pluggy.');
    error.statusCode = 400;
    throw error;
  }
  const results = [];
  for (const itemId of itemIds) results.push(await syncItem(itemId));
  return results;
}

module.exports = { syncItem, syncAllItems };
