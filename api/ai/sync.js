'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { currentMonth } = require('../../lib/finance');
const { generateSyncInsight } = require('../../lib/mentor');
const sheets = require('../../lib/sheets');

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  try {
    if (req.method === 'GET') {
      await verifyRequest(req);
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query?.mes) ? req.query.mes : currentMonth();
      return send(res, 200, { insight: (await sheets.getMentorInsights(month)).sync });
    }
    const expected = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET;
    if (!expected || req.headers['x-internal-secret'] !== expected) {
      const error = new Error('Chamada interna nao autorizada.');
      error.statusCode = 401;
      throw error;
    }
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.body?.mes) ? req.body.mes : currentMonth();
    const insight = await generateSyncInsight(month);
    send(res, 200, { generated: true, insight });
  } catch (error) {
    errorResponse(res, error);
  }
};
