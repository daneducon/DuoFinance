'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, validateTransaction, validateBox, calculateCashFlow, buildAnalysis, parseMoney } = require('../lib/finance');
const { mapTransaction, mapBills } = require('../lib/pluggy');

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

test('valida edicao de nome e meta da caixinha', () => {
  assert.deepEqual(validateBox({ currentName: 'Viagem', nome: 'Lua de mel', meta: '12.500,50' }), {
    currentName: 'Viagem', nome: 'Lua de mel', meta: 12500.5
  });
  assert.throws(() => validateBox({ currentName: 'Viagem', nome: '', meta: 100 }), /nome valido/);
  assert.throws(() => validateBox({ currentName: 'Viagem', nome: 'Reserva', meta: -1 }), /negativa/);
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

test('mapeia compra e estorno da Pluggy sem importar pagamento de fatura', () => {
  const account = { id: 'account-1', itemId: 'item-1', name: 'Visa', number: 'xxxx1234' };
  const purchase = mapTransaction({ id: 'tx-1', type: 'DEBIT', amount: 89.9, date: '2026-09-07T12:00:00Z', status: 'POSTED', description: 'Mercado', creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 } }, account);
  assert.equal(purchase.tipo, 'Despesa');
  assert.equal(purchase.accountName, 'Visa • 1234');
  assert.equal(purchase.parcelaAtual, 2);
  assert.equal(mapTransaction({ id: 'tx-2', type: 'CREDIT', amount: -50, date: '2026-09-08', description: 'Estorno', operationType: 'ESTORNO' }, account).tipo, 'Estorno');
  assert.equal(mapTransaction({ id: 'tx-4', type: 'CREDIT', amount: -100, date: '2026-09-08', description: 'Pagamento' }, account), null);
  assert.equal(mapTransaction({ id: 'tx-3', operationType: 'PAGAMENTO_FATURA' }, account), null);
});

test('desconta estornos das despesas e da analise', () => {
  const transactions = [
    { tipo: 'Despesa', valor: 100, mesRef: '2026-09', categoria: 'Lazer', responsavel: 'Nós', origem: 'Visa' },
    { tipo: 'Estorno', valor: 30, mesRef: '2026-09', categoria: 'Lazer', responsavel: 'Nós', origem: 'Visa' }
  ];
  assert.equal(summarize(transactions).despesas, 70);
  assert.equal(buildAnalysis(transactions, '2026-09').months[2].total, 70);
});

test('mapeia fatura oficial e identifica pagamento completo', () => {
  const account = { id: 'account-1', itemId: 'item-1', name: 'Visa', number: 'xxxx1234' };
  const bills = mapBills([{ id: 'bill-1', dueDate: '2026-09-15T00:00:00Z', totalAmount: 500, payments: [{ amount: 500 }] }], account);
  assert.equal(bills[0].total, 500);
  assert.equal(bills[0].providerStatus, 'Pago');
  assert.equal(bills[0].estimated, false);
});

test('estima fatura por mes previsto quando endpoint de faturas nao esta disponivel', () => {
  const account = { id: 'account-1', itemId: 'item-1', name: 'Visa', creditData: { balanceDueDate: '2026-09-12' } };
  const bills = mapBills([], account, [
    { type: 'DEBIT', amount: 120, date: '2026-08-28', creditCardMetadata: { billForecastDate: '2026-09' } },
    { type: 'CREDIT', amount: -20, date: '2026-08-29', operationType: 'ESTORNO', creditCardMetadata: { billForecastDate: '2026-09' } },
    { type: 'CREDIT', amount: -100, date: '2026-09-12', operationType: 'PAGAMENTO_FATURA' }
  ]);
  assert.equal(bills[0].total, 100);
  assert.equal(bills[0].dueDate, '2026-09-12');
  assert.equal(bills[0].estimated, true);
});

test('estima apenas meses que nao possuem fatura oficial', () => {
  const account = { id: 'account-1', itemId: 'item-1', name: 'Visa' };
  const bills = mapBills(
    [{ id: 'official-1', dueDate: '2026-08-10', totalAmount: 300, payments: [] }],
    account,
    [
      { type: 'DEBIT', amount: 300, date: '2026-08-01', creditCardMetadata: { billForecastDate: '2026-08' } },
      { type: 'DEBIT', amount: 180, date: '2026-09-01', creditCardMetadata: { billForecastDate: '2026-09' } }
    ]
  );
  assert.equal(bills.length, 2);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-08')).estimated, false);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-09')).total, 180);
});

test('pagamento de fatura afeta o saldo sem duplicar despesas', () => {
  const pending = summarize([{ tipo: 'Pagamento Fatura', valor: 800, status: 'Pendente', fontePagamento: 'Conta Corrente', categoria: 'Fatura de cartão' }]);
  assert.equal(pending.despesas, 800);
  assert.equal(pending.aPagar, 800);
  assert.equal(pending.saldoPrevisto, -800);
  assert.equal(pending.saldoAtual, 0);
  const paid = summarize([{ tipo: 'Pagamento Fatura', valor: 800, status: 'Pago', fontePagamento: 'Conta Corrente', categoria: 'Fatura de cartão' }]);
  assert.equal(paid.saldoAtual, -800);
});

test('atribui compra ao ciclo correto e projeta parcelas futuras', () => {
  const account = {
    id: 'santander-card', itemId: 'item-1', name: 'Santander',
    creditData: { balanceCloseDate: '2026-09-03', balanceDueDate: '2026-09-10' }
  };
  const bills = mapBills([], account, [{
    type: 'DEBIT', amount: 391.58, date: '2026-08-26', description: 'Amazon',
    creditCardMetadata: { installmentNumber: 3, totalInstallments: 12, purchaseDate: '2026-06-26', totalAmount: 4698.96 }
  }]);
  assert.equal(bills.length, 10);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-09')).total, 391.58);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-10')).total, 391.58);
  assert.equal(bills.at(-1).dueDate.slice(0, 7), '2027-06');
});

test('nao duplica projecao quando a parcela seguinte ja existe', () => {
  const account = { id: 'card-1', itemId: 'item-1', name: 'Card' };
  const metadata = { totalInstallments: 5, purchaseDate: '2026-07-05', totalAmount: 500 };
  const bills = mapBills([], account, [
    { type: 'DEBIT', amount: 100, date: '2026-09-05', description: 'Compra', creditCardMetadata: { ...metadata, installmentNumber: 3, billForecastDate: '2026-09' } },
    { type: 'DEBIT', amount: 100, date: '2026-10-05', description: 'Compra', creditCardMetadata: { ...metadata, installmentNumber: 4, billForecastDate: '2026-10' } }
  ]);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-10')).total, 100);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-11')).total, 100);
});
