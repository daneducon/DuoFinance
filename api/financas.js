'use strict';

const { randomUUID } = require('node:crypto');
const { verifyRequest } = require('../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../lib/http');
const { validateTransaction, validateBox, toSheetRow, summarize, calculateCashFlow, buildAnalysis } = require('../lib/finance');
const sheets = require('../lib/sheets');

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
  const [manualTransactions, pluggyTransactions, configuration] = await Promise.all([
    sheets.listAllTransactions(),
    sheets.listPluggyTransactions(),
    sheets.getConfiguration()
  ]);
  const allTransactions = [...manualTransactions, ...pluggyTransactions];
  const transactions = allTransactions.filter((item) => item.mesRef === month);
  send(res, 200, {
    transactions,
    configuration,
    summary: summarize(transactions, configuration.caixinhas, allTransactions),
    cashFlow: calculateCashFlow(allTransactions, month),
    analysis: buildAnalysis(allTransactions, month)
  });
}

async function mutateFinances(req, res) {
  const { action, transaction, box, id } = req.body || {};
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
