'use strict';

const pluggy = require('./pluggy');

// Cache curto por conta: evita uma chamada à Pluggy a cada carregamento da tela.
const CACHE_MS = 2 * 60 * 1000;
// Falha ao consultar o banco não se repete a cada carregamento: fica guardada por 30 minutos.
const FAILURE_CACHE_MS = 30 * 60 * 1000;
const cache = new Map();

// Saldo em tempo real das contas bancárias. Se o banco não responder, usa o último saldo sincronizado.
async function liveBankBalances(accounts) {
  const banks = accounts.filter((account) => account.type === 'BANK');
  const results = await Promise.all(banks.map(async (account) => {
    const cached = cache.get(account.id);
    if (cached && Date.now() - cached.at < cached.ttl) {
      // Falha guardada: usa o saldo sincronizado atual, não um valor antigo da memória.
      if (cached.failed) return { account, balance: account.balance, updatedAt: account.updatedAt || '', live: false };
      return { account, ...cached.value };
    }
    try {
      const data = await pluggy.getAccountBalance(account.id);
      const value = { balance: Number(data.balance) || 0, updatedAt: data.updateDateTime || new Date().toISOString(), live: true };
      cache.set(account.id, { at: Date.now(), ttl: CACHE_MS, value });
      return { account, ...value };
    } catch (error) {
      console.info('Saldo em tempo real indisponível', account.id, error.statusCode, error.message);
      cache.set(account.id, { at: Date.now(), ttl: FAILURE_CACHE_MS, failed: true });
      return { account, balance: account.balance, updatedAt: account.updatedAt || '', live: false };
    }
  }));
  const total = results.reduce((sum, entry) => sum + entry.balance, 0);
  const updatedAt = results.map((entry) => entry.updatedAt).filter(Boolean).sort().at(0) || '';
  const liveCount = results.filter((entry) => entry.live).length;
  return { total, updatedAt, liveCount, totalCount: results.length, balances: new Map(results.map((entry) => [entry.account.id, entry.balance])) };
}

module.exports = { liveBankBalances };
