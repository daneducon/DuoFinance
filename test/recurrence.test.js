'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { expandRecurrence } = require('../lib/finance');

let counter = 0;
const newId = () => `id-${++counter}`;
const base = { id: 'id-0', tipo: 'Despesa', descricao: 'Spotify', valor: 31.9, data: '2026-11-20', dataPg: '', mesRef: '2026-11', status: 'Pago', recorrente: true, idParcelamento: '' };

test('sem recorrência gera só o lançamento original', () => {
  assert.equal(expandRecurrence({ ...base, recorrente: false }, 12, newId).length, 1);
  assert.equal(expandRecurrence(base, 1, newId).length, 1);
});

test('gera uma linha por mês mantendo o dia', () => {
  const rows = expandRecurrence(base, 3, newId);
  assert.deepEqual(rows.map((row) => row.data), ['2026-11-20', '2026-12-20', '2027-01-20']);
  assert.deepEqual(rows.map((row) => row.mesRef), ['2026-11', '2026-12', '2027-01']);
});

test('dia 31 cai no último dia dos meses menores', () => {
  const rows = expandRecurrence({ ...base, data: '2026-01-31' }, 3, newId);
  assert.deepEqual(rows.map((row) => row.data), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('parcelas futuras ficam pendentes e compartilham o mesmo id da série', () => {
  const rows = expandRecurrence(base, 2, newId);
  assert.equal(rows[1].status, 'Pendente');
  assert.equal(rows[1].dataPg, '');
  assert.equal(rows[0].idParcelamento, rows[1].idParcelamento);
  assert.notEqual(rows[1].id, rows[0].id);
});

test('limita a quantidade máxima', () => {
  assert.equal(expandRecurrence(base, 500, newId).length, 60);
});
