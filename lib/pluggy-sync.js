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
  const items = await sheets.listPluggyItems();
  const results = [];
  for (const item of items) results.push(await syncItem(item.id));
  return results;
}

module.exports = { syncItem, syncAllItems };
