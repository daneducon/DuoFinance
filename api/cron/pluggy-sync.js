'use strict';

const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { syncAllItems } = require('../../lib/pluggy-sync');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      const error = new Error('CRON nao autorizado.');
      error.statusCode = 401;
      throw error;
    }
    const results = await syncAllItems();
    send(res, 200, { synced: true, items: results.length });
  } catch (error) {
    errorResponse(res, error);
  }
};
