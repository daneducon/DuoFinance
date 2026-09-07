'use strict';

const TYPES = ['Receita', 'Despesa', 'Estorno', 'Pagamento Fatura', 'Depósito', 'Depósito Caixinha', 'Resgate'];
const STATUSES = ['Pago', 'Pendente'];
const RESPONSIBLES = ['Ele', 'Ela', 'Nós'];
const CURRENT_ACCOUNT = 'Conta Corrente';

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
    origem: String(row[14] || CURRENT_ACCOUNT).trim()
  };
}

function toSheetRow(item) {
  return [
    item.id, item.tipo, item.descricao, item.valor, item.data, item.dataPg || '', item.mesRef,
    item.status, item.categoria, item.responsavel, item.parcelaAtual, item.totalParcelas,
    item.idParcelamento || '', item.recorrente ? 'VERDADEIRO' : 'FALSO', item.origem
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
    origem: String(input.origem || CURRENT_ACCOUNT).trim()
  };

  if (!TYPES.includes(item.tipo)) throw badRequest('Tipo de lancamento invalido.');
  if (!item.descricao || item.descricao.length > 100) throw badRequest('Informe uma descricao valida.');
  if (item.valor <= 0) throw badRequest('O valor deve ser maior que zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.data)) throw badRequest('Data invalida.');
  if (!/^\d{4}-\d{2}$/.test(item.mesRef)) throw badRequest('Mes de referencia invalido.');
  if (!STATUSES.includes(item.status)) throw badRequest('Status invalido.');
  if (!item.categoria) throw badRequest('Informe a categoria.');
  if (!RESPONSIBLES.includes(item.responsavel)) throw badRequest('Responsavel invalido.');
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

  for (const item of transactions) {
    const isDeposit = item.tipo === 'Depósito' || item.tipo === 'Depósito Caixinha';
    if (item.tipo === 'Receita') summary.receitas += item.valor;
    if (item.tipo === 'Despesa') {
      summary.despesas += item.valor;
      summary.categorias[item.categoria] = (summary.categorias[item.categoria] || 0) + item.valor;
    }
    if (item.tipo === 'Estorno') {
      summary.despesas -= item.valor;
      summary.categorias[item.categoria] = (summary.categorias[item.categoria] || 0) - item.valor;
    }
    if (item.status === 'Pendente') {
      summary.pendente += item.valor;
      if (item.tipo === 'Receita' || item.tipo === 'Resgate') summary.aReceber += item.valor;
      if (item.tipo === 'Despesa') summary.aPagar += item.valor;
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

function calculateCashFlow(transactions, month) {
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  let balance = transactions
    .filter((item) => item.data && item.data < monthStart)
    .reduce((total, item) => total + accountEffect(item), 0);
  const openingBalance = balance;
  const points = [];
  const negativePeriods = [];
  let negativeStart = null;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const movement = transactions
      .filter((item) => item.data === date)
      .reduce((total, item) => total + accountEffect(item), 0);
    balance += movement;
    points.push({ date, balance, movement });
    if (balance < 0 && !negativeStart) negativeStart = date;
    if (balance >= 0 && negativeStart) {
      negativePeriods.push({ start: negativeStart, end: previousDate(date) });
      negativeStart = null;
    }
  }
  if (negativeStart) negativePeriods.push({ start: negativeStart, end: `${month}-${daysInMonth}` });

  return {
    openingBalance,
    closingBalance: balance,
    minimumBalance: Math.min(...points.map((point) => point.balance)),
    negativePeriods,
    points
  };
}

function previousDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function buildAnalysis(transactions, selectedMonth) {
  const months = recentMonths(selectedMonth, 3).map((month) => {
    const expenses = transactions
      .filter((item) => item.mesRef === month && ['Despesa', 'Estorno'].includes(item.tipo))
      .map((item) => ({ ...item, valor: item.tipo === 'Estorno' ? -item.valor : item.valor }));
    return {
      month,
      total: expenses.reduce((sum, item) => sum + item.valor, 0),
      categories: groupValues(expenses, 'categoria'),
      responsibles: groupValues(expenses, 'responsavel')
    };
  });
  return { months };
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

function sameLabel(left, right) {
  return String(left || '').trim().toLocaleLowerCase('pt-BR') === String(right || '').trim().toLocaleLowerCase('pt-BR');
}

module.exports = { normalizeTransaction, toSheetRow, validateTransaction, validateBox, summarize, calculateCashFlow, buildAnalysis, parseMoney };
