'use strict';

const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncItem } = require('../../lib/pluggy-sync');
const sheets = require('../../lib/sheets');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    verifySecret(req);
    const eventId = String(req.body?.eventId || '');
    const event = String(req.body?.event || '');
    const itemId = String(req.body?.itemId || '');
    if (!eventId || !event) {
      const error = new Error('Webhook invalido.');
      error.statusCode = 400;
      throw error;
    }
    if (await sheets.hasPluggyEvent(eventId)) return send(res, 200, { received: true, duplicate: true });
    if (itemId && ['item/created', 'item/updated', 'item/error', 'item/waiting_user_input', 'item/waiting_user_action', 'transactions/created', 'transactions/updated', 'transactions/deleted'].includes(event)) {
      await syncItem(itemId);
    }
    if (event === 'transactions/deleted') await sheets.deletePluggyTransactions(req.body?.transactionIds || []);
    await sheets.registerPluggyEvent(eventId, event);
    send(res, 202, { received: true });
  } catch (error) {
    errorResponse(res, error);
  }
};

function verifySecret(req) {
  const expected = process.env.PLUGGY_WEBHOOK_SECRET?.trim();
  if (!expected) return;
  const provided = String(req.headers['x-pluggy-secret'] || '').trim();
  if (!provided) return;
  if (provided !== expected) {
    const error = new Error('Webhook nao autorizado.');
    error.statusCode = 401;
    throw error;
  }
}
