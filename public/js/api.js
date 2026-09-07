import { session, clearSession } from './auth.js';
import { cacheGet, cacheSet, queueAdd, queueAll, queueDelete } from './storage.js';
import { demoData } from './demo.js';

async function request(path, options = {}) {
  const current = session();
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current?.token || ''}`, ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    clearSession();
    window.location.replace('/login');
    throw new Error('Sua sessão expirou.');
  }
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
  return body;
}

function demoSummary(transactions, boxes, boxTransactions = transactions) {
  const result = { receitas: 0, despesas: 0, saldoPrevisto: 0, saldoAtual: 0, pendente: 0, aReceber: 0, aPagar: 0, categorias: {}, caixinhas: boxes.map((box) => ({ ...box, saldo: 0, progresso: 0 })) };
  for (const item of transactions) {
    const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
    if (item.tipo === 'Receita') result.receitas += item.valor;
    if (item.tipo === 'Despesa') {
      result.despesas += item.valor;
      result.categorias[item.categoria] = (result.categorias[item.categoria] || 0) + item.valor;
    }
    if (item.status === 'Pendente') {
      result.pendente += item.valor;
      if (['Receita', 'Resgate'].includes(item.tipo)) result.aReceber += item.valor;
      if (item.tipo === 'Despesa') result.aPagar += item.valor;
    }
    const checking = ['Conta Corrente', 'Cartão de Crédito'].includes(item.origem);
    if (checking && item.tipo === 'Receita') result.saldoPrevisto += item.valor;
    if (checking && item.tipo === 'Despesa') result.saldoPrevisto -= item.valor;
    if (checking && isDeposit) result.saldoPrevisto -= item.valor;
    if (checking && item.tipo === 'Resgate') result.saldoPrevisto += item.valor;
    if (checking && item.status === 'Pago' && item.tipo === 'Receita') result.saldoAtual += item.valor;
    if (checking && item.status === 'Pago' && item.tipo === 'Despesa') result.saldoAtual -= item.valor;
    if (checking && item.status === 'Pago' && isDeposit) result.saldoAtual -= item.valor;
    if (checking && item.status === 'Pago' && item.tipo === 'Resgate') result.saldoAtual += item.valor;
  }
  for (const item of boxTransactions) {
    const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
    const box = result.caixinhas.find((entry) => sameLabel(entry.nome, item.origem) || (isDeposit && sameLabel(entry.nome, item.categoria)));
    if (!box) continue;
    if (isDeposit) box.saldo += item.valor;
    if (['Despesa', 'Resgate'].includes(item.tipo)) box.saldo -= item.valor;
  }
  result.caixinhas.forEach((box) => { box.progresso = box.meta ? Math.min(100, Math.max(0, box.saldo / box.meta * 100)) : 0; });
  return result;
}

function sameLabel(left, right) {
  return String(left || '').trim().toLocaleLowerCase('pt-BR') === String(right || '').trim().toLocaleLowerCase('pt-BR');
}

function demoState(month) {
  const saved = JSON.parse(localStorage.getItem('duofinance_demo_data') || 'null') || demoData();
  const transactions = saved.transactions.filter((item) => item.mesRef === month);
  return {
    ...saved,
    transactions,
    summary: demoSummary(transactions, saved.configuration.caixinhas, saved.transactions),
    cashFlow: demoCashFlow(saved.transactions, month),
    analysis: demoAnalysis(saved.transactions, month)
  };
}

function demoCashFlow(transactions, month) {
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const effect = (item) => {
    if (!['Conta Corrente', 'Cartão de Crédito'].includes(item.origem)) return 0;
    return ['Receita', 'Resgate'].includes(item.tipo) ? item.valor : ['Despesa', 'Depósito', 'Depósito Caixinha'].includes(item.tipo) ? -item.valor : 0;
  };
  let balance = transactions.filter((item) => item.data < monthStart).reduce((sum, item) => sum + effect(item), 0);
  const openingBalance = balance;
  const points = Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const movement = transactions.filter((item) => item.data === date).reduce((sum, item) => sum + effect(item), 0);
    balance += movement;
    return { date, movement, balance };
  });
  const negative = points.filter((point) => point.balance < 0);
  return { openingBalance, closingBalance: balance, minimumBalance: Math.min(...points.map((point) => point.balance)), negativePeriods: negative.length ? [{ start: negative[0].date, end: negative.at(-1).date }] : [], points };
}

function demoAnalysis(transactions, selectedMonth) {
  const [year, monthNumber] = selectedMonth.split('-').map(Number);
  const months = Array.from({ length: 3 }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 3 + index, 1));
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const expenses = transactions.filter((item) => item.mesRef === month && item.tipo === 'Despesa');
    const group = (field) => expenses.reduce((result, item) => ({ ...result, [item[field]]: (result[item[field]] || 0) + item.valor }), {});
    return { month, total: expenses.reduce((sum, item) => sum + item.valor, 0), categories: group('categoria'), responsibles: group('responsavel') };
  });
  return { months };
}

export async function getFinances(month) {
  if (session()?.demo) return demoState(month);
  const key = `finances:${month}`;
  try {
    const data = await request(`/api/financas?mes=${encodeURIComponent(month)}`);
    await cacheSet(key, data);
    return data;
  } catch (error) {
    const cached = await cacheGet(key);
    if (cached) return { ...cached, offline: true };
    throw error;
  }
}

export async function getCards(month) {
  if (session()?.demo) return { configured: false, items: [], cards: [], transactions: [], bankBalance: 0 };
  return request(`/api/pluggy/cards?mes=${encodeURIComponent(month)}`);
}

export async function syncPluggy(itemId) {
  if (session()?.demo) return { synced: false };
  return request('/api/pluggy/sync', { method: 'POST', body: JSON.stringify(itemId ? { itemId } : {}) });
}

export async function updateBillStatus(id, status) {
  if (session()?.demo) return { demo: true };
  return request('/api/financas', { method: 'POST', body: JSON.stringify({ action: 'updateBillStatus', id, status }) });
}

export async function mutate(action, transaction) {
  const payload = { action, ...(action === 'delete' ? { id: transaction.id } : { transaction }) };
  if (session()?.demo) {
    const saved = JSON.parse(localStorage.getItem('duofinance_demo_data') || 'null') || demoData();
    if (action === 'create') saved.transactions.push({ ...transaction, id: crypto.randomUUID() });
    if (action === 'update') saved.transactions = saved.transactions.map((item) => item.id === transaction.id ? transaction : item);
    if (action === 'delete') saved.transactions = saved.transactions.filter((item) => item.id !== transaction.id);
    localStorage.setItem('duofinance_demo_data', JSON.stringify(saved));
    return { demo: true };
  }
  try {
    return await request('/api/financas', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError) {
      await queueAdd({ payload, token: session()?.token, createdAt: Date.now() });
      navigator.serviceWorker?.ready.then((registration) => registration.sync?.register('sync-finances')).catch(() => {});
      return { queued: true };
    }
    throw error;
  }
}

export async function updateBox(box) {
  const payload = { action: 'updateBox', box };
  if (session()?.demo) {
    const saved = JSON.parse(localStorage.getItem('duofinance_demo_data') || 'null') || demoData();
    const duplicate = saved.configuration.caixinhas.some((item) => sameLabel(item.nome, box.nome) && !sameLabel(item.nome, box.currentName));
    if (duplicate) throw new Error('Já existe uma caixinha com esse nome.');
    saved.configuration.caixinhas = saved.configuration.caixinhas.map((item) => sameLabel(item.nome, box.currentName) ? { ...item, nome: box.nome, meta: box.meta } : item);
    if (box.currentName !== box.nome) {
      saved.transactions = saved.transactions.map((item) => ({
        ...item,
        categoria: ['Depósito', 'Depósito Caixinha'].includes(item.tipo) && sameLabel(item.categoria, box.currentName) ? box.nome : item.categoria,
        origem: sameLabel(item.origem, box.currentName) ? box.nome : item.origem
      }));
    }
    localStorage.setItem('duofinance_demo_data', JSON.stringify(saved));
    return { demo: true };
  }
  try {
    return await request('/api/financas', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError) {
      await queueAdd({ payload, token: session()?.token, createdAt: Date.now() });
      navigator.serviceWorker?.ready.then((registration) => registration.sync?.register('sync-finances')).catch(() => {});
      return { queued: true };
    }
    throw error;
  }
}

export async function syncQueue() {
  if (!navigator.onLine || session()?.demo) return 0;
  const queued = await queueAll();
  let completed = 0;
  for (const item of queued) {
    try {
      await request('/api/financas', { method: 'POST', body: JSON.stringify(item.payload) });
      await queueDelete(item.queueId);
      completed++;
    } catch {
      break;
    }
  }
  return completed;
}

export async function analyze(month) {
  if (session()?.demo) {
    const data = demoState(month);
    const largest = Object.entries(data.summary.categorias).sort((a, b) => b[1] - a[1])[0];
    return { insight: largest ? `Vocês já deram um passo importante: estão olhando juntos para os números. ${largest[0]} foi a maior categoria de despesa neste mês. Que tal escolherem hoje um único gasto dessa categoria para ajustar na próxima semana?` : 'Este mês está leve e pronto para ser planejado. Que tal definirem juntos uma pequena meta para a primeira caixinha?' };
  }
  return request('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ mes: month }) });
}
