'use strict';

const { waitUntil } = require('@vercel/functions');
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
    waitUntil(processEvent(event, itemId, req.body)
      .then(() => sheets.registerPluggyEvent(eventId, event))
      .catch((error) => console.error('Pluggy webhook:', error)));
    send(res, 202, { received: true });
  } catch (error) {
    errorResponse(res, error);
  }
};

function verifySecret(req) {
  const expected = process.env.PLUGGY_WEBHOOK_SECRET?.trim();
  if (!expected) return;
  const provided = String(req.headers['x-pluggy-secret'] || req.query?.secret || '').trim();
  if (provided !== expected) {
    const error = new Error('Webhook nao autorizado.');
    error.statusCode = 401;
    throw error;
  }
}


async function processEvent(event, itemId, body) {
  if (event === 'item/deleted' && itemId) return sheets.deletePluggyItem(itemId);
  if (event === 'transactions/deleted') return sheets.deletePluggyTransactions(body?.transactionIds || []);
  if (itemId && ['item/created', 'item/updated', 'item/error', 'item/waiting_user_input', 'item/waiting_user_action'].includes(event)) {
    await syncItem(itemId);
  }
}
