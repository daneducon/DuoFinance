'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cjs = require('../lib/categories');

// Categorias reais que aparecem nas abas PluggyTransacoes e Lancamentos.
const SAMPLES = {
  'Accomodation': 'Lazer e viagens',
  'Housing': 'Moradia e contas',
  'Telecommunications': 'Moradia e contas',
  'Electricity': 'Moradia e contas',
  'Groceries': 'Alimentação',
  'Mercado': 'Alimentação',
  'Almoço': 'Alimentação',
  'Eating out': 'Alimentação',
  'Food delivery': 'Alimentação',
  'Gas stations': 'Transporte',
  'Parking': 'Transporte',
  'Taxi and ride-hailing': 'Transporte',
  'Vehicle maintenance': 'Transporte',
  'Transporte': 'Transporte',
  'Healthcare': 'Saúde e bem-estar',
  'Pharmacy': 'Saúde e bem-estar',
  'Gyms and fitness centers': 'Saúde e bem-estar',
  'Saúde & Pessoal': 'Saúde e bem-estar',
  'Digital services': 'Assinaturas e serviços digitais',
  'School': 'Educação',
  'Pós Graduação ': 'Educação',
  'Cinema, theater and concerts': 'Lazer e viagens',
  'Tickets': 'Lazer e viagens',
  'Rolês': 'Lazer e viagens',
  'Viagem': 'Lazer e viagens',
  'Shopping': 'Compras',
  'Clothing': 'Compras',
  'Electronics': 'Compras',
  'Office supplies': 'Compras',
  'Dívidas & Empréstimos': 'Dívidas, taxas e impostos',
  'Bank fees': 'Dívidas, taxas e impostos',
  'Tax on financial operations': 'Dívidas, taxas e impostos',
  'Insurance': 'Dívidas, taxas e impostos',
  'Trabalho & Taxas': 'Dívidas, taxas e impostos',
  'Transfers': 'Transferências',
  'Transfer - PIX': 'Transferências',
  'Transfer - Bank Slip': 'Transferências',
  'Cartão de Crédito': 'Cartão de crédito',
  'Casal': 'Casal e eventos',
  'Aliança ': 'Casal e eventos',
  'Sem categoria': 'Outros',
  'Services': 'Outros',
  'Outros': 'Outros'
};

test('categorias reais caem no grupo esperado', () => {
  for (const [label, group] of Object.entries(SAMPLES)) {
    assert.equal(cjs.macroCategory(label), group, `"${label}"`);
  }
});

test('versão do navegador (ESM) dá o mesmo resultado que a do servidor', async () => {
  const esm = await import('../public/js/categories.mjs');
  assert.deepEqual(esm.MACRO_CATEGORIES, cjs.MACRO_CATEGORIES);
  for (const label of Object.keys(SAMPLES)) {
    assert.equal(esm.macroCategory(label), cjs.macroCategory(label), `"${label}"`);
  }
});

test('MACRO_CATEGORIES termina com Outros e não tem o grupo genérico antigo', () => {
  assert.equal(cjs.MACRO_CATEGORIES.at(-1), 'Outros');
  assert.ok(!cjs.MACRO_CATEGORIES.includes('Educação e Financeiro'));
});
