'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyNodes, runMonthlyGraph } = require('../lib/mentor');

const input = {
  mes: '2026-11',
  mediaTrimestral: 9000,
  cicloAnterior: {
    teto: 7000, gastoReal: 6500, intocavel: 3000, otimizavel: 1200,
    faturasLeroyCamicadoSemDetalhamento: 800, categoriasOtimizaveis: [{ categoria: 'Lazer', valor: 400 }]
  }
};

test('cada nó recebe só o seu recorte dos dados', () => {
  const nodes = monthlyNodes(input);
  assert.deepEqual(nodes.map((node) => node.name), ['cartoes', 'otimizavel', 'intocavel']);
  const cartoes = nodes.find((node) => node.name === 'cartoes').data;
  assert.equal('otimizavel' in cartoes, false);
  assert.equal('mediaTrimestral' in cartoes, false);
  const intocavel = nodes.find((node) => node.name === 'intocavel').data;
  assert.equal('gastoReal' in intocavel, false);
});

test('a síntese recebe só as observações dos nós, não os dados brutos', async () => {
  const bodies = [];
  const original = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'teste';
  global.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    const last = bodies.length === 4;
    const content = last
      ? '{"percepcao":"Teto bem controlado.","provocacao":"Qual hábito vale rever?"}'
      : '{"observacao":"Observação curta."}';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  try {
    const result = await runMonthlyGraph(input);
    assert.equal(result.percepcao, 'Teto bem controlado.');
    assert.equal(bodies.length, 4);
    const synthesisUser = JSON.parse(bodies[3].messages[1].content);
    assert.equal('cicloAnterior' in synthesisUser, false);
    assert.equal(synthesisUser.observacoes.length, 3);
  } finally {
    global.fetch = original;
    process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test('um nó que falha não derruba a análise', async () => {
  let calls = 0;
  const original = global.fetch;
  process.env.OPENROUTER_API_KEY = 'teste';
  global.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 500, json: async () => ({}) };
    const content = calls === 4 ? '{"percepcao":"ok","provocacao":"pergunta"}' : '{"observacao":"ok"}';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  try {
    const result = await runMonthlyGraph(input);
    assert.equal(result.percepcao, 'ok');
  } finally {
    global.fetch = original;
  }
});
