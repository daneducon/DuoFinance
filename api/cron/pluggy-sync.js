'use strict';

const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncAllItems } = require('../../lib/pluggy-sync');
const { sendDueReminders } = require('../../lib/push');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      const error = new Error('CRON nao autorizado.');
      error.statusCode = 401;
      throw error;
    }
    let syncError = null;
    const results = await syncAllItems().catch((error) => { syncError = error; return []; });
    // Lembretes rodam mesmo se a sincronização falhar: eles leem os lançamentos já gravados.
    const reminders = await sendDueReminders().catch((error) => ({ error: error.message }));
    if (syncError) throw syncError;
    send(res, 200, { synced: true, items: results.length, reminders });
  } catch (error) {
    errorResponse(res, error);
  }
};
