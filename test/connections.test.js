'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { connectionHealth, describeConnections } = require('../lib/connections');

const now = Date.parse('2026-11-08T12:00:00Z');

test('conexão com login recusado precisa de atenção', () => {
  const health = connectionHealth({ status: 'LOGIN_ERROR', lastUpdatedAt: '2026-11-08T11:00:00Z' }, now);
  assert.equal(health.needsAttention, true);
  assert.equal(health.ok, false);
  assert.match(health.message, /Login recusado/);
});

test('conexão atualizada há pouco está ok', () => {
  const health = connectionHealth({ status: 'UPDATED', lastUpdatedAt: '2026-11-08T10:00:00Z' }, now);
  assert.deepEqual([health.needsAttention, health.stale, health.ok], [false, false, true]);
});

test('conexão sem atualização há mais de 48 horas fica desatualizada', () => {
  const health = connectionHealth({ status: 'UPDATED', lastUpdatedAt: '2026-11-05T10:00:00Z' }, now);
  assert.equal(health.stale, true);
  assert.equal(health.needsAttention, false);
});

test('lista coloca conexões com atenção no topo', () => {
  const list = describeConnections([
    { id: 'a', institution: 'Nu', status: 'UPDATED', lastUpdatedAt: '2026-11-08T10:00:00Z' },
    { id: 'b', institution: 'Itaú', status: 'WAITING_USER_ACTION', lastUpdatedAt: '2026-11-08T10:00:00Z' }
  ], now);
  assert.equal(list[0].id, 'b');
});
