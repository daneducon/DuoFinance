'use strict';

const { waitUntil } = require('@vercel/functions');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncItem } = require('../../lib/pluggy-sync');
const sheets = require('../../lib/sheets');
const { triggerSyncMentor } = require('../../lib/mentor-trigger');
const { secretsMatch } = require('../../lib/secrets');
const { broadcastPush, pushConfigured } = require('../../lib/push');
const { connectionHealth } = require('../../lib/connections');

// Eventos em que o usuário precisa agir no banco. Disparam notificação no celular.
const ALERT_EVENTS = ['item/error', 'item/waiting_user_input', 'item/waiting_user_action'];

async function alertConnection(itemId) {
  if (!pushConfigured()) return;
  const saved = (await sheets.listPluggyItems()).find((item) => item.id === itemId);
  if (!saved) return;
  const health = connectionHealth(saved);
  if (!health.needsAttention) return;
  await broadcastPush({ title: `${saved.institution} precisa de atenção`, body: health.message, url: '/#general' });
}

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
  // Webhooks criados pelo Dashboard enviam o segredo na URL (?secret=); os criados pela API, no header.
  const provided = String(req.headers['x-pluggy-secret'] || req.query?.secret || '').trim();
  if (!secretsMatch(provided, expected)) {
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
  if (itemId && ALERT_EVENTS.includes(event)) await alertConnection(itemId);
  if (['item/created', 'item/updated', 'transactions/created', 'transactions/updated', 'transactions/deleted'].includes(event)) await triggerSyncMentor();
}
