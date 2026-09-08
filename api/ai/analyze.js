'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { generateMonthStartInsight } = require('../../lib/mentor');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyRequest(req);
    const month = String(req.body?.mes || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      const error = new Error('Mes de referencia invalido.');
      error.statusCode = 400;
      throw error;
    }
    const insight = await generateMonthStartInsight(month);
    send(res, 200, { ...insight, insight: `${insight.perception}\n\n${insight.question}` });
  } catch (error) {
    errorResponse(res, error);
  }
};
