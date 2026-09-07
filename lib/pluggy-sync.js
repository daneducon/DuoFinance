'use strict';

const pluggy = require('./pluggy');
const sheets = require('./sheets');

async function syncItem(itemId) {
  const item = await pluggy.getItem(itemId);
  await sheets.savePluggyItem(item);
  if (!['UPDATED', 'OUTDATED'].includes(item.status)) return { item, accounts: 0, transactions: 0 };

  const accounts = await pluggy.listAccounts(itemId);
  await sheets.savePluggyAccounts(accounts);
  const creditAccounts = accounts.filter((account) => account.type === 'CREDIT' && account.subtype === 'CREDIT_CARD');
  let transactionCount = 0;
  for (const account of creditAccounts) {
    const transactions = (await pluggy.listTransactions(account.id)).map((entry) => pluggy.mapTransaction(entry, account)).filter(Boolean);
    await sheets.savePluggyTransactions(transactions);
    transactionCount += transactions.length;
  }
  return { item, accounts: accounts.length, transactions: transactionCount };
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
