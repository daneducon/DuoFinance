'use strict';

// Status da Pluggy que pedem ação do usuário (login de novo, código, confirmação no app do banco).
const ATTENTION_STATUSES = ['LOGIN_ERROR', 'WAITING_USER_INPUT', 'WAITING_USER_ACTION', 'OUTDATED', 'ERROR'];
const STALE_HOURS = 48;
// Nomes genéricos de conector (ex.: o conector de teste da Pluggy): não dizem qual banco é.
const GENERIC_CONNECTORS = ['meupluggy', 'sandbox', 'instituicao conectada'];

const LABELS = {
  LOGIN_ERROR: 'Login recusado. Conecte de novo no banco.',
  WAITING_USER_INPUT: 'O banco pediu um código para continuar.',
  WAITING_USER_ACTION: 'Confirme o acesso no app do banco.',
  OUTDATED: 'Conexão desatualizada. Atualize o consentimento.',
  ERROR: 'A conexão apresentou erro.'
};

// Diz se a conexão precisa de atenção ou se os dados estão antigos demais.
function connectionHealth(item, now = Date.now()) {
  const needsAttention = ATTENTION_STATUSES.includes(item.status);
  const last = Date.parse(item.lastUpdatedAt || '');
  const hoursOld = Number.isFinite(last) ? (now - last) / 3600000 : Infinity;
  const stale = !needsAttention && hoursOld > STALE_HOURS;
  let message = '';
  if (needsAttention) message = LABELS[item.status] || item.error || 'Esta conexão precisa de atenção.';
  else if (stale) message = 'Sem atualização há mais de 2 dias.';
  return { needsAttention, stale, ok: !needsAttention && !stale, message };
}

function cleanBankName(name) {
  const short = String(name || '').trim().split(/\s+-\s+|\s+S\.A\.?/i)[0].replace(/\s+/g, ' ').trim();
  return short.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

// Nome que aparece para o usuário: o conector, ou o nome do banco nas contas quando o conector é genérico.
function institutionName(item, accounts = []) {
  const connector = String(item.institution || '').trim();
  if (connector && !GENERIC_CONNECTORS.includes(connector.toLocaleLowerCase('pt-BR'))) return connector;
  const mine = accounts.filter((account) => account.itemId === item.id);
  const bank = mine.find((account) => account.type === 'BANK') || mine[0];
  return cleanBankName(bank?.name) || connector || 'Instituição conectada';
}

// Lista pronta para a tela: quem precisa de atenção primeiro.
function describeConnections(items, now = Date.now(), accounts = []) {
  return items
    .map((item) => ({ id: item.id, institution: institutionName(item, accounts), holder: item.holder || '', status: item.status, lastUpdatedAt: item.lastUpdatedAt, ...connectionHealth(item, now) }))
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || Number(b.stale) - Number(a.stale));
}

module.exports = { connectionHealth, describeConnections, institutionName, ATTENTION_STATUSES };
