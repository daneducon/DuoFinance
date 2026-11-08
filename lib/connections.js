'use strict';

// Status da Pluggy que pedem ação do usuário (login de novo, código, confirmação no app do banco).
const ATTENTION_STATUSES = ['LOGIN_ERROR', 'WAITING_USER_INPUT', 'WAITING_USER_ACTION', 'OUTDATED', 'ERROR'];
const STALE_HOURS = 48;

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

// Lista pronta para a tela: quem precisa de atenção primeiro.
function describeConnections(items, now = Date.now()) {
  return items
    .map((item) => ({ id: item.id, institution: item.institution, holder: item.holder || '', status: item.status, lastUpdatedAt: item.lastUpdatedAt, ...connectionHealth(item, now) }))
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || Number(b.stale) - Number(a.stale));
}

module.exports = { connectionHealth, describeConnections, ATTENTION_STATUSES };
