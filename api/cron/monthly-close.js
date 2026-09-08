'use strict';

const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { currentMonth } = require('../../lib/finance');
const { generateMonthStartInsight } = require('../../lib/mentor');
const { getCardBudget } = require('../../lib/budget-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      const error = new Error('CRON nao autorizado.');
      error.statusCode = 401;
      throw error;
    }
    await getCardBudget(currentMonth(), { persist: true });
    const insight = await generateMonthStartInsight(currentMonth());
    send(res, 200, { closed: true, month: currentMonth(), insight });
  } catch (error) {
    errorResponse(res, error);
  }
};
