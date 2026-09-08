'use strict';

const { waitUntil } = require('@vercel/functions');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncItem } = require('../../lib/pluggy-sync');
const sheets = require('../../lib/sheets');
const { triggerSyncMentor } = require('../../lib/mentor-trigger');

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
    if (!await sheets.registerPluggyEvent(eventId, event)) return send(res, 200, { received: true, duplicate: true });
    waitUntil(processEvent(event, itemId, req.body)
      .then(() => sheets.updatePluggyEventStatus(eventId, 'Concluido'))
      .catch(async (error) => {
        console.error('Pluggy webhook:', error);
        await sheets.updatePluggyEventStatus(eventId, 'Falhou').catch((statusError) => console.error('Status do webhook:', statusError));
      }));
    send(res, 202, { received: true });
  } catch (error) {
    errorResponse(res, error);
  }
};

function verifySecret(req) {
  const expected = process.env.PLUGGY_WEBHOOK_SECRET?.trim();
  if (!expected) {
    const error = new Error('PLUGGY_WEBHOOK_SECRET nao configurado.');
    error.statusCode = 503;
    throw error;
  }
  const provided = String(req.headers['x-pluggy-secret'] || '').trim();
  if (provided !== expected) {
    const error = new Error('Webhook nao autorizado.');
    error.statusCode = 401;
    throw error;
  }
}


async function processEvent(event, itemId, body) {
  if (event === 'item/deleted' && itemId) await sheets.deletePluggyItem(itemId);
  else if (event === 'transactions/deleted') await sheets.deletePluggyTransactions(body?.transactionIds || []);
  if (itemId && ['item/created', 'item/updated', 'item/error', 'item/waiting_user_input', 'item/waiting_user_action', 'transactions/created', 'transactions/updated'].includes(event)) {
    await syncItem(itemId);
  }
  if (['item/created', 'item/updated', 'transactions/created', 'transactions/updated', 'transactions/deleted'].includes(event)) await triggerSyncMentor();
}
