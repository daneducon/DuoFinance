'use strict';

const webpush = require('web-push');
const sheets = require('./sheets');
const { todayIso } = require('./finance');

const REMINDER_DAYS = 2;

function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureVapid() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'localhost';
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `https://${host}`, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

// Contas pendentes que vencem daqui a REMINDER_DAYS dias, no fuso de São Paulo.
async function dueItems(today = todayIso()) {
  const dueDate = shiftDate(today, REMINDER_DAYS);
  const [manual, bills] = await Promise.all([sheets.listAllTransactions(), sheets.listPluggyBills()]);
  return [...manual, ...bills].filter((item) => item.status === 'Pendente' && item.data === dueDate && ['Despesa', 'Pagamento Fatura'].includes(item.tipo));
}

function reminderPayload(items) {
  const title = items.length === 1 ? `Vence em ${REMINDER_DAYS} dias: ${items[0].descricao}` : `${items.length} contas vencem em ${REMINDER_DAYS} dias`;
  const body = items.slice(0, 4).map((item) => `${item.descricao} · ${money(item.valor)}`).join('\n');
  return JSON.stringify({ title, body, url: '/#transactions' });
}

async function sendDueReminders(today = todayIso()) {
  if (!pushConfigured()) return { sent: 0, skipped: 'Chaves VAPID não configuradas.' };
  const items = await dueItems(today);
  if (!items.length) return { sent: 0, items: 0 };
  const result = await broadcastPush(reminderPayload(items));
  return { ...result, items: items.length };
}

// Envia a mesma notificação para todas as inscrições salvas. Remove as que expiraram no navegador.
async function broadcastPush(payload) {
  if (!pushConfigured()) return { sent: 0, subscriptions: 0 };
  configureVapid();
  const subscriptions = await sheets.listPushSubscriptions();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, body);
      sent++;
    } catch (error) {
      // 404/410: a inscrição expirou no navegador e não volta a funcionar.
      if ([404, 410].includes(error.statusCode)) await sheets.deletePushSubscription(subscription.endpoint);
      else console.error('Notificação push falhou', error.statusCode, error.body || error.message);
    }
  }
  return { sent, subscriptions: subscriptions.length };
}

module.exports = { pushConfigured, sendDueReminders, broadcastPush, reminderPayload, REMINDER_DAYS };
