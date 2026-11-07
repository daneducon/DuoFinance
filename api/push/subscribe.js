'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const sheets = require('../../lib/sheets');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyRequest(req);
    const subscription = req.body?.subscription;
    if (!subscription || !/^https:\/\//.test(String(subscription.endpoint || '')) || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      const error = new Error('Inscrição de notificação inválida.');
      error.statusCode = 400;
      throw error;
    }
    if (req.body?.action === 'unsubscribe') await sheets.deletePushSubscription(subscription.endpoint);
    else await sheets.savePushSubscription(subscription);
    send(res, 200, { saved: true });
  } catch (error) {
    errorResponse(res, error);
  }
};
