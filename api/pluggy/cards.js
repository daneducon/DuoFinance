'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { nextMonth } = require('../../lib/finance');
const { getCardBudget } = require('../../lib/budget-service');
const { isManualCardBill } = require('../../lib/budget');
const sheets = require('../../lib/sheets');
const { liveBankBalances } = require('../../lib/live-balance');
const { describeConnections, institutionName } = require('../../lib/connections');

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
    const [items, accounts, transactions, bills, nextBills, manualTransactions, budgetData, allBills] = await Promise.all([
      sheets.listPluggyItems(), sheets.listPluggyAccounts(), sheets.listPluggyTransactions(month), sheets.listPluggyBills(month),
      sheets.listPluggyBills(paymentMonth), sheets.listAllTransactions(), getCardBudget(month), sheets.listPluggyBills()
    ]);
    const manualBills = manualTransactions
      .filter((item) => item.tipo === 'Despesa' && item.mesRef === month && isManualCardBill(item))
      .map((item) => ({ id: item.id, descricao: item.descricao, cartao: item.cartao, valor: item.valor, data: item.data, status: item.status }));
    const institutions = new Map(items.map((item) => [item.id, item]));
    const allocations = new Map(budgetData.budget.cards.map((card) => [card.accountId, card]));
    const cards = accounts.filter((account) => account.type === 'CREDIT' && account.subtype === 'CREDIT_CARD').map((account) => ({
      ...account, institution: institutionName(institutions.get(account.itemId) || { id: account.itemId }, accounts), imageUrl: institutions.get(account.itemId)?.imageUrl || '', budget: allocations.get(account.id)
    }));
    const live = await liveBankBalances(accounts);
    const bankBalance = live.total;
    const bankBalanceUpdatedAt = live.updatedAt;
    const connections = describeConnections(items, Date.now(), accounts);
    const availableLimit = cards.reduce((sum, card) => sum + (card.availableLimit || 0), 0);
    // Histórico completo por cartão, para o gráfico de faturas sem trocar de mês.
    const billHistory = Object.fromEntries(cards.map((card) => [card.id, allBills
      .filter((bill) => bill.accountId === card.id)
      .map((bill) => ({ mesRef: bill.mesRef, data: bill.data, valor: bill.valor, status: bill.status, estimada: bill.estimada, ajustada: bill.ajustada }))
      .sort((a, b) => a.mesRef.localeCompare(b.mesRef))]));
    send(res, 200, {
      configured: Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET),
      hasConfiguredItems: Boolean(process.env.PLUGGY_ITEM_IDS?.trim()), items, cards, transactions, bills, nextBills, manualBills, billHistory, bankBalance, bankBalanceUpdatedAt, connections, availableLimit, budget: budgetData.budget, spendingMonth: month, paymentMonth
    });
  } catch (error) {
    errorResponse(res, error);
  }
};
