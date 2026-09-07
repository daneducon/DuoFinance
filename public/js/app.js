import { requireSession, clearSession } from './auth.js';
import { getFinances, getCards, createPluggyConnectToken, syncPluggy, mutate, updateBox, analyze, syncQueue } from './api.js';

const currentSession = requireSession();
const state = {
  transactions: [], configuration: { categorias: [], responsaveis: [], caixinhas: [] },
  summary: null, cashFlow: null, analysis: { months: [] }, boxBase: {},
  transactionFilter: 'all', search: '', analysisFilter: 'all', cardsData: { items: [], cards: [], transactions: [], bankBalance: 0 }, selectedCardId: 'all'
};
const elements = {
  month: document.querySelector('#month-picker'), dialog: document.querySelector('#transaction-dialog'),
  form: document.querySelector('#transaction-form'), list: document.querySelector('#transaction-list'),
  boxes: document.querySelector('#box-grid'), chart: document.querySelector('#category-chart'),
  chartEmpty: document.querySelector('#chart-empty'), toast: document.querySelector('#toast'),
  offline: document.querySelector('#offline-banner'), insight: document.querySelector('#insight-text')
};
elements.boxDialog = document.querySelector('#box-dialog');
elements.boxForm = document.querySelector('#box-form');
const tabs = { general: 'Visão geral', transactions: 'Lançamentos', analysis: 'Análises', boxes: 'Caixinhas', cards: 'Cartões' };

elements.month.value = new Date().toISOString().slice(0, 7);
updateMonthLabel();
document.querySelector('#user-email').textContent = currentSession?.user?.email || 'Conta compartilhada';
document.querySelector('#greeting').textContent = greeting();

document.querySelectorAll('[data-open-form]').forEach((button) => button.addEventListener('click', () => openForm()));
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => elements.dialog.close()));
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelectorAll('[data-go-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.goTab)));
document.querySelector('#logout-button').addEventListener('click', () => { clearSession(); window.location.assign('/login'); });
document.querySelector('#analyze-button').addEventListener('click', generateInsight);
document.querySelector('#connect-pluggy-button').addEventListener('click', connectPluggy);
document.querySelector('#sync-pluggy-button').addEventListener('click', synchronizePluggy);
document.querySelector('#connected-card-grid').addEventListener('click', selectCard);
document.querySelector('#transaction-search').addEventListener('input', (event) => { state.search = event.target.value; renderTransactions(); });
document.querySelector('#transaction-filters').addEventListener('click', handleFilter);
document.querySelector('#analysis-filters').addEventListener('click', handleAnalysisFilter);
elements.month.addEventListener('change', () => { updateMonthLabel(); load(); });
document.querySelector('#previous-month').addEventListener('click', () => shiftMonth(-1));
document.querySelector('#next-month').addEventListener('click', () => shiftMonth(1));
elements.form.addEventListener('submit', saveTransaction);
elements.boxForm.addEventListener('submit', saveBox);
elements.form.elements.tipo.addEventListener('change', enforceDepositStatus);
elements.list.addEventListener('click', handleTransactionAction);
elements.boxes.addEventListener('click', handleBoxAction);
elements.dialog.addEventListener('click', (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
elements.boxDialog.addEventListener('click', (event) => { if (event.target === elements.boxDialog) elements.boxDialog.close(); });
document.querySelectorAll('[data-close-box-dialog]').forEach((button) => button.addEventListener('click', () => elements.boxDialog.close()));
window.addEventListener('hashchange', () => switchTab(location.hash.slice(1), false));
window.addEventListener('online', async () => {
  updateConnectivity();
  const count = 'SyncManager' in window ? 0 : await syncQueue();
  if (count) { notify(`${count} alteração(ões) sincronizada(s).`); load(); }
});
window.addEventListener('offline', updateConnectivity);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'FINANCES_SYNCED') { notify('Alterações offline sincronizadas.'); load(); }
  });
  navigator.serviceWorker.register('/sw.js');
}

switchTab(location.hash.slice(1) || 'general', false);
updateConnectivity();
load();

async function load() {
  setLoading(true);
  try {
    const data = await getFinances(elements.month.value);
    const cardsData = await getCards(elements.month.value).catch((error) => ({ error: error.message, items: [], cards: [], transactions: [], bankBalance: 0 }));
    state.transactions = data.transactions || [];
    state.configuration = data.configuration || state.configuration;
    state.summary = data.summary || calculateSummary();
    state.cashFlow = data.cashFlow || calculateLocalCashFlow();
    state.analysis = data.analysis || { months: [] };
    state.cardsData = cardsData;
    state.boxBase = calculateBoxBase(state.summary.caixinhas || [], state.transactions);
    render();
    if (data.offline) notify('Exibindo os últimos dados salvos.');
  } catch (error) {
    notify(error.message, true);
    state.transactions = [];
    state.summary = calculateSummary();
    render();
  } finally {
    setLoading(false);
  }
}

function render() {
  const summary = state.summary || calculateSummary();
  document.querySelector('#forecast-balance').textContent = money(summary.saldoPrevisto);
  document.querySelector('#income-total').textContent = money(summary.receitas);
  document.querySelector('#expense-total').textContent = money(summary.despesas);
  document.querySelector('#receivable-total').textContent = money(summary.aReceber);
  document.querySelector('#payable-total').textContent = money(summary.aPagar);
  document.querySelector('#balance-note').textContent = balanceMessage(summary.saldoPrevisto);
  renderCashFlow();
  renderCategoryChart(summary);
  renderBoxes(summary.caixinhas || []);
  renderTransactions();
  renderAnalysis();
  renderCards();
  populateSelects();
}

function switchTab(tab, updateHash = true) {
  const selected = tabs[tab] ? tab : 'general';
  document.querySelectorAll('[data-view]').forEach((view) => view.classList.toggle('active', view.dataset.view === selected));
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === selected));
  document.querySelector('#page-title').textContent = tabs[selected];
  if (updateHash) history.replaceState(null, '', `#${selected}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shiftMonth(direction) {
  const [year, month] = elements.month.value.split('-').map(Number);
  const date = new Date(year, month - 1 + direction, 1);
  elements.month.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  updateMonthLabel();
  load();
}

function updateMonthLabel() {
  if (!elements.month.value) return;
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(`${elements.month.value}-01T12:00:00`));
  document.querySelector('#month-label').textContent = label.replace(/^./, (letter) => letter.toUpperCase());
}

function renderCashFlow() {
  const cashFlow = state.cashFlow;
  const chart = document.querySelector('#cashflow-chart');
  const badge = document.querySelector('#cashflow-risk');
  const summary = document.querySelector('#cashflow-summary');
  if (!cashFlow?.points?.length) {
    chart.innerHTML = '<div class="empty-state"><p>Fluxo indisponível.</p></div>';
    return;
  }
  const values = cashFlow.points.map((point) => point.balance);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const coordinates = cashFlow.points.map((point, index) => {
    const x = 20 + index / Math.max(1, cashFlow.points.length - 1) * 960;
    const y = 220 - (point.balance - minimum) / range * 190;
    return `${x},${y}`;
  }).join(' ');
  const zeroY = 220 - (0 - minimum) / range * 190;
  chart.innerHTML = `<svg viewBox="0 0 1000 250" role="img" aria-label="Evolução diária do saldo"><line x1="20" y1="${zeroY}" x2="980" y2="${zeroY}" class="zero-line"/><polyline points="${coordinates}" class="cash-line"/><text x="20" y="244">01</text><text x="930" y="244">${cashFlow.points.length}</text></svg>`;
  const hasRisk = cashFlow.negativePeriods.length > 0;
  badge.textContent = hasRisk ? 'Atenção necessária' : 'Mês protegido';
  badge.className = `risk-badge ${hasRisk ? 'danger' : 'safe'}`;
  const periods = cashFlow.negativePeriods.map((period) => `${shortDate(period.start)} a ${shortDate(period.end)}`).join(', ');
  summary.innerHTML = `<div><span>Saldo inicial</span><strong>${money(cashFlow.openingBalance)}</strong></div><div><span>Menor saldo</span><strong class="${cashFlow.minimumBalance < 0 ? 'negative' : ''}">${money(cashFlow.minimumBalance)}</strong></div><div><span>Fechamento previsto</span><strong>${money(cashFlow.closingBalance)}</strong></div><p>${hasRisk ? `Risco de saldo negativo: <strong>${periods}</strong>.` : 'Nenhum intervalo negativo previsto para este mês.'}</p>`;
}

function renderCategoryChart(summary) {
  const categories = Object.entries(summary.categorias || {}).filter((entry) => entry[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const total = Object.values(summary.categorias || {}).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  elements.chart.hidden = categories.length === 0;
  elements.chartEmpty.hidden = categories.length > 0;
  elements.chart.innerHTML = categories.map(([name, value]) => `<div class="responsible-row"><div><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><span>${Math.round(value / total * 100)}% · ${money(value)}</span></div><div class="bar-track"><div class="bar" style="width:${value / total * 100}%"></div></div></div>`).join('');
  const expenses = state.transactions.filter((item) => item.tipo === 'Despesa').length;
  document.querySelector('#expense-count').textContent = `${expenses} ${expenses === 1 ? 'lançamento' : 'lançamentos'}`;
}

function renderBoxes(boxes) {
  document.querySelector('#boxes-total').textContent = money(boxes.reduce((sum, box) => sum + box.saldo, 0));
  const card = (box) => `<article class="box-card"><div class="box-card-head"><span class="box-money-icon">${iconSvg('money')}</span><div class="box-card-actions"><small>${Math.round(box.progresso || 0)}%</small><button class="action-button edit" data-edit-box="${escapeHtml(box.nome)}" title="Editar caixinha" aria-label="Editar caixinha ${escapeHtml(box.nome)}">${iconSvg('edit')}</button></div></div><h3>${escapeHtml(box.nome)}</h3><p>${money(box.saldo)} guardados</p><div class="progress"><span style="width:${box.progresso || 0}%"></span></div><div class="box-meta"><span>Meta</span><strong>${money(box.meta)}</strong></div></article>`;
  elements.boxes.innerHTML = boxes.length ? boxes.map(card).join('') : '<div class="empty-state panel"><p>Nenhuma caixinha configurada.</p></div>';
  const favorites = boxes.filter((box) => box.favorito).slice(0, 4);
  document.querySelector('#favorite-box-list').innerHTML = favorites.length ? favorites.map((box) => `<div class="mini-box"><div><strong>${escapeHtml(box.nome)}</strong><span>${Math.round(box.progresso)}%</span></div><div class="progress"><span style="width:${box.progresso}%"></span></div><small>${money(box.saldo)} de ${money(box.meta)}</small></div>`).join('') : '<p class="muted-copy">Nenhuma favorita configurada.</p>';
}

function handleBoxAction(event) {
  const name = event.target.closest('[data-edit-box]')?.dataset.editBox;
  if (!name) return;
  const box = state.configuration.caixinhas.find((item) => item.nome === name);
  if (!box) return;
  elements.boxForm.elements.currentName.value = box.nome;
  elements.boxForm.elements.nome.value = box.nome;
  elements.boxForm.elements.meta.value = box.meta;
  elements.boxDialog.showModal();
  setTimeout(() => elements.boxForm.elements.nome.focus(), 0);
}

async function saveBox(event) {
  event.preventDefault();
  const form = new FormData(elements.boxForm);
  const box = { currentName: form.get('currentName').trim(), nome: form.get('nome').trim(), meta: Number(form.get('meta')) };
  const button = document.querySelector('#save-box-button');
  button.disabled = true;
  try {
    const result = await updateBox(box);
    elements.boxDialog.close();
    if (result.queued) {
      applyLocalBox(box);
      notify('Alteração salva para sincronizar depois.');
    } else {
      notify('Caixinha atualizada.');
      await load();
    }
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

function applyLocalBox(box) {
  state.configuration.caixinhas = state.configuration.caixinhas.map((item) => sameLabel(item.nome, box.currentName) ? { ...item, nome: box.nome, meta: box.meta } : item);
  state.transactions = state.transactions.map((item) => ({
    ...item,
    categoria: ['Depósito', 'Depósito Caixinha'].includes(item.tipo) && sameLabel(item.categoria, box.currentName) ? box.nome : item.categoria,
    origem: sameLabel(item.origem, box.currentName) ? box.nome : item.origem
  }));
  if (box.currentName !== box.nome) {
    state.boxBase[box.nome] = state.boxBase[box.currentName] || 0;
    delete state.boxBase[box.currentName];
  }
  state.summary = calculateSummary();
  render();
}

function renderTransactions() {
  const query = normalize(state.search);
  const filtered = state.transactions.filter((item) => {
    const matchesSearch = !query || normalize(`${item.descricao} ${item.categoria} ${item.responsavel}`).includes(query);
    const matchesType = state.transactionFilter === 'all' || item.tipo === state.transactionFilter || (state.transactionFilter === 'boxes' && ['Depósito', 'Depósito Caixinha', 'Resgate'].includes(item.tipo));
    return matchesSearch && matchesType;
  }).sort((a, b) => a.data.localeCompare(b.data) || (a.ordem || 0) - (b.ordem || 0));
  document.querySelector('#transaction-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'itens'} no período`;
  elements.list.innerHTML = filtered.length ? filtered.map((item) => {
    const positive = ['Receita', 'Resgate', 'Estorno'].includes(item.tipo);
    const deposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
    const imported = item.fonte === 'pluggy';
    const valueClass = deposit ? 'deposit' : positive ? 'income-value' : 'expense-value';
    const paid = item.status === 'Pago';
    return `<article class="detailed-transaction ${paid ? '' : 'pending-row'} ${imported ? 'imported-row' : ''}"><button class="status-toggle ${paid ? 'paid' : ''}" ${imported || deposit ? 'disabled' : `data-status="${escapeHtml(item.id)}"`} title="${imported ? 'Status sincronizado pela instituição' : deposit ? 'Depósitos são sempre pagos' : `Marcar como ${paid ? 'pendente' : 'pago'}`}">${paid ? iconSvg('check') : ''}</button><div class="transaction-info"><strong>${escapeHtml(item.descricao)}</strong><div class="transaction-meta"><time datetime="${escapeHtml(item.data)}">${fullDate(item.data)}</time><span>·</span><span>${escapeHtml(item.categoria)}</span>${imported ? '<span class="source-tag">Pluggy</span>' : ''}</div></div><div class="transaction-value ${valueClass}">${positive || deposit ? '+' : '−'} ${money(item.valor)}</div><div class="transaction-status"><span class="status-pill ${paid ? 'paid' : 'pending'}">${paid ? iconSvg('check') : ''}${escapeHtml(item.status)}</span>${paid ? `<span class="paid-origin">${escapeHtml(item.origem)}</span>` : ''}</div>${imported ? '<div class="transaction-actions synced-lock">Sincronizado</div>' : `<div class="transaction-actions"><button class="action-button edit" data-edit="${escapeHtml(item.id)}" title="Editar valor e detalhes" aria-label="Editar ${escapeHtml(item.descricao)}">${iconSvg('edit')}<span>Editar</span></button><button class="action-button delete" data-delete="${escapeHtml(item.id)}" title="Excluir lançamento" aria-label="Excluir ${escapeHtml(item.descricao)}">${iconSvg('trash')}<span>Excluir</span></button></div>`}</article>`;
  }).join('') : '<div class="empty-state panel"><span>↕</span><p>Nenhum lançamento encontrado.</p></div>';
}

function renderCards() {
  const data = state.cardsData || {};
  const cards = data.cards || [];
  document.querySelector('#bank-balance').textContent = money(data.bankBalance || 0);
  document.querySelector('#credit-limit-total').textContent = money(cards.reduce((sum, card) => sum + card.creditLimit, 0));
  document.querySelector('#credit-limit-used').textContent = money(cards.reduce((sum, card) => sum + card.usedLimit, 0));
  document.querySelector('#credit-limit-available').textContent = money(cards.reduce((sum, card) => sum + card.availableLimit, 0));
  const status = document.querySelector('#pluggy-status');
  status.textContent = data.error || (data.items?.length ? `${data.items.length} instituição(ões) conectada(s). Dados atualizados automaticamente.` : 'Conecte uma instituição para sincronizar seus dados.');
  status.classList.toggle('error-copy', Boolean(data.error));
  const grid = document.querySelector('#connected-card-grid');
  grid.innerHTML = cards.length ? cards.map((card, index) => {
    const used = card.creditLimit ? Math.min(100, card.usedLimit / card.creditLimit * 100) : 0;
    const active = state.selectedCardId === card.id;
    return `<button class="connected-card card-tone-${index % 3} ${active ? 'active' : ''}" data-card-id="${escapeHtml(card.id)}"><span class="card-brand">${escapeHtml(card.brand || 'CARTÃO')}</span><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.institution)} · ${escapeHtml(card.number)}</small><div class="card-limit"><span>Usado ${money(card.usedLimit)}</span><span>${Math.round(used)}%</span></div><div class="progress"><span style="width:${used}%"></span></div><span class="card-available">${money(card.availableLimit)} disponível</span></button>`;
  }).join('') : '<div class="empty-state panel"><p>Nenhum cartão conectado.</p></div>';
  renderCardTransactions();
}

function renderCardTransactions() {
  const selected = state.cardsData.cards?.find((card) => card.id === state.selectedCardId);
  const transactions = (state.cardsData.transactions || []).filter((item) => !selected || item.accountId === selected.id).sort((a, b) => a.data.localeCompare(b.data) || (a.ordem || 0) - (b.ordem || 0));
  document.querySelector('#selected-card-title').textContent = selected ? `Gastos em ${selected.name}` : 'Gastos nos cartões';
  const total = transactions.reduce((sum, item) => sum + (item.tipo === 'Estorno' ? -item.valor : item.valor), 0);
  document.querySelector('#card-expense-total').textContent = money(total);
  document.querySelector('#card-transaction-list').innerHTML = transactions.length ? transactions.map((item) => `<div class="card-transaction"><div><strong>${escapeHtml(item.descricao)}</strong><span>${fullDate(item.data)} · ${escapeHtml(item.categoria)}</span></div><strong class="${item.tipo === 'Estorno' ? 'income-value' : 'expense-value'}">${item.tipo === 'Estorno' ? '+' : '−'} ${money(item.valor)}</strong></div>`).join('') : '<p class="muted-copy">Nenhum gasto encontrado neste mês.</p>';
}

function selectCard(event) {
  const id = event.target.closest('[data-card-id]')?.dataset.cardId;
  if (!id) return;
  state.selectedCardId = state.selectedCardId === id ? 'all' : id;
  renderCards();
}

async function connectPluggy() {
  const button = document.querySelector('#connect-pluggy-button');
  button.disabled = true;
  try {
    if (!window.PluggyConnect) throw new Error('O conector bancário não foi carregado.');
    const { accessToken } = await createPluggyConnectToken();
    new window.PluggyConnect({
      connectToken: accessToken, products: ['ACCOUNTS', 'CREDIT_CARDS', 'TRANSACTIONS'], countries: ['BR'], language: 'pt', theme: 'dark',
      onSuccess: async (data) => {
        try {
          notify('Instituição conectada. A sincronização continuará em segundo plano.');
          await new Promise((resolve) => setTimeout(resolve, 2500));
          await load();
        } catch (error) { notify(error.message, true); }
      },
      onError: (error) => { button.disabled = false; notify(error?.message || 'Não foi possível conectar a instituição.', true); },
      onClose: () => { button.disabled = false; }
    }).init();
  } catch (error) { button.disabled = false; notify(error.message, true); }
}

async function synchronizePluggy() {
  const button = document.querySelector('#sync-pluggy-button');
  button.disabled = true;
  try { await syncPluggy(); await load(); notify('Dados bancários sincronizados.'); }
  catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

function renderAnalysis() {
  const months = state.analysis.months || [];
  const categories = [...new Set(months.flatMap((month) => Object.keys(month.categories || {})))].sort();
  const filters = document.querySelector('#analysis-filters');
  filters.innerHTML = [`<button data-analysis-filter="all" class="${state.analysisFilter === 'all' ? 'active' : ''}">Geral</button>`, ...categories.map((category) => `<button data-analysis-filter="${escapeHtml(category)}" class="${state.analysisFilter === category ? 'active' : ''}">${escapeHtml(category)}</button>`)].join('');
  document.querySelector('#analysis-filter-label').textContent = state.analysisFilter === 'all' ? 'Todos os gastos' : state.analysisFilter;
  const values = months.map((month) => state.analysisFilter === 'all' ? month.total : (month.categories?.[state.analysisFilter] || 0));
  const maximum = Math.max(...values, 1);
  document.querySelector('#trend-chart').innerHTML = months.map((month, index) => `<div class="trend-column"><strong>${money(values[index])}</strong><div><span style="height:${Math.max(3, values[index] / maximum * 100)}%;--bar:${Math.max(3, values[index] / maximum * 100)}%"></span></div><small>${monthLabel(month.month)}</small></div>`).join('') || '<div class="empty-state"><p>Histórico indisponível.</p></div>';
  const current = values.at(-1) || 0;
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  document.querySelector('#trend-metrics').innerHTML = `<div><span>Mês atual</span><strong>${money(current)}</strong></div><div><span>Média trimestral</span><strong>${money(average)}</strong></div><div><span>Maior mês</span><strong>${money(Math.max(...values, 0))}</strong></div>`;
  const responsibles = Object.entries(months.at(-1)?.responsibles || {}).sort((a, b) => b[1] - a[1]);
  const responsibleTotal = responsibles.reduce((sum, entry) => sum + entry[1], 0) || 1;
  document.querySelector('#responsible-chart').innerHTML = responsibles.map(([name, value]) => `<div class="responsible-row"><div><strong>${responsibleName(name)}</strong><span>${Math.round(value / responsibleTotal * 100)}% · ${money(value)}</span></div><div class="bar-track"><div class="bar" style="width:${value / responsibleTotal * 100}%"></div></div></div>`).join('') || '<p class="muted-copy">Sem despesas no período.</p>';
}

function handleFilter(event) {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.transactionFilter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
  renderTransactions();
}

function handleAnalysisFilter(event) {
  const button = event.target.closest('[data-analysis-filter]');
  if (!button) return;
  state.analysisFilter = button.dataset.analysisFilter;
  renderAnalysis();
}

function populateSelects() {
  const categorySelect = document.querySelector('#category-select');
  const currentCategory = categorySelect.value;
  const categories = state.configuration.categorias.length ? state.configuration.categorias : ['Alimentação', 'Lazer', 'Moradia', 'Renda', 'Saúde', 'Transporte'];
  categorySelect.innerHTML = categories.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
  if (categories.includes(currentCategory)) categorySelect.value = currentCategory;
  const originSelect = document.querySelector('#origin-select');
  const currentOrigin = originSelect.value;
  const origins = ['Conta Corrente', 'Cartão de Crédito', 'Externo', ...state.configuration.caixinhas.map((box) => box.nome)];
  originSelect.innerHTML = origins.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
  if (origins.includes(currentOrigin)) originSelect.value = currentOrigin;
}

function openForm(transaction = null) {
  if (transaction?.fonte === 'pluggy') return notify('Este lançamento é atualizado automaticamente pela instituição.', true);
  elements.form.reset();
  populateSelects();
  document.querySelector('#dialog-title').textContent = transaction ? 'Editar lançamento' : 'Novo lançamento';
  if (transaction) {
    for (const [key, value] of Object.entries(transaction)) {
      const field = elements.form.elements.namedItem(key);
      if (!field) continue;
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else field.value = value;
    }
  } else {
    const lastDay = new Date(Number(elements.month.value.slice(0, 4)), Number(elements.month.value.slice(5, 7)), 0).getDate();
    elements.form.elements.data.value = `${elements.month.value}-${String(Math.min(new Date().getDate(), lastDay)).padStart(2, '0')}`;
    elements.form.elements.responsavel.value = 'Nós';
  }
  enforceDepositStatus();
  elements.dialog.showModal();
  setTimeout(() => elements.form.elements.descricao.focus(), 0);
}

async function saveTransaction(event) {
  event.preventDefault();
  const form = new FormData(elements.form);
  const existingId = String(form.get('id') || '');
  const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(form.get('tipo'));
  const status = isDeposit ? 'Pago' : form.get('status');
  const transaction = {
    id: existingId, tipo: form.get('tipo'), descricao: form.get('descricao').trim(), valor: Number(form.get('valor')),
    data: form.get('data'), dataPg: status === 'Pago' ? form.get('data') : '', mesRef: form.get('data').slice(0, 7),
    status, categoria: form.get('categoria'), responsavel: form.get('responsavel'), parcelaAtual: 1, totalParcelas: 1,
    idParcelamento: '', recorrente: form.get('recorrente') === 'on', origem: form.get('origem')
  };
  const action = existingId ? 'update' : 'create';
  const saveButton = document.querySelector('#save-button');
  saveButton.disabled = true;
  try {
    const result = await mutate(action, transaction);
    elements.dialog.close();
    if (result.queued) {
      transaction.id ||= `offline-${Date.now()}`;
      applyLocal(action, transaction);
      notify('Alteração salva para sincronizar depois.');
    } else {
      notify(action === 'create' ? 'Lançamento adicionado.' : 'Lançamento atualizado.');
      await load();
    }
  } catch (error) { notify(error.message, true); }
  finally { saveButton.disabled = false; }
}

function enforceDepositStatus() {
  const deposit = ['Depósito', 'Depósito Caixinha'].includes(elements.form.elements.tipo.value);
  const status = elements.form.elements.status;
  if (deposit) status.value = 'Pago';
  status.disabled = deposit;
  status.title = deposit ? 'Depósitos são sempre registrados como pagos.' : '';
}

async function handleTransactionAction(event) {
  const editId = event.target.closest('[data-edit]')?.dataset.edit;
  const deleteId = event.target.closest('[data-delete]')?.dataset.delete;
  const statusId = event.target.closest('[data-status]')?.dataset.status;
  if (editId) return openForm(state.transactions.find((item) => item.id === editId));
  if (statusId) return toggleStatus(statusId, event.target.closest('[data-status]'));
  if (!deleteId) return;
  const transaction = state.transactions.find((item) => item.id === deleteId);
  if (!transaction || !confirm(`Excluir “${transaction.descricao}”?`)) return;
  try {
    const result = await mutate('delete', transaction);
    if (result.queued) applyLocal('delete', transaction); else await load();
    notify(result.queued ? 'Exclusão agendada.' : 'Lançamento excluído.');
  } catch (error) { notify(error.message, true); }
}

async function toggleStatus(id, button) {
  const transaction = state.transactions.find((item) => item.id === id);
  if (!transaction || transaction.fonte === 'pluggy') return;
  const status = transaction.status === 'Pago' ? 'Pendente' : 'Pago';
  button.disabled = true;
  try {
    const updated = { ...transaction, status, dataPg: status === 'Pago' ? transaction.data : '' };
    const result = await mutate('update', updated);
    if (result.queued) applyLocal('update', updated); else await load();
    notify(`Lançamento marcado como ${status.toLowerCase()}.`);
  } catch (error) { notify(error.message, true); button.disabled = false; }
}

function applyLocal(action, transaction) {
  if (action === 'create') state.transactions.push(transaction);
  if (action === 'update') state.transactions = state.transactions.map((item) => item.id === transaction.id ? transaction : item);
  if (action === 'delete') state.transactions = state.transactions.filter((item) => item.id !== transaction.id);
  state.summary = calculateSummary();
  state.cashFlow = calculateLocalCashFlow();
  render();
}

function calculateSummary() {
  const result = { receitas: 0, despesas: 0, saldoPrevisto: 0, saldoAtual: 0, pendente: 0, aReceber: 0, aPagar: 0, categorias: {}, caixinhas: state.configuration.caixinhas.map((box) => ({ ...box, saldo: state.boxBase[box.nome] || 0, progresso: 0 })) };
  state.transactions.forEach((item) => {
    const effect = accountEffect(item);
    if (item.tipo === 'Receita') result.receitas += item.valor;
    if (item.tipo === 'Despesa') { result.despesas += item.valor; result.categorias[item.categoria] = (result.categorias[item.categoria] || 0) + item.valor; }
    if (item.tipo === 'Estorno') { result.despesas -= item.valor; result.categorias[item.categoria] = (result.categorias[item.categoria] || 0) - item.valor; }
    if (item.status === 'Pendente') {
      result.pendente += item.valor;
      if (['Receita', 'Resgate'].includes(item.tipo)) result.aReceber += item.valor;
      if (item.tipo === 'Despesa') result.aPagar += item.valor;
    }
    result.saldoPrevisto += effect;
    if (item.status === 'Pago') result.saldoAtual += effect;
    applyBoxContribution(result.caixinhas, item, 1);
  });
  result.caixinhas.forEach((box) => { box.progresso = box.meta ? Math.min(100, Math.max(0, box.saldo / box.meta * 100)) : 0; });
  return result;
}

function calculateLocalCashFlow() {
  const openingBalance = state.cashFlow?.openingBalance || 0;
  const days = new Date(Number(elements.month.value.slice(0, 4)), Number(elements.month.value.slice(5, 7)), 0).getDate();
  let balance = openingBalance;
  const points = Array.from({ length: days }, (_, index) => {
    const date = `${elements.month.value}-${String(index + 1).padStart(2, '0')}`;
    const movement = state.transactions.filter((item) => item.data === date).reduce((sum, item) => sum + accountEffect(item), 0);
    balance += movement;
    return { date, movement, balance };
  });
  const negativePeriods = points.filter((point) => point.balance < 0).length ? [{ start: points.find((point) => point.balance < 0).date, end: [...points].reverse().find((point) => point.balance < 0).date }] : [];
  return { openingBalance, closingBalance: balance, minimumBalance: Math.min(...points.map((point) => point.balance)), negativePeriods, points };
}

function calculateBoxBase(boxes, transactions) {
  const working = boxes.map((box) => ({ nome: box.nome, saldo: box.saldo || 0 }));
  transactions.forEach((item) => applyBoxContribution(working, item, -1));
  return Object.fromEntries(working.map((box) => [box.nome, box.saldo]));
}

function applyBoxContribution(boxes, item, direction) {
  const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
  const box = boxes.find((entry) => sameLabel(entry.nome, item.origem) || (isDeposit && sameLabel(entry.nome, item.categoria)));
  if (!box) return;
  if (isDeposit) box.saldo += item.valor * direction;
  if (['Despesa', 'Resgate'].includes(item.tipo)) box.saldo -= item.valor * direction;
}

function accountEffect(item) {
  if (!['Conta Corrente', 'Cartão de Crédito'].includes(item.origem)) return 0;
  if (['Receita', 'Resgate'].includes(item.tipo)) return item.valor;
  if (['Despesa', 'Depósito', 'Depósito Caixinha'].includes(item.tipo)) return -item.valor;
  return 0;
}

async function generateInsight() {
  const button = document.querySelector('#analyze-button');
  button.disabled = true;
  button.firstChild.textContent = 'Analisando os dados... ';
  try { elements.insight.textContent = (await analyze(elements.month.value)).insight; }
  catch (error) { notify(error.message, true); }
  finally { button.disabled = false; button.firstChild.textContent = 'Analisar dados com IA '; }
}

function updateConnectivity() { elements.offline.hidden = navigator.onLine; }
function setLoading(loading) { document.body.style.cursor = loading ? 'progress' : ''; }
function notify(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.classList.add('show');
  document.body.classList.add('toast-open');
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => {
    elements.toast.classList.remove('show');
    document.body.classList.remove('toast-open');
  }, 3500);
}
function money(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0); }
function fullDate(value) { return new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T12:00:00`)); }
function shortDate(value) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`)); }
function monthLabel(value) { return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(new Date(`${value}-01T12:00:00`)).replace('.', ''); }
function responsibleName(value) { return ({ Ele: 'Danilo', Ela: 'Talyta', Nós: 'Casal' })[value] || value; }
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function sameLabel(left, right) { return normalize(left) === normalize(right); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'BOM DIA, DUPLA' : hour < 18 ? 'BOA TARDE, DUPLA' : 'BOA NOITE, DUPLA'; }
function balanceMessage(balance) {
  if (balance > 0) return 'O mês está no verde. Vocês têm espaço para avançar em uma meta.';
  if (balance < 0) return 'O previsto pede atenção. Um pequeno ajuste agora pode reequilibrar o mês.';
  return 'Tudo equilibrado por aqui. Sigam acompanhando juntos.';
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function iconSvg(name) {
  const paths = {
    check: '<path d="m5 12 4 4L19 6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9H5m14 6h-2"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}
