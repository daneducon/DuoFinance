'use strict';

const { generateSyncInsight } = require('./mentor');
const { currentMonth } = require('./finance');

async function triggerSyncMentor() {
  // Sem INTERNAL_API_SECRET, o Mentor é gerado direto nesta função (não usa o segredo do cron).
  const secret = process.env.INTERNAL_API_SECRET;
  // Endereço de produção: o endereço do próprio deploy pode estar protegido pela Vercel e recusar a chamada interna.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!secret || !host) return generateSyncInsight(currentMonth());
  const response = await fetch(`https://${host}/api/ai/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ mes: currentMonth() })
  });
  if (!response.ok) throw new Error(`Falha ao acionar Mentor Duo: ${response.status}.`);
}

module.exports = { triggerSyncMentor };
