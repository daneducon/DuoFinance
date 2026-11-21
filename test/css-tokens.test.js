'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Uma variável definida como ela mesma fica inválida e o navegador usa o valor padrão (ex.: cor de texto perdida).
test('nenhum token CSS se referencia a si mesmo', () => {
  const css = readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  const selfReferences = [...css.matchAll(/--([a-z0-9-]+):\s*var\(--\1\)/g)].map((match) => match[1]);
  assert.deepEqual(selfReferences, []);
});
