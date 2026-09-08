'use strict';

const { buildMonthlyCardBudget } = require('./budget');
const { currentMonth } = require('./finance');
const sheets = require('./sheets');

async function getCardBudget(month, { persist = false } = {}) {
  const [pluggyTransactions, manualTransactions, accounts, pluggyBills, saved] = await Promise.all([
    sheets.listPluggyTransactions(),
    sheets.listAllTransactions(),
    sheets.listPluggyAccounts(),
    sheets.listPluggyBills(),
    sheets.getMonthlyBudget(month)
  ]);
  let budget = buildMonthlyCardBudget(month, pluggyTransactions, manualTransactions, accounts, saved, pluggyBills);
  if (!saved && persist && month === currentMonth()) {
    const snapshot = await sheets.saveMonthlyBudget(budget);
    budget = buildMonthlyCardBudget(month, pluggyTransactions, manualTransactions, accounts, snapshot, pluggyBills);
  }
  return { budget, pluggyTransactions, manualTransactions, accounts, pluggyBills };
}

module.exports = { getCardBudget };
