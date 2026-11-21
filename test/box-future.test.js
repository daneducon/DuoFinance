'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../lib/finance');

test('movimentos futuros de caixinha não entram no saldo atual', () => {
  const boxes = [{ nome: 'DinDin', meta: 3600 }];
  const transactions = [
    { id: '1', tipo: 'Depósito', valor: 100, data: '2020-01-01', mesRef: '2020-01', status: 'Pago', categoria: 'DinDin', origem: 'Externo' },
    { id: '2', tipo: 'Depósito', valor: 51, data: '2099-12-01', mesRef: '2099-12', status: 'Pendente', categoria: 'DinDin', origem: 'Conta Corrente' }
  ];
  const summary = summarize(transactions, boxes);
  assert.equal(summary.caixinhas[0].saldo, 100);
});
