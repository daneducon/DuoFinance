'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { secretsMatch } = require('../lib/secrets');

test('secretsMatch aceita apenas o segredo exato', () => {
  assert.equal(secretsMatch('abc123', 'abc123'), true);
  assert.equal(secretsMatch('abc124', 'abc123'), false);
  assert.equal(secretsMatch('abc', 'abc123'), false);
  assert.equal(secretsMatch('', 'abc123'), false);
});

test('secretsMatch recusa quando não há segredo configurado', () => {
  assert.equal(secretsMatch('abc123', undefined), false);
  assert.equal(secretsMatch(undefined, undefined), false);
  assert.equal(secretsMatch('', ''), false);
});
