'use strict';

const { generateSyncInsight } = require('./mentor');
const { currentMonth } = require('./finance');

async function triggerSyncMentor() {
  const secret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET;
  const host = process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!secret || !host) return generateSyncInsight(currentMonth());
  const response = await fetch(`https://${host}/api/ai/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ mes: currentMonth() })
  });
  if (!response.ok) throw new Error(`Falha ao acionar Mentor Duo: ${response.status}.`);
}

module.exports = { triggerSyncMentor };
