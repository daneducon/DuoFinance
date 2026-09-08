'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { nextMonth } = require('../../lib/finance');
const { getCardBudget } = require('../../lib/budget-service');
const sheets = require('../../lib/sheets');

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  try {
    await verifyRequest(req);
    if (req.method === 'POST') {
      await sheets.updatePluggyAccountResponsible(String(req.body?.accountId || ''), String(req.body?.responsavel || ''));
      return send(res, 200, { updated: true });
    }
    const month = String(req.query.mes || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const error = new Error('Informe o mes no formato YYYY-MM.');
      error.statusCode = 400;
      throw error;
    }
    const paymentMonth = nextMonth(month);
    const [items, accounts, transactions, bills, budgetData] = await Promise.all([
      sheets.listPluggyItems(), sheets.listPluggyAccounts(), sheets.listPluggyTransactions(month), sheets.listPluggyBills(paymentMonth), getCardBudget(month)
    ]);
    const institutions = new Map(items.map((item) => [item.id, item]));
    const allocations = new Map(budgetData.budget.cards.map((card) => [card.accountId, card]));
    const cards = accounts.filter((account) => account.type === 'CREDIT' && account.subtype === 'CREDIT_CARD').map((account) => ({
      ...account, institution: institutions.get(account.itemId)?.institution || 'Instituicao conectada', imageUrl: institutions.get(account.itemId)?.imageUrl || '', budget: allocations.get(account.id)
    }));
    const bankBalance = accounts.filter((account) => account.type === 'BANK').reduce((sum, account) => sum + account.balance, 0);
    send(res, 200, {
      configured: Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET),
      hasConfiguredItems: Boolean(process.env.PLUGGY_ITEM_IDS?.trim()), items, cards, transactions, bills, bankBalance, budget: budgetData.budget, spendingMonth: month, paymentMonth
    });
  } catch (error) {
    errorResponse(res, error);
  }
};
