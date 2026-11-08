'use strict';

const TYPES = ['Receita', 'Despesa', 'Estorno', 'Pagamento Fatura', 'Depósito', 'Depósito Caixinha', 'Resgate'];
const STATUSES = ['Pago', 'Pendente'];
const RESPONSIBLES = ['Ele', 'Ela', 'Nós'];
const CURRENT_ACCOUNT = 'Conta Corrente';
const { MACRO_CATEGORIES, macroCategory } = require('./categories');

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value || '').replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function bool(value) {
  return value === true || ['true', 'verdadeiro', 'sim'].includes(String(value).toLowerCase());
}

function normalizeTransaction(row) {
  return {
    id: String(row[0] || '').trim(),
    tipo: String(row[1] || '').trim(),
    descricao: String(row[2] || '').trim(),
    valor: parseMoney(row[3]),
    data: String(row[4] || ''),
    dataPg: String(row[5] || ''),
    mesRef: String(row[6] || ''),
    status: String(row[7] || 'Pendente').trim(),
    categoria: String(row[8] || '').trim(),
    responsavel: String(row[9] || 'Nós').trim(),
    parcelaAtual: Number(row[10]) || 1,
    totalParcelas: Number(row[11]) || 1,
    idParcelamento: String(row[12] || ''),
    recorrente: bool(row[13]),
    origem: String(row[14] || CURRENT_ACCOUNT).trim(),
    cartao: String(row[15] || '').trim()
  };
}

function toSheetRow(item) {
  return [
    item.id, item.tipo, item.descricao, item.valor, item.data, item.dataPg || '', item.mesRef,
    item.status, item.categoria, item.responsavel, item.parcelaAtual, item.totalParcelas,
    item.idParcelamento || '', item.recorrente ? 'VERDADEIRO' : 'FALSO', item.origem, item.cartao || ''
  ];
}

function validateTransaction(input) {
  const isDeposit = input.tipo === 'Depósito' || input.tipo === 'Depósito Caixinha';
  const item = {
    id: String(input.id || ''),
    tipo: String(input.tipo || ''),
    descricao: String(input.descricao || '').trim(),
    valor: parseMoney(input.valor),
    data: String(input.data || ''),
    dataPg: String(input.dataPg || ''),
    mesRef: String(input.mesRef || input.data?.slice(0, 7) || ''),
    status: isDeposit ? 'Pago' : String(input.status || ''),
    categoria: String(input.categoria || '').trim(),
    responsavel: String(input.responsavel || ''),
    parcelaAtual: Math.max(1, Number(input.parcelaAtual) || 1),
    totalParcelas: Math.max(1, Number(input.totalParcelas) || 1),
    idParcelamento: String(input.idParcelamento || ''),
    recorrente: bool(input.recorrente),
    origem: String(input.origem || CURRENT_ACCOUNT).trim(),
    cartao: String(input.cartao || '').trim()
  };

  if (!TYPES.includes(item.tipo)) throw badRequest('Tipo de lancamento invalido.');
  if (!item.descricao || item.descricao.length > 100) throw badRequest('Informe uma descricao valida.');
  if (item.valor <= 0) throw badRequest('O valor deve ser maior que zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.data)) throw badRequest('Data invalida.');
  if (!/^\d{4}-\d{2}$/.test(item.mesRef)) throw badRequest('Mes de referencia invalido.');
  if (!STATUSES.includes(item.status)) throw badRequest('Status invalido.');
  if (!item.categoria) throw badRequest('Informe a categoria.');
  if (!RESPONSIBLES.includes(item.responsavel)) throw badRequest('Responsavel invalido.');
  if (item.cartao && !['Leroy', 'Camicado'].includes(item.cartao)) throw badRequest('Cartao invalido.');
  if (sameLabel(item.categoria, 'Cartão de Crédito') && !item.cartao) throw badRequest('Informe o cartao Leroy ou Camicado.');
  if (!sameLabel(item.categoria, 'Cartão de Crédito') && item.cartao) throw badRequest('O cartao so pode ser informado na categoria Cartao de Credito.');
  if (item.parcelaAtual > item.totalParcelas) throw badRequest('A parcela atual excede o total.');
  if (item.status === 'Pago' && (!item.dataPg || isDeposit)) item.dataPg = item.data;
  return item;
}

function validateBox(input) {
  const box = {
    currentName: String(input.currentName || '').trim(),
    nome: String(input.nome || '').trim(),
    meta: parseMoney(input.meta)
  };
  if (!box.currentName) throw badRequest('Caixinha invalida.');
  if (!box.nome || box.nome.length > 60) throw badRequest('Informe um nome valido para a caixinha.');
  if (box.meta < 0) throw badRequest('A meta nao pode ser negativa.');
  return box;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function labelKey(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function boxNamesOf(boxes = []) {
  return new Set(boxes.map((box) => labelKey(box.nome)));
}

// Despesa paga com dinheiro de uma caixinha: mexe só no saldo da caixinha, não nas receitas e despesas do mês.
function isBoxExpense(item, boxNames) {
  return item.tipo === 'Despesa' && boxNames.has(labelKey(item.origem));
}

// Lançamentos que afetam a conta corrente, o fluxo de caixa e a análise. Gastos de caixinha ficam de fora.
function withoutBoxExpenses(transactions, boxes = []) {
  const boxNames = boxNamesOf(boxes);
  return transactions.filter((item) => !isBoxExpense(item, boxNames));
}

function summarize(transactions, boxes = [], boxTransactions = transactions) {
  const summary = {
    receitas: 0,
    despesas: 0,
    saldoPrevisto: 0,
    saldoAtual: 0,
    pendente: 0,
    aReceber: 0,
    aPagar: 0,
    categorias: {},
    caixinhas: boxes.map((box) => ({ ...box, saldo: 0, progresso: 0 }))
  };

  const boxNames = boxNamesOf(boxes);
  for (const item of transactions) {
    const isDeposit = item.tipo === 'Depósito' || item.tipo === 'Depósito Caixinha';
    const boxExpense = isBoxExpense(item, boxNames);
    if (item.tipo === 'Receita') summary.receitas += item.valor;
    if (item.tipo === 'Despesa' && !boxExpense) {
      summary.despesas += item.valor;
      const category = macroCategory(item.categoria);
      summary.categorias[category] = (summary.categorias[category] || 0) + item.valor;
    }
    if (item.tipo === 'Pagamento Fatura') {
      summary.despesas += item.valor;
      const category = macroCategory(item.categoria);
      summary.categorias[category] = (summary.categorias[category] || 0) + item.valor;
    }
    if (item.tipo === 'Estorno') {
      summary.despesas -= item.valor;
      const category = macroCategory(item.categoria);
      summary.categorias[category] = (summary.categorias[category] || 0) - item.valor;
    }
    if (item.status === 'Pendente' && !boxExpense) {
      summary.pendente += item.valor;
      if (item.tipo === 'Receita') summary.aReceber += item.valor;
      if (item.tipo === 'Despesa' || item.tipo === 'Pagamento Fatura') summary.aPagar += item.valor;
    }

    const effect = accountEffect(item);
    summary.saldoPrevisto += effect;
    if (item.status === 'Pago') summary.saldoAtual += effect;
  }

  for (const item of boxTransactions) {
    const isDeposit = item.tipo === 'Depósito' || item.tipo === 'Depósito Caixinha';
    const box = summary.caixinhas.find((entry) => sameLabel(entry.nome, item.origem) || (isDeposit && sameLabel(entry.nome, item.categoria)));
    if (!box) continue;
    if (isDeposit) box.saldo += item.valor;
    if (item.tipo === 'Resgate' || item.tipo === 'Despesa') box.saldo -= item.valor;
  }

  for (const box of summary.caixinhas) {
    box.progresso = box.meta > 0 ? Math.min(100, Math.max(0, (box.saldo / box.meta) * 100)) : 0;
  }
  return summary;
}

function accountEffect(item) {
  const source = item.fontePagamento || item.origem;
  const inCurrentAccount = source === CURRENT_ACCOUNT || source === 'Cartão de Crédito';
  if (!inCurrentAccount) return 0;
  if (item.tipo === 'Receita' || item.tipo === 'Resgate') return item.valor;
  if (item.tipo === 'Despesa' || item.tipo === 'Pagamento Fatura' || item.tipo === 'Depósito' || item.tipo === 'Depósito Caixinha') return -item.valor;
  return 0;
}

// Fluxo de caixa ancorado no saldo bancário atual: lançamentos já pagos estão nesse saldo,
// então só os pendentes entram na projeção. Pendências vencidas são aplicadas hoje.
// Movimento do mês no mesmo critério dos totais: receitas somam; despesas, pagamentos de fatura e estornos ajustam.
function monthEffect(item) {
  if (item.tipo === 'Receita' || item.tipo === 'Estorno') return Number(item.valor || 0);
  if (item.tipo === 'Despesa' || item.tipo === 'Pagamento Fatura') return -Number(item.valor || 0);
  return 0;
}

function monthDays(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const count = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

// Saldo acumulado do mês, começando em zero no dia 1: o último dia é receitas menos despesas.
function monthLedger(transactions, month) {
  const movements = new Map();
  for (const item of transactions) {
    if (!item.data || !item.data.startsWith(`${month}-`)) continue;
    movements.set(item.data, (movements.get(item.data) || 0) + monthEffect(item));
  }
  let balance = 0;
  return monthDays(month).map((date) => {
    const movement = movements.get(date) || 0;
    balance += movement;
    return { date, movement, balance };
  });
}

function calculateCashFlow(transactions, month) {
  const points = monthLedger(transactions, month);
  const negativePeriods = [];
  let negativeStart = null;
  let negativeMinimum = 0;
  for (const point of points) {
    if (point.balance < 0) {
      if (!negativeStart) negativeStart = point.date;
      negativeMinimum = negativeStart === point.date ? point.balance : Math.min(negativeMinimum, point.balance);
    }
    if (point.balance >= 0 && negativeStart) {
      negativePeriods.push({ start: negativeStart, end: previousDate(point.date), minimum: negativeMinimum });
      negativeStart = null;
    }
  }
  if (negativeStart) negativePeriods.push({ start: negativeStart, end: points.at(-1).date, minimum: negativeMinimum });
  return {
    openingBalance: 0,
    closingBalance: points.at(-1).balance,
    minimumBalance: Math.min(0, ...points.map((point) => point.balance)),
    negativePeriods,
    points
  };
}

// Ciclos entre receitas: cada ciclo começa na data de uma receita e termina um dia antes da próxima.
// Os ciclos cobrem só o mês, do dia 1 até o último dia.
function calculateCashCycles(transactions, month, { today = todayIso() } = {}) {
  if (month < today.slice(0, 7)) return { pastMonth: true, cycles: [], safeToSpend: null };
  const points = monthLedger(transactions, month);
  const balanceOn = new Map(points.map((point) => [point.date, point.balance]));
  const monthEnd = points.at(-1).date;
  const receipts = transactions
    .filter((item) => item.tipo === 'Receita' && item.data && item.data.startsWith(`${month}-`))
    .sort((a, b) => a.data.localeCompare(b.data));
  const boundaries = [...new Set([`${month}-01`, ...receipts.map((item) => item.data)])].sort();
  const cycles = boundaries.map((start, index) => {
    const end = boundaries[index + 1] ? previousDate(boundaries[index + 1]) : monthEnd;
    const days = points.filter((point) => point.date >= start && point.date <= end);
    const menorSaldo = Math.min(...days.map((point) => point.balance));
    const futureDays = days.filter((point) => point.date >= today);
    const livre = futureDays.length ? Math.min(...futureDays.map((point) => point.balance)) : menorSaldo;
    const compromissos = days.reduce((sum, point) => sum + Math.max(0, -point.movement), 0);
    const starter = receipts.find((item) => item.data === start);
    return {
      start, end,
      inicio: starter ? { descricao: starter.descricao, valor: starter.valor, status: starter.status } : null,
      saldoInicio: balanceOn.get(start),
      compromissos, saldoFim: balanceOn.get(end), menorSaldo, livre,
      status: menorSaldo < 0 ? 'falta' : 'ok', falta: Math.max(0, -menorSaldo)
    };
  });
  const current = cycles.find((cycle) => cycle.start <= today && today <= cycle.end);
  return { pastMonth: false, cycles, safeToSpend: current ? Math.max(0, current.livre) : null };
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Data de hoje no fuso de São Paulo, no formato AAAA-MM-DD.
function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function previousDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function buildAnalysis(transactions, selectedMonth, count = 3) {
  const months = recentMonths(selectedMonth, count).map((month) => {
    const expenses = transactions
      .filter((item) => item.mesRef === month && ['Despesa', 'Estorno', 'Pagamento Fatura'].includes(item.tipo))
      .map((item) => ({ ...item, valor: item.tipo === 'Estorno' ? -item.valor : item.valor }));
    return {
      month,
      total: expenses.reduce((sum, item) => sum + item.valor, 0),
      categories: groupCategoryValues(expenses),
      responsibles: groupValues(expenses, 'responsavel')
    };
  });
  return { months };
}

const SUPERSEDED_BILL_TOLERANCE = 5;

// Faturas de cartões conectados à Pluggy já chegam como PluggyFaturas; lançamentos manuais
// antigos com a mesma fatura (mesmo mês e valor) não podem somar de novo.
function withoutSupersededCardBills(manualTransactions, pluggyBills) {
  const officialBills = pluggyBills.filter((bill) => !bill.estimada);
  return manualTransactions.filter((item) => !isSupersededCardBill(item, officialBills));
}

function isSupersededCardBill(item, officialBills) {
  if (item.tipo !== 'Despesa' || item.categoria !== 'Cartão de Crédito') return false;
  if (['Leroy', 'Camicado'].includes(item.cartao)) return false;
  return officialBills.some((bill) => bill.mesRef === item.mesRef && Math.abs(bill.valor - item.valor) <= SUPERSEDED_BILL_TOLERANCE);
}

// Histórico de depósitos e resgates de uma caixinha, do mais recente para o mais antigo.
function boxHistory(transactions, name, limit = 36) {
  return transactions
    .filter((item) => {
      const isDeposit = item.tipo === 'Depósito' || item.tipo === 'Depósito Caixinha';
      if (isDeposit) return sameLabel(item.origem, name) || sameLabel(item.categoria, name);
      return ['Resgate', 'Despesa'].includes(item.tipo) && sameLabel(item.origem, name);
    })
    .map((item) => ({ data: item.data, descricao: item.descricao, tipo: item.tipo, valor: item.valor }))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))
    .slice(0, limit);
}

// Quanto está livre hoje: saldo em contas menos as contas ainda não pagas até o dia anterior à próxima receita.
// Contas já marcadas como pagas saíram do banco e por isso já estão no saldo.
function freeUntilNextIncome(transactions, anchorBalance, today = todayIso()) {
  const [year, monthNumber] = today.split('-').map(Number);
  const monthEnd = `${today.slice(0, 7)}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
  const nextIncome = transactions
    .filter((item) => item.tipo === 'Receita' && item.data && item.data > today)
    .map((item) => item.data)
    .sort()[0];
  const until = nextIncome ? previousDate(nextIncome) : monthEnd;
  const pending = transactions
    .filter((item) => item.status === 'Pendente' && item.data && item.data <= until && ['Despesa', 'Pagamento Fatura'].includes(item.tipo))
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);
  return { amount: anchorBalance - pending, pending, until, nextIncome: nextIncome || null };
}

// Projeção de uma caixinha: aporte médio dos meses com movimento e mês em que a meta é atingida.
function projectBox(transactions, box, month, lookback = 6) {
  const net = new Map(recentMonths(month, lookback).map((item) => [item, 0]));
  for (const item of transactions) {
    if (!net.has(item.mesRef)) continue;
    const isDeposit = item.tipo === 'Depósito' || item.tipo === 'Depósito Caixinha';
    const belongs = sameLabel(box.nome, item.origem) || (isDeposit && sameLabel(box.nome, item.categoria));
    if (!belongs) continue;
    if (isDeposit) net.set(item.mesRef, net.get(item.mesRef) + item.valor);
    if (item.tipo === 'Resgate' || item.tipo === 'Despesa') net.set(item.mesRef, net.get(item.mesRef) - item.valor);
  }
  const movements = [...net.values()].filter((value) => value !== 0);
  const monthlyAverage = movements.length ? movements.reduce((sum, value) => sum + value, 0) / movements.length : 0;
  const remaining = box.meta - box.saldo;
  if (remaining <= 0) return { monthlyAverage, status: 'reached' };
  if (monthlyAverage <= 0) return { monthlyAverage, status: 'no-contribution' };
  const monthsNeeded = Math.ceil(remaining / monthlyAverage);
  return { monthlyAverage, monthsNeeded, targetMonth: addMonthsTo(month, monthsNeeded), status: 'projected' };
}

function addMonthsTo(month, amount) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function recentMonths(month, count) {
  const [year, monthNumber] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function groupValues(items, field) {
  return items.reduce((groups, item) => {
    const key = item[field] || 'Sem categoria';
    groups[key] = (groups[key] || 0) + item.valor;
    return groups;
  }, {});
}

function groupCategoryValues(items) {
  return items.reduce((groups, item) => {
    const category = macroCategory(item.categoria);
    groups[category] = (groups[category] || 0) + item.valor;
    return groups;
  }, Object.fromEntries(MACRO_CATEGORIES.map((category) => [category, 0])));
}

function sameLabel(left, right) {
  return String(left || '').trim().toLocaleLowerCase('pt-BR') === String(right || '').trim().toLocaleLowerCase('pt-BR');
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function billSituation(month, status, referenceMonth = currentMonth()) {
  if (month === nextMonth(referenceMonth)) return 'Aberta';
  if (month > referenceMonth) return 'Projetada';
  return status === 'Pago' ? 'Paga' : 'Pendente';
}

function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function defaultCardResponsible(name) {
  const label = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (label.includes('santander')) return 'Ela';
  if (['nubank', 'ultraviolet', 'itau'].some((term) => label.includes(term))) return 'Ele';
  return 'Nós';
}

module.exports = { withoutBoxExpenses, isBoxExpense, freeUntilNextIncome, boxHistory, calculateCashCycles, todayIso, projectBox, normalizeTransaction, toSheetRow, validateTransaction, validateBox, summarize, calculateCashFlow, buildAnalysis, recentMonths, parseMoney, macroCategory, billSituation, currentMonth, nextMonth, defaultCardResponsible, withoutSupersededCardBills };
