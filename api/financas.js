'use strict';

const { randomUUID } = require('node:crypto');
const { verifyRequest } = require('../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../lib/http');
const { validateTransaction, validateBox, toSheetRow, summarize, calculateCashFlow, buildAnalysis, withoutSupersededCardBills, projectBox, todayIso, calculateCashCycles, recentMonths, boxHistory, freeUntilNextIncome } = require('../lib/finance');
const sheets = require('../lib/sheets');
const { liveBankBalances } = require('../lib/live-balance');
const { describeConnections } = require('../lib/connections');

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  try {
    await verifyRequest(req);
    if (req.method === 'GET') return await getFinances(req, res);
    return await mutateFinances(req, res);
  } catch (error) {
    errorResponse(res, error);
  }
};

async function getFinances(req, res) {
  const month = String(req.query.mes || '');
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const error = new Error('Informe o mes no formato YYYY-MM.');
    error.statusCode = 400;
    throw error;
  }
  const [allManualTransactions, pluggyBills, configuration, mentor] = await Promise.all([
    sheets.listAllTransactions(),
    sheets.listPluggyBills(),
    sheets.getConfiguration(),
    sheets.getMentorInsights(month)
  ]);
  const manualTransactions = withoutSupersededCardBills(allManualTransactions, pluggyBills);
  const accountingTransactions = [...manualTransactions, ...pluggyBills];
  const manualMonthTransactions = manualTransactions.filter((item) => item.mesRef === month);
  const monthBills = pluggyBills.filter((item) => item.mesRef === month);
  const summary = summarize([...manualMonthTransactions, ...monthBills], configuration.caixinhas, manualTransactions);
  // Mês anterior com o mesmo critério dos cards, para o comparativo de receitas e despesas.
  const previousMonth = recentMonths(month, 2)[0];
  const previousSummary = summarize([
    ...manualTransactions.filter((item) => item.mesRef === previousMonth),
    ...pluggyBills.filter((item) => item.mesRef === previousMonth)
  ], configuration.caixinhas, manualTransactions);
  const comparison = { month: previousMonth, receitas: previousSummary.receitas, despesas: previousSummary.despesas };
  summary.caixinhas = summary.caixinhas.map((box) => ({ ...box, projection: projectBox(manualTransactions, box, month), history: boxHistory(manualTransactions, box.nome) }));
  summary.aPagar = manualTransactions.filter((item) => item.mesRef === month && item.tipo === 'Despesa' && item.status === 'Pendente').reduce((sum, item) => sum + item.valor, 0)
    + monthBills.filter((item) => item.status === 'Pendente').reduce((sum, item) => sum + item.valor, 0);
  const [pluggyAccounts, pluggyItems] = await Promise.all([sheets.listPluggyAccounts(), sheets.listPluggyItems()]);
  const hasBank = pluggyAccounts.some((account) => account.type === 'BANK');
  // Saldo do banco no momento da consulta; cai para o último sincronizado se o banco não responder.
  const live = await liveBankBalances(pluggyAccounts);
  const bankBalance = live.total;
  const anchorBalance = hasBank ? bankBalance : summary.saldoAtual;
  send(res, 200, {
    bankBalance,
    bankBalanceUpdatedAt: live.updatedAt,
    connections: describeConnections(pluggyItems),
    comparison,
    transactions: [...manualMonthTransactions, ...monthBills],
    configuration,
    mentor,
    summary,
    cashFlow: calculateCashFlow([...manualTransactions, ...pluggyBills], month),
    cashCycles: { ...calculateCashCycles([...manualTransactions, ...pluggyBills], month, { today: todayIso() }), freeUntil: freeUntilNextIncome([...manualTransactions, ...pluggyBills], anchorBalance, todayIso()) },
    analysis: buildAnalysis(accountingTransactions, month, 12)
  });
}

async function mutateFinances(req, res) {
  const { action, transaction, box, id } = req.body || {};
  if (action === 'updateBillStatus') {
    await sheets.updatePluggyBillStatus(String(id || '').replace(/^pluggy-bill:/, ''), String(req.body?.status || ''));
    return send(res, 200, { updated: true });
  }
  if (action === 'updateBill') {
    await sheets.updatePluggyBill(String(id || '').replace(/^pluggy-bill:/, ''), Number(req.body?.value), String(req.body?.source || '').trim());
    return send(res, 200, { updated: true });
  }
  if (String(transaction?.id || id || '').startsWith('pluggy:')) return send(res, 403, { error: 'Lancamentos sincronizados nao podem ser alterados.' });
  if (action === 'create') {
    const item = validateTransaction({ ...transaction, id: randomUUID() });
    await sheets.appendTransaction(toSheetRow(item));
    return send(res, 201, { transaction: item });
  }
  if (action === 'update') {
    const item = validateTransaction(transaction || {});
    const row = await sheets.findRow(item.id);
    if (!row) return send(res, 404, { error: 'Lancamento nao encontrado.' });
    await sheets.updateTransaction(row, toSheetRow(item));
    return send(res, 200, { transaction: item });
  }
  if (action === 'delete') {
    const row = await sheets.findRow(String(id || ''));
    if (!row) return send(res, 404, { error: 'Lancamento nao encontrado.' });
    await sheets.deleteTransaction(row);
    return send(res, 200, { deleted: true });
  }
  if (action === 'updateBox') {
    const item = validateBox(box || {});
    const configuration = await sheets.getConfiguration();
    const duplicate = configuration.caixinhas.some((entry) => entry.nome.toLocaleLowerCase('pt-BR') === item.nome.toLocaleLowerCase('pt-BR') && entry.nome.toLocaleLowerCase('pt-BR') !== item.currentName.toLocaleLowerCase('pt-BR'));
    if (duplicate) return send(res, 409, { error: 'Ja existe uma caixinha com esse nome.' });
    await sheets.updateBox(item);
    return send(res, 200, { box: item });
  }
  return send(res, 400, { error: 'Acao invalida.' });
}
