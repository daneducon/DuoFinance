'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, withoutBoxExpenses } = require('../lib/finance');

const boxes = [{ nome: 'Viagem', meta: 1000 }];
const base = { mesRef: '2026-11', data: '2026-11-05', status: 'Pago', categoria: 'Lazer', origem: 'Conta Corrente' };

test('gasto pago por caixinha não entra em despesas nem em categorias, mas reduz a caixinha', () => {
  const transactions = [
    { ...base, id: '1', tipo: 'Despesa', descricao: 'Passagem', valor: 300, origem: 'Viagem' }
  ];
  const summary = summarize(transactions, boxes);
  assert.equal(summary.despesas, 0);
  assert.equal(summary.categorias.Lazer, undefined);
  assert.equal(summary.caixinhas[0].saldo, -300);
});

test('despesa paga pela conta corrente continua somando nas despesas', () => {
  const transactions = [
    { ...base, id: '2', tipo: 'Despesa', descricao: 'Mercado', valor: 200 }
  ];
  const summary = summarize(transactions, boxes);
  assert.equal(summary.despesas, 200);
});

test('withoutBoxExpenses tira só o gasto de caixinha e preserva depósitos e resgates', () => {
  const transactions = [
    { ...base, id: '3', tipo: 'Despesa', valor: 100, origem: 'Viagem' },
    { ...base, id: '4', tipo: 'Depósito', valor: 50, categoria: 'Viagem' },
    { ...base, id: '5', tipo: 'Resgate', valor: 20, origem: 'Viagem' },
    { ...base, id: '6', tipo: 'Despesa', valor: 30 }
  ];
  const kept = withoutBoxExpenses(transactions, boxes).map((item) => item.id);
  assert.deepEqual(kept, ['4', '5', '6']);
});
