'use strict';

const { recentMonths } = require('./finance');

const HARD_CAP = 3000;
const BUDGET_FACTOR = 0.95;
const MANUAL_CARDS = ['Leroy', 'Camicado'];

function buildMonthlyCardBudget(month, pluggyTransactions = [], manualTransactions = [], accounts = [], snapshot = null, pluggyBills = []) {
  const historyMonths = recentMonths(previousMonth(month), 3);
  const calculatedHistoricalTotals = historyMonths.map((historyMonth) => billSpending(pluggyBills, historyMonth) + manualCardSpending(manualTransactions, historyMonth));
  const historicalTotals = snapshot?.historicalTotals?.length === 3 ? snapshot.historicalTotals : calculatedHistoricalTotals;
  const historicalAverage = snapshot?.historicalAverage ?? historicalTotals.reduce((sum, value) => sum + value, 0) / 3;
  const ceiling = snapshot?.ceiling ?? Math.min(HARD_CAP, Math.max(0, historicalAverage * BUDGET_FACTOR));
  const fixedCards = Object.fromEntries(MANUAL_CARDS.map((card) => [card, manualCardSpending(manualTransactions, month, card)]));
  const fixedSpending = Object.values(fixedCards).reduce((sum, value) => sum + value, 0);
  const connectedSpending = billSpending(pluggyBills, month);
  const consumption = fixedSpending + connectedSpending;
  const connectedBudget = Math.max(0, ceiling - fixedSpending);
  const activeAccounts = accounts.filter((account) => account.type === 'CREDIT' && account.subtype === 'CREDIT_CARD');
  const averages = new Map(activeAccounts.map((account) => {
    const total = historyMonths.reduce((sum, historyMonth) => sum + billSpending(pluggyBills, historyMonth, account.id), 0);
    return [account.id, total / 3];
  }));
  const averageTotal = [...averages.values()].reduce((sum, value) => sum + value, 0);
  const cards = activeAccounts.map((account) => {
    const share = averageTotal > 0 ? averages.get(account.id) / averageTotal : 1 / Math.max(1, activeAccounts.length);
    const budget = connectedBudget * share;
    const spent = billSpending(pluggyBills, month, account.id);
    const percentage = budget > 0 ? spent / budget * 100 : spent > 0 ? 100 : 0;
    return { accountId: account.id, budget, spent, remaining: budget - spent, percentage, risk: budgetRisk(percentage), share };
  });
  const percentage = ceiling > 0 ? consumption / ceiling * 100 : consumption > 0 ? 100 : 0;
  const unclassifiedCardBills = manualTransactions.filter((item) => historyMonths.includes(item.mesRef) && sameLabel(item.categoria, 'Cartão de Crédito') && !MANUAL_CARDS.some((card) => sameLabel(item.cartao, card)));

  return {
    month,
    historyMonths,
    historicalTotals,
    historicalAverage,
    hardCap: HARD_CAP,
    factor: BUDGET_FACTOR,
    ceiling,
    fixedCards,
    fixedSpending,
    connectedBudget,
    connectedSpending,
    consumption,
    remaining: ceiling - consumption,
    percentage,
    risk: budgetRisk(percentage),
    cards,
    unclassifiedCardBills: unclassifiedCardBills.map((item) => ({ id: item.id, mesRef: item.mesRef, descricao: item.descricao })),
    optimizable: optimizableSummary(pluggyTransactions.filter((item) => item.mesRef === month))
  };
}

function billSpending(bills, spendingMonth, accountId) {
  const paymentMonth = nextMonth(spendingMonth);
  return Math.max(0, bills
    .filter((bill) => bill.mesRef === paymentMonth && (!accountId || bill.accountId === accountId))
    .reduce((sum, bill) => sum + Number(bill.valor || 0), 0));
}

function cardSpending(transactions, month, accountId) {
  return Math.max(0, transactions
    .filter((item) => item.mesRef === month && (!accountId || item.accountId === accountId))
    .reduce((sum, item) => sum + signedSpending(item), 0));
}

function manualCardSpending(transactions, month, card) {
  return Math.max(0, transactions
    .filter((item) => item.mesRef === month && isManualCardBill(item) && (!card || sameLabel(item.cartao, card)))
    .reduce((sum, item) => sum + signedSpending(item), 0));
}

function signedSpending(item) {
  if (item.tipo === 'Estorno') return -Number(item.valor || 0);
  return ['Despesa', 'Pagamento Fatura'].includes(item.tipo) ? Number(item.valor || 0) : 0;
}

function isManualCardBill(item) {
  return sameLabel(item.categoria, 'Cartão de Crédito') && MANUAL_CARDS.some((card) => sameLabel(item.cartao, card));
}

function spendingFlag(item) {
  const label = normalize(`${item.categoria || ''} ${item.descricao || ''}`);
  if (matches(label, ['delivery', 'ifood', 'rappi', 'uber eats', 'ubereats', '99 food', '99food'])) return 'Otimizável';
  if (matches(label, ['groceries', 'grocery', 'mercado', 'supermercado', 'hortifruti', 'comida basica'])) return 'Intocável';
  if (matches(label, ['pharmacy', 'healthcare', 'farmacia', 'saude', 'saude & trabalho', 'hospital', 'medico', 'medicamento'])) return 'Intocável';
  if (matches(label, ['eating out', 'restaurant', 'restaurante'])) return 'Intocável';
  return 'Otimizável';
}

function optimizableSummary(transactions) {
  const categories = {};
  let total = 0;
  for (const item of transactions) {
    if (spendingFlag(item) !== 'Otimizável') continue;
    const value = signedSpending(item);
    total += value;
    const category = item.categoria || 'Sem categoria';
    categories[category] = (categories[category] || 0) + value;
  }
  return { total: Math.max(0, total), categories };
}

function budgetRisk(percentage) {
  if (percentage >= 95) return 'red';
  if (percentage >= 85) return 'yellow';
  return 'green';
}

function previousMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function sameLabel(left, right) {
  return normalize(left) === normalize(right);
}

function matches(label, terms) {
  return terms.some((term) => label.includes(term));
}

module.exports = { HARD_CAP, BUDGET_FACTOR, MANUAL_CARDS, buildMonthlyCardBudget, budgetRisk, spendingFlag, isManualCardBill };
