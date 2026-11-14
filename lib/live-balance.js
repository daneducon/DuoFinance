'use strict';

const pluggy = require('./pluggy');

// Cache curto por conta: evita uma chamada à Pluggy a cada carregamento da tela.
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();

// Saldo em tempo real das contas bancárias. Se o banco não responder, usa o último saldo sincronizado.
async function liveBankBalances(accounts) {
  const banks = accounts.filter((account) => account.type === 'BANK');
  const results = await Promise.all(banks.map(async (account) => {
    const cached = cache.get(account.id);
    if (cached && Date.now() - cached.at < CACHE_MS) return { account, ...cached.value };
    try {
      const data = await pluggy.getAccountBalance(account.id);
      const value = { balance: Number(data.balance) || 0, updatedAt: data.updateDateTime || new Date().toISOString(), live: true };
      cache.set(account.id, { at: Date.now(), value });
      return { account, ...value };
    } catch (error) {
      console.error('Saldo em tempo real falhou', account.id, error.statusCode, error.message);
      return { account, balance: account.balance, updatedAt: account.updatedAt || '', live: false };
    }
  }));
  const total = results.reduce((sum, entry) => sum + entry.balance, 0);
  const updatedAt = results.map((entry) => entry.updatedAt).filter(Boolean).sort().at(0) || '';
  const liveCount = results.filter((entry) => entry.live).length;
  return { total, updatedAt, liveCount, totalCount: results.length, balances: new Map(results.map((entry) => [entry.account.id, entry.balance])) };
}

module.exports = { liveBankBalances };
