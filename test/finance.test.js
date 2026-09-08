'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, validateTransaction, validateBox, calculateCashFlow, buildAnalysis, parseMoney, macroCategory, billSituation, nextMonth, defaultCardResponsible } = require('../lib/finance');
const { mapTransaction, mapBills, isCardCreditAdjustment } = require('../lib/pluggy');
const { buildMonthlyCardBudget, budgetRisk, spendingFlag, isManualCardBill } = require('../lib/budget');

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
  assert.equal(analysis.months[2].categories['Moradia e Contas'], 250);
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
    { type: 'DEBIT', amount: 100, date: '2026-09-05', description: 'Compra parcela 03/05', creditCardMetadata: { ...metadata, installmentNumber: 3, billForecastDate: '2026-09' } },
    { type: 'DEBIT', amount: 100, date: '2026-10-05', description: 'Compra parcela 04/05', creditCardMetadata: { ...metadata, installmentNumber: 4, billForecastDate: '2026-10' } }
  ]);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-10')).total, 100);
  assert.equal(bills.find((bill) => bill.dueDate.startsWith('2026-11')).total, 100);
});

test('define situacao da fatura conforme o mes selecionado', () => {
  assert.equal(billSituation('2026-08', 'Pago', '2026-09'), 'Paga');
  assert.equal(billSituation('2026-08', 'Pendente', '2026-09'), 'Pendente');
  assert.equal(billSituation('2026-09', 'Pago', '2026-09'), 'Paga');
  assert.equal(billSituation('2026-09', 'Pendente', '2026-09'), 'Pendente');
  assert.equal(billSituation('2026-10', 'Pendente', '2026-09'), 'Aberta');
  assert.equal(billSituation('2026-11', 'Pendente', '2026-09'), 'Projetada');
});

test('calcula o mes de pagamento seguinte ao mes dos gastos', () => {
  assert.equal(nextMonth('2026-09'), '2026-10');
  assert.equal(nextMonth('2026-12'), '2027-01');
});

test('agrupa categorias da Pluggy e manuais em seis macros', () => {
  assert.equal(macroCategory('Groceries'), 'Alimentação');
  assert.equal(macroCategory('Food delivery'), 'Alimentação');
  assert.equal(macroCategory('Gas stations'), 'Transporte');
  assert.equal(macroCategory('Pharmacy'), 'Saúde e Bem-estar');
  assert.equal(macroCategory('Digital services'), 'Compras e Lazer');
  assert.equal(macroCategory('Moradia'), 'Moradia e Contas');
  assert.equal(macroCategory('Dívidas & Empréstimos'), 'Educação e Financeiro');
});

test('analise sempre oferece somente as seis categorias macros', () => {
  const analysis = buildAnalysis([
    { tipo: 'Despesa', valor: 50, mesRef: '2026-09', categoria: 'Groceries', responsavel: 'Ela' },
    { tipo: 'Despesa', valor: 100, mesRef: '2026-09', categoria: 'Food delivery', responsavel: 'Ele' }
  ], '2026-09');
  assert.equal(Object.keys(analysis.months[2].categories).length, 6);
  assert.equal(analysis.months[2].categories['Alimentação'], 150);
  assert.equal(analysis.months[2].responsibles.Ela, 50);
});

test('mantem total da analise igual ao resumo usando faturas', () => {
  const transactions = [
    { tipo: 'Despesa', valor: 600, status: 'Pago', mesRef: '2026-09', categoria: 'Moradia', responsavel: 'Ele', origem: 'Conta Corrente' },
    { tipo: 'Pagamento Fatura', valor: 1250, status: 'Pendente', mesRef: '2026-09', categoria: 'Fatura de cartão', responsavel: 'Nós', fontePagamento: 'Conta Corrente' }
  ];
  const summary = summarize(transactions);
  const analysis = buildAnalysis(transactions, '2026-09');
  assert.equal(analysis.months[2].total, summary.despesas);
  assert.equal(analysis.months[2].total, 1850);
});

test('atribui os responsaveis padrao aos cartoes conhecidos', () => {
  assert.equal(defaultCardResponsible('SANTANDER ELITE MASTER'), 'Ela');
  assert.equal(defaultCardResponsible('ultraviolet-black'), 'Ele');
  assert.equal(defaultCardResponsible('ITAU VISA PLATINUM'), 'Ele');
  assert.equal(defaultCardResponsible('Cartão compartilhado'), 'Nós');
});

test('trata ajuste a credito do Nubank como cashback e abate da fatura', () => {
  const account = { id: 'nubank', itemId: 'item-1', name: 'ultraviolet-black' };
  const adjustment = { id: 'credit-1', type: 'CREDIT', amount: -105, date: '2026-09-05', description: 'Ajuste a crédito' };
  assert.equal(isCardCreditAdjustment(adjustment), true);
  assert.equal(mapTransaction(adjustment, account).tipo, 'Estorno');
  const bills = mapBills([], account, [
    { type: 'DEBIT', amount: 1729, date: '2026-09-02', description: 'Compras' },
    adjustment
  ]);
  assert.equal(bills[0].total, 1624);
});

test('persiste o cartao manual no formato da planilha', () => {
  const transaction = validateTransaction({
    tipo: 'Despesa', descricao: 'Fatura da loja', valor: 250, data: '2026-09-08', status: 'Pago',
    categoria: 'Cartão de Crédito', responsavel: 'Nós', origem: 'Conta Corrente', cartao: 'Leroy'
  });
  assert.equal(transaction.cartao, 'Leroy');
  assert.equal(isManualCardBill(transaction), true);
  assert.throws(() => validateTransaction({ ...transaction, cartao: 'Outro' }), /Cartao invalido/);
  assert.throws(() => validateTransaction({ ...transaction, cartao: '' }), /Informe o cartao/);
  assert.throws(() => validateTransaction({ ...transaction, categoria: 'Moradia' }), /so pode ser informado/);
});

test('calcula teto com tres meses incluindo meses zerados e limite absoluto', () => {
  const accounts = [
    { id: 'a', type: 'CREDIT', subtype: 'CREDIT_CARD' },
    { id: 'b', type: 'CREDIT', subtype: 'CREDIT_CARD' },
    { id: 'c', type: 'CREDIT', subtype: 'CREDIT_CARD' }
  ];
  const pluggy = [{ mesRef: '2026-09', accountId: 'a', tipo: 'Despesa', valor: 200, categoria: 'Food delivery' }];
  const bills = [
    { mesRef: '2026-07', accountId: 'a', valor: 900 },
    { mesRef: '2026-09', accountId: 'b', valor: 600 },
    { mesRef: '2026-10', accountId: 'a', valor: 200 }
  ];
  const manual = [
    { mesRef: '2026-08', tipo: 'Despesa', valor: 300, categoria: 'Cartão de Crédito', cartao: 'Leroy' },
    { mesRef: '2026-09', tipo: 'Despesa', valor: 100, categoria: 'Cartão de Crédito', cartao: 'Camicado' }
  ];
  const budget = buildMonthlyCardBudget('2026-09', pluggy, manual, accounts, null, bills);
  assert.deepEqual(budget.historicalTotals, [900, 0, 900]);
  assert.equal(budget.historicalAverage, 600);
  assert.equal(budget.ceiling, 570);
  assert.equal(budget.fixedSpending, 100);
  assert.equal(budget.connectedBudget, 470);
  assert.equal(budget.consumption, 300);
  assert.equal(budget.remaining, 270);
  assert.equal(Math.round(budget.cards[0].budget), 282);
  assert.equal(Math.round(budget.cards[1].budget), 188);
  assert.equal(budget.cards[2].budget, 0);

  const highHistory = ['2026-07', '2026-08', '2026-09'].map((mesRef) => ({ mesRef, accountId: 'a', valor: 4000 }));
  assert.equal(buildMonthlyCardBudget('2026-09', [], [], accounts, null, highHistory).ceiling, 3000);

  const frozen = buildMonthlyCardBudget('2026-09', [], [], accounts, { historicalAverage: 600, ceiling: 570, historicalTotals: [900, 0, 900] }, highHistory);
  assert.equal(frozen.ceiling, 570);
  assert.deepEqual(frozen.historicalTotals, [900, 0, 900]);
});

test('usa as faturas consolidadas no consumo sem duplicar transacoes', () => {
  const accounts = ['a', 'b', 'c'].map((id) => ({ id, type: 'CREDIT', subtype: 'CREDIT_CARD' }));
  const transactions = [{ mesRef: '2026-09', accountId: 'a', tipo: 'Despesa', valor: 1093.78, categoria: 'Food delivery' }];
  const bills = [
    { mesRef: '2026-10', accountId: 'a', valor: 783.2 },
    { mesRef: '2026-10', accountId: 'b', valor: 1621.86 },
    { mesRef: '2026-10', accountId: 'c', valor: 476.53 }
  ];
  const manual = [
    { mesRef: '2026-09', tipo: 'Despesa', valor: 395, categoria: 'Cartão de Crédito', cartao: 'Leroy' },
    { mesRef: '2026-09', tipo: 'Despesa', valor: 216, categoria: 'Cartão de Crédito', cartao: 'Camicado' }
  ];
  const budget = buildMonthlyCardBudget('2026-09', transactions, manual, accounts, { historicalAverage: 4000, ceiling: 3000, historicalTotals: [4000, 4000, 4000] }, bills);
  assert.equal(budget.connectedSpending, 2881.59);
  assert.equal(budget.consumption, 3492.59);
  assert.ok(Math.abs(budget.remaining - -492.59) < 1e-9);
  assert.deepEqual(budget.cards.map((card) => card.spent), [783.2, 1621.86, 476.53]);
});

test('sinaliza fatura historica sem identificacao de cartao', () => {
  const budget = buildMonthlyCardBudget('2026-09', [], [{
    id: 'legacy', mesRef: '2026-08', tipo: 'Despesa', valor: 200, categoria: 'Cartão de Crédito', descricao: 'Fatura antiga'
  }]);
  assert.deepEqual(budget.unclassifiedCardBills, [{ id: 'legacy', mesRef: '2026-08', descricao: 'Fatura antiga' }]);
});

test('aplica faixas de risco sem esconder percentuais acima do teto', () => {
  assert.equal(budgetRisk(84.99), 'green');
  assert.equal(budgetRisk(85), 'yellow');
  assert.equal(budgetRisk(94.99), 'yellow');
  assert.equal(budgetRisk(95), 'red');
});

test('protege essenciais e restaurantes mas permite corte de delivery', () => {
  assert.equal(spendingFlag({ categoria: 'Groceries', descricao: 'Mercado' }), 'Intocável');
  assert.equal(spendingFlag({ categoria: 'Pharmacy', descricao: 'Remédio' }), 'Intocável');
  assert.equal(spendingFlag({ categoria: 'Eating out', descricao: 'Restaurante local' }), 'Intocável');
  assert.equal(spendingFlag({ categoria: 'Food and drinks', descricao: 'iFood restaurante' }), 'Otimizável');
  assert.equal(spendingFlag({ categoria: 'Food delivery', descricao: 'Delivery' }), 'Otimizável');
});
