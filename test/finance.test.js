'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, validateTransaction, calculateCashFlow, buildAnalysis, parseMoney } = require('../lib/finance');

test('calcula saldos sem abater despesas de caixinha da conta corrente', () => {
  const transactions = [
    { tipo: 'Receita', valor: 5000, status: 'Pago', origem: 'Conta Corrente', categoria: 'Renda' },
    { tipo: 'Despesa', valor: 1000, status: 'Pago', origem: 'Conta Corrente', categoria: 'Moradia' },
    { tipo: 'Despesa', valor: 300, status: 'Pago', origem: 'Viagem', categoria: 'Lazer' },
    { tipo: 'Despesa', valor: 500, status: 'Pendente', origem: 'Cartão de Crédito', categoria: 'Mercado' },
    { tipo: 'Depósito Caixinha', valor: 1000, status: 'Pago', origem: 'Viagem', categoria: 'Metas' }
  ];
  const summary = summarize(transactions, [{ nome: 'Viagem', meta: 2000, favorito: true }]);
  assert.equal(summary.saldoAtual, 4000);
  assert.equal(summary.saldoPrevisto, 3500);
  assert.equal(summary.caixinhas[0].saldo, 700);
  assert.equal(summary.caixinhas[0].progresso, 35);
});

test('normaliza moeda brasileira', () => {
  assert.equal(parseMoney('1.234,56'), 1234.56);
});

test('calcula caixinhas com historico e formato real da planilha', () => {
  const month = [
    { tipo: 'Depósito', valor: 250, status: 'Pago', origem: 'Conta Corrente', categoria: 'Aliança' },
    { tipo: 'Depósito', valor: 10.98, status: 'Pago', origem: 'Externo', categoria: 'Aliança' }
  ];
  const history = [
    { tipo: 'Depósito', valor: 250, status: 'Pago', origem: 'Conta Corrente', categoria: 'Aliança' },
    { tipo: 'Depósito', valor: 10.98, status: 'Pago', origem: 'Externo', categoria: 'Aliança' },
    { tipo: 'Depósito', valor: 300, status: 'Pago', origem: 'Conta Corrente', categoria: 'Aliança' },
    { tipo: 'Depósito Caixinha', valor: 200, status: 'Pendente', origem: 'Aliança', categoria: 'Aliança' },
    { tipo: 'Despesa', valor: 100, status: 'Pago', origem: 'Conta Corrente', categoria: 'Aliança' }
  ];
  const summary = summarize(month, [{ nome: 'Aliança', meta: 2000, favorito: true }], history);
  assert.equal(summary.caixinhas[0].saldo, 760.98);
  assert.equal(summary.saldoPrevisto, -250);
  assert.equal(summary.saldoAtual, -250);
});

test('rejeita lancamento inconsistente', () => {
  assert.throws(() => validateTransaction({ tipo: 'Despesa', valor: -1 }), /descricao valida/);
});

test('todo novo deposito e registrado como pago', () => {
  const deposit = validateTransaction({
    tipo: 'Depósito', descricao: 'Reserva', valor: 100, data: '2026-09-06',
    status: 'Pendente', categoria: 'Casal', responsavel: 'Nós', origem: 'Conta Corrente'
  });
  assert.equal(deposit.status, 'Pago');
  assert.equal(deposit.dataPg, '2026-09-06');
});

test('identifica intervalo de caixa negativo no mes', () => {
  const transactions = [
    { tipo: 'Receita', valor: 500, data: '2026-08-20', origem: 'Conta Corrente' },
    { tipo: 'Despesa', valor: 700, data: '2026-09-05', origem: 'Conta Corrente' },
    { tipo: 'Receita', valor: 400, data: '2026-09-10', origem: 'Conta Corrente' }
  ];
  const flow = calculateCashFlow(transactions, '2026-09');
  assert.equal(flow.openingBalance, 500);
  assert.equal(flow.minimumBalance, -200);
  assert.deepEqual(flow.negativePeriods, [{ start: '2026-09-05', end: '2026-09-09' }]);
});

test('agrupa despesas dos ultimos tres meses para analise', () => {
  const analysis = buildAnalysis([
    { tipo: 'Despesa', valor: 100, mesRef: '2026-07', categoria: 'Lazer', responsavel: 'Nós' },
    { tipo: 'Despesa', valor: 250, mesRef: '2026-09', categoria: 'Moradia', responsavel: 'Ele' }
  ], '2026-09');
  assert.deepEqual(analysis.months.map((month) => month.month), ['2026-07', '2026-08', '2026-09']);
  assert.equal(analysis.months[2].categories.Moradia, 250);
});

test('separa valores mensais a receber e a pagar', () => {
  const pending = [
    { tipo: 'Receita', valor: 900, status: 'Pendente', origem: 'Conta Corrente', categoria: 'Renda' },
    { tipo: 'Despesa', valor: 350, status: 'Pendente', origem: 'Conta Corrente', categoria: 'Moradia' },
    { tipo: 'Despesa', valor: 100, status: 'Pago', origem: 'Conta Corrente', categoria: 'Lazer' }
  ];
  const summary = summarize(pending);
  assert.equal(summary.aReceber, 900);
  assert.equal(summary.aPagar, 350);
});
