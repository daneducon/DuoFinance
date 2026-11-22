'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../lib/finance');

const base = { mesRef: '2026-11', data: '2026-11-05', status: 'Pago', categoria: 'Mercado' };

test('despesa com origem externa ou caixinha não entra nas despesas do mês', () => {
  const transactions = [
    { ...base, id: '1', tipo: 'Despesa', valor: 200, origem: 'Conta Corrente' },
    { ...base, id: '2', tipo: 'Despesa', valor: 999, origem: 'Externo' },
    { ...base, id: '3', tipo: 'Despesa', valor: 500, origem: 'Casal' }
  ];
  const summary = summarize(require('../lib/finance').accountExpenses(transactions), []);
  assert.equal(summary.despesas, 200);
});
