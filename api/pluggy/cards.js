'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const sheets = require('../../lib/sheets');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await verifyRequest(req);
    const month = String(req.query.mes || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const error = new Error('Informe o mes no formato YYYY-MM.');
      error.statusCode = 400;
      throw error;
    }
    const [items, accounts, transactions, bills] = await Promise.all([
      sheets.listPluggyItems(), sheets.listPluggyAccounts(), sheets.listPluggyTransactions(month), sheets.listPluggyBills(month)
    ]);
    const institutions = new Map(items.map((item) => [item.id, item]));
    const cards = accounts.filter((account) => account.type === 'CREDIT' && account.subtype === 'CREDIT_CARD').map((account) => ({
      ...account, institution: institutions.get(account.itemId)?.institution || 'Instituicao conectada', imageUrl: institutions.get(account.itemId)?.imageUrl || ''
    }));
    const bankBalance = accounts.filter((account) => account.type === 'BANK').reduce((sum, account) => sum + account.balance, 0);
    send(res, 200, {
      configured: Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET),
      hasConfiguredItems: Boolean(process.env.PLUGGY_ITEM_IDS?.trim()), items, cards, transactions, bills, bankBalance
    });
  } catch (error) {
    errorResponse(res, error);
  }
};
