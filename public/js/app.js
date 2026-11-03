import { requireSession, clearSession } from './auth.js';
import { getFinances, getCards, getSyncMentor, syncPluggy, updateBillStatus, updateBill, updateCardResponsible, mutate, updateBox, analyze, syncQueue } from './api.js';

const currentSession = requireSession();
const state = {
  transactions: [], configuration: { categorias: [], responsaveis: [], caixinhas: [] },
  summary: null, cashFlow: null, analysis: { months: [] }, mentor: {}, boxBase: {},
  transactionFilter: 'all', search: '', analysisFilter: 'all', cardsData: { items: [], cards: [], transactions: [], bills: [], bankBalance: 0 }, selectedCardId: 'all'
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
elements.billDialog = document.querySelector('#bill-dialog');
elements.billForm = document.querySelector('#bill-form');
const tabs = { general: 'Visão geral', transactions: 'Contas', analysis: 'Análises', boxes: 'Caixinhas', cards: 'Cartões' };

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
document.querySelector('#sync-pluggy-button').addEventListener('click', synchronizePluggy);
document.querySelector('#connected-card-grid').addEventListener('click', selectCard);
document.querySelector('#connected-card-grid').addEventListener('change', changeCardResponsible);
document.querySelector('#transaction-search').addEventListener('input', (event) => { state.search = event.target.value; renderTransactions(); });
document.querySelector('#transaction-filters').addEventListener('click', handleFilter);
document.querySelector('#analysis-filters').addEventListener('click', handleAnalysisFilter);
elements.month.addEventListener('change', () => { updateMonthLabel(); load(); });
document.querySelector('#previous-month').addEventListener('click', () => shiftMonth(-1));
document.querySelector('#next-month').addEventListener('click', () => shiftMonth(1));
elements.form.addEventListener('submit', saveTransaction);
elements.boxForm.addEventListener('submit', saveBox);
elements.billForm.addEventListener('submit', saveBill);
elements.form.elements.tipo.addEventListener('change', () => { enforceDepositStatus(); syncDepositFields(); });
elements.form.elements.categoria.addEventListener('change', toggleCardField);
const boxSelectEl = document.querySelector('#box-select');
if (boxSelectEl) boxSelectEl.addEventListener('change', () => {});
elements.list.addEventListener('click', handleTransactionAction);
elements.boxes.addEventListener('click', handleBoxAction);
elements.dialog.addEventListener('click', (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
elements.boxDialog.addEventListener('click', (event) => { if (event.target === elements.boxDialog) elements.boxDialog.close(); });
elements.billDialog.addEventListener('click', (event) => { if (event.target === elements.billDialog) elements.billDialog.close(); });
document.querySelectorAll('[data-close-box-dialog]').forEach((button) => button.addEventListener('click', () => elements.boxDialog.close()));
document.querySelectorAll('[data-close-bill-dialog]').forEach((button) => button.addEventListener('click', () => elements.billDialog.close()));
window.addEventListener('hashchange', () => switchTab(location.hash.slice(1), false));
window.addEventListener('online', async () => {
  updateConnectivity();
  const count = 'SyncManager' in window ? 0 : await syncQueue();
  if (count) { notify(`${count} alteração(ões) sincronizada(s).`); load(); }
});
window.addEventListener('offline', updateConnectivity);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSyncMentor(); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'FINANCES_SYNCED') { notify('Alterações offline sincronizadas.'); load(); }
  });
  navigator.serviceWorker.register('/sw.js');
}

switchTab(location.hash.slice(1) || 'general', false);
updateConnectivity();
load();
setInterval(() => { if (!document.hidden && navigator.onLine) refreshSyncMentor(); }, 30000);

async function load() {
  setLoading(true);
  try {
    const data = await getFinances(elements.month.value);
    const cardsData = await getCards(elements.month.value).catch((error) => ({ error: error.message, items: [], cards: [], transactions: [], bills: [], bankBalance: 0 }));
    state.transactions = data.transactions || [];
    state.configuration = data.configuration || state.configuration;
    state.summary = data.summary || calculateSummary();
    state.cashFlow = data.cashFlow || calculateLocalCashFlow();
    state.cashCycles = data.cashCycles || null;
    state.analysis = data.analysis || { months: [] };
    state.mentor = data.mentor || {};
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
  renderMentor();
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
  renderCycles(state.cashCycles || calculateLocalCashCycles());
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
  const periods = cashFlow.negativePeriods.map((period) => `entre ${shortDate(period.start)} e ${shortDate(period.end)} o saldo fica em <strong class="negative">${money(period.minimum)}</strong>`).join('; ');
  summary.innerHTML = `<div><span>Saldo hoje</span><strong>${money(cashFlow.openingBalance)}</strong></div><div><span>Menor saldo</span><strong class="${cashFlow.minimumBalance < 0 ? 'negative' : ''}">${money(cashFlow.minimumBalance)}</strong></div><div><span>Fechamento previsto</span><strong>${money(cashFlow.closingBalance)}</strong></div><p>${hasRisk ? `Risco de saldo negativo: ${periods}.` : 'Nenhum intervalo negativo previsto para este mês.'}</p>`;
}

function renderCategoryChart(summary) {
  const categories = Object.entries(summary.categorias || {}).filter((entry) => entry[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const total = Object.values(summary.categorias || {}).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  elements.chart.hidden = categories.length === 0;
  elements.chartEmpty.hidden = categories.length > 0;
  elements.chart.innerHTML = categories.map(([name, value]) => `<div class="responsible-row"><div><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><span>${Math.round(value / total * 100)}% · ${money(value)}</span></div><div class="bar-track"><div class="bar" style="width:${value / total * 100}%"></div></div></div>`).join('');
  const expenses = state.transactions.filter((item) => ['Despesa', 'Pagamento Fatura'].includes(item.tipo)).length;
  document.querySelector('#expense-count').textContent = `${expenses} ${expenses === 1 ? 'lançamento' : 'lançamentos'}`;
}

function renderBoxes(boxes) {
  document.querySelector('#boxes-total').textContent = money(boxes.reduce((sum, box) => sum + box.saldo, 0));
  const movementsHtml = (box) => {
    const movements = state.transactions.filter((item) => item.origem === box.nome && item.fonte !== 'pluggy' && item.fonte !== 'pluggy-bill').slice(0, 3);
    return `<div class="box-movements">${movements.length ? movements.map((item) => `<span>${fullDate(item.data)} · ${escapeHtml(item.tipo)} · ${money(item.valor)}</span>`).join('') : '<span>Sem movimentos neste mês</span>'}</div>`;
  };
  const projectionHtml = (projection) => {
    if (!projection) return '';
    if (projection.status === 'reached') return '<div class="box-projection">Meta atingida</div>';
    if (projection.status === 'no-contribution') return '<div class="box-projection">Sem aporte recorrente no histórico</div>';
    const plural = projection.monthsNeeded === 1 ? 'mês' : 'meses';
    return `<div class="box-projection">Aporte médio ${money(projection.monthlyAverage)}/mês · meta em ${fullMonthLabel(projection.targetMonth)} de ${projection.targetMonth.slice(0, 4)} (${projection.monthsNeeded} ${plural})</div>`;
  };
  const card = (box) => `<article class="box-card"><div class="box-card-head"><span class="box-money-icon">${iconSvg('money')}</span><div class="box-card-actions"><small>${Math.round(box.progresso || 0)}%</small><button class="action-button edit" data-edit-box="${escapeHtml(box.nome)}" title="Editar caixinha" aria-label="Editar caixinha ${escapeHtml(box.nome)}">${iconSvg('edit')}</button></div></div><h3>${escapeHtml(box.nome)}</h3><p>${money(box.saldo)} guardados</p><div class="progress"><span style="width:${box.progresso || 0}%"></span></div><div class="box-meta"><span>Meta</span><strong>${money(box.meta)}</strong></div>${movementsHtml(box)}${projectionHtml(box.projection)}</article>`;
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
    const isVisible = item.fonte === 'pluggy-bill' || item.fonte !== 'pluggy';
    const matchesSearch = !query || normalize(`${item.descricao} ${item.categoria} ${item.responsavel}`).includes(query);
    const status = item.situacao || item.status;
    const matchesType = state.transactionFilter === 'all'
      || (state.transactionFilter === 'pending' && ['Pendente', 'Aberta', 'Projetada'].includes(status))
      || (state.transactionFilter === 'paid' && ['Pago', 'Paga'].includes(status))
      || (state.transactionFilter === 'income' && ['Receita', 'Resgate', 'Estorno'].includes(item.tipo))
      || (state.transactionFilter === 'expense' && ['Despesa', 'Pagamento Fatura'].includes(item.tipo))
      || (state.transactionFilter === 'deposit' && ['Depósito', 'Depósito Caixinha'].includes(item.tipo));
    return isVisible && matchesSearch && matchesType;
  }).sort((a, b) => a.data.localeCompare(b.data) || (a.ordem || 0) - (b.ordem || 0));
  document.querySelector('#transaction-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'lançamento' : 'lançamentos'} no período`;
  elements.list.innerHTML = filtered.length ? filtered.map((item) => {
    const positive = ['Receita', 'Resgate', 'Estorno'].includes(item.tipo);
    const deposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
    const imported = item.fonte === 'pluggy';
    const bill = item.fonte === 'pluggy-bill';
    const billLocked = bill && ['Aberta', 'Projetada'].includes(item.situacao);
    const valueClass = deposit ? 'deposit' : positive ? 'income-value' : 'expense-value';
    const paid = item.status === 'Pago';
    const billTag = item.situacao === 'Aberta' ? 'Aberta' : item.ajustada ? 'Ajustada' : item.situacao === 'Projetada' ? 'Projetada' : item.estimada ? 'Estimada' : 'Pluggy';
    const source = bill ? item.fontePagamento : (item.origem === 'Cartão de Crédito' ? (item.cartao || 'Cartão') : item.origem);
    const displayedStatus = bill ? item.situacao : item.status;
    const statusClass = displayedStatus === 'Paga' || displayedStatus === 'Pago' ? 'paid' : displayedStatus === 'Projetada' ? 'projected' : displayedStatus === 'Aberta' ? 'open' : 'pending';
    return `<article class="detailed-transaction ${paid ? '' : 'pending-row'} ${bill ? 'imported-row' : ''}"><button class="status-toggle ${paid ? 'paid' : ''}" ${imported || deposit || billLocked ? 'disabled' : `data-status="${escapeHtml(item.id)}"`} title="${billLocked ? `Fatura ${item.situacao.toLowerCase()}` : bill ? `Marcar fatura como ${paid ? 'pendente' : 'paga'}` : `Marcar como ${paid ? 'pendente' : 'pago'}`}">${paid ? iconSvg('check') : ''}</button><div class="transaction-info"><strong>${escapeHtml(item.descricao)}</strong><div class="transaction-meta"><time datetime="${escapeHtml(item.data)}">${fullDate(item.data)}</time><span>·</span><span>${escapeHtml(item.categoria)}${item.cartao ? ` · ${escapeHtml(item.cartao)}` : ''}</span>${bill ? `<span class="source-tag">${billTag}</span>` : ''}</div></div><div class="transaction-value ${valueClass}">${positive || deposit ? '+' : '−'} ${money(item.valor)}</div><div class="transaction-status"><span class="status-pill ${statusClass}">${paid ? iconSvg('check') : ''}${escapeHtml(displayedStatus)}</span><span class="paid-origin">${escapeHtml(source)}</span></div>${bill && !billLocked ? `<div class="transaction-actions"><button class="action-button edit" data-edit-bill="${escapeHtml(item.id)}" title="Ajustar valor e fonte" aria-label="Ajustar ${escapeHtml(item.descricao)}">${iconSvg('edit')}<span>Editar</span></button></div>` : bill ? '<div class="transaction-actions synced-lock">Sincronizada</div>' : `<div class="transaction-actions"><button class="action-button edit" data-edit="${escapeHtml(item.id)}" title="Editar valor e detalhes" aria-label="Editar ${escapeHtml(item.descricao)}">${iconSvg('edit')}<span>Editar</span></button><button class="action-button delete" data-delete="${escapeHtml(item.id)}" title="Excluir lançamento" aria-label="Excluir ${escapeHtml(item.descricao)}">${iconSvg('trash')}<span>Excluir</span></button></div>`}</article>`;
  }).join('') : '<div class="empty-state panel"><span>↕</span><p>Nenhum lançamento encontrado.</p></div>';
}

function renderCards() {
  const data = state.cardsData || {};
  const cards = data.cards || [];
  const bills = data.bills || [];
  const nextBills = data.nextBills || [];
  const budget = data.budget || {};
  const monthLabel = fullMonthLabel(data.spendingMonth || elements.month.value);
  const nextLabel = fullMonthLabel(data.paymentMonth || elements.month.value);
  document.querySelector('#bank-balance').textContent = money(data.bankBalance || 0);
  document.querySelector('#month-bill-label').textContent = `Vencimentos em ${monthLabel}`;
  const noCards = !cards.length;
  document.querySelector('#month-bill-total').textContent = noCards ? '—' : money(budget.consumption || 0);
  document.querySelector('#card-available-total').textContent = noCards ? '—' : money(data.availableLimit || 0);
  document.querySelector('#credit-limit-total').textContent = money(budget.ceiling || 0);
  const remaining = document.querySelector('#credit-limit-available');
  remaining.textContent = noCards ? '—' : Number(budget.remaining) < 0 ? `Passou ${money(-budget.remaining)}` : `Faltam ${money(budget.remaining || 0)}`;
  remaining.classList.toggle('budget-negative', Number(budget.remaining) < 0);
  const status = document.querySelector('#pluggy-status');
  status.textContent = data.error || (data.items?.length ? `${data.items.length} instituição(ões) sincronizada(s).` : data.hasConfiguredItems ? 'Clique em Sincronizar dados para fazer a primeira importação.' : 'Configure os Item IDs da Pluggy na Vercel para importar seus dados.');
  status.classList.toggle('error-copy', Boolean(data.error));
  document.querySelector('#sync-pluggy-button').hidden = Boolean(currentSession?.demo);
  renderCeiling(data, budget, monthLabel);
  const grid = document.querySelector('#connected-card-grid');
  grid.innerHTML = cards.length ? cards.map((card, index) => {
    const cardBills = bills.filter((bill) => bill.accountId === card.id);
    const billTotal = cardBills.reduce((sum, bill) => sum + bill.valor, 0);
    const billStatus = cardBills.map((bill) => (bill.estimada ? 'Estimativa' : bill.status)).join(' · ');
    const nextBill = nextBills.find((bill) => bill.accountId === card.id && bill.valor > 0);
    const active = state.selectedCardId === card.id;
    const updated = card.updatedAt ? fullDate(card.updatedAt.slice(0, 10)) : '—';
    const nextText = nextBill ? `${money(nextBill.valor)} · ${nextBill.estimada ? 'estimativa' : 'oficial'}` : 'sem previsão';
    return `<article class="connected-card card-tone-${index % 3} ${active ? 'active' : ''}" data-card-id="${escapeHtml(card.id)}"><span class="card-brand">${escapeHtml(card.brand || 'CARTÃO')}</span><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.institution)} · ${escapeHtml(card.number)}</small><label class="card-owner">Responsável<select data-card-owner="${escapeHtml(card.id)}"><option value="Ele" ${card.responsavel === 'Ele' ? 'selected' : ''}>Danilo</option><option value="Ela" ${card.responsavel === 'Ela' ? 'selected' : ''}>Talyta</option><option value="Nós" ${card.responsavel === 'Nós' ? 'selected' : ''}>Casal</option></select></label><div class="card-bill"><span>Fatura de ${monthLabel}</span><strong>${cardBills.length ? money(billTotal) : 'Sem fatura'}</strong><small>${escapeHtml(billStatus)}</small><span class="card-next">Próxima (${nextLabel}): ${nextText}</span></div><div class="card-limit"><span>Disponível ${money(card.availableLimit || 0)}</span><span>Usado ${money(card.usedLimit || 0)}</span></div><span class="card-available">Limite total ${money(card.creditLimit || 0)}<br>Atualizado em ${updated}</span></article>`;
  }).join('') : '<div class="empty-state panel"><p>Nenhum cartão conectado.</p></div>';
  renderCardTransactions();
}

function renderCeiling(data, budget, monthLabel) {
  const lines = [
    ...(data.bills || []).map((bill) => ({ label: bill.descricao, detail: `vence ${fullDate(bill.data)} · ${bill.estimada ? 'estimativa' : bill.status}`, value: bill.valor })),
    ...(data.manualBills || []).map((item) => ({ label: `${item.cartao} (manual)`, detail: `vence ${fullDate(item.data)} · ${item.status}`, value: item.valor }))
  ];
  if (!lines.length && !budget.consumption) {
    document.querySelector('#ceiling-panel').innerHTML = `<article class="panel ceiling-panel"><div class="ceiling-head"><div><p class="eyebrow">TETO PELO VENCIMENTO · ${monthLabel.toUpperCase()}</p><h2>Sem dados de cartão</h2></div></div><p class="muted-copy">Sincronize os dados bancários para ver o teto deste mês.</p></article>`;
    return;
  }
  const remaining = Number(budget.remaining || 0);
  const over = remaining < 0;
  const summary = over ? `Passou ${money(-remaining)}` : `Faltam ${money(remaining)}`;
  const rows = lines.length ? lines.map((line) => `<div class="ceiling-line"><div><strong>${escapeHtml(line.label)}</strong><span>${escapeHtml(line.detail)}</span></div><strong>${money(line.value)}</strong></div>`).join('') : '<p class="muted-copy">Nenhum vencimento neste mês.</p>';
  document.querySelector('#ceiling-panel').innerHTML = `<article class="panel ceiling-panel"><div class="ceiling-head"><div><p class="eyebrow">TETO PELO VENCIMENTO · ${monthLabel.toUpperCase()}</p><h2>${money(budget.consumption || 0)} <span>de ${money(budget.ceiling || 0)}</span></h2></div><span class="ceiling-status ${over ? 'over' : 'ok'}">${summary}</span></div><div class="ceiling-lines">${rows}</div></article>`;
}

function renderCardTransactions() {
  const selected = state.cardsData.cards?.find((card) => card.id === state.selectedCardId);
  const transactions = (state.cardsData.transactions || []).filter((item) => !selected || item.accountId === selected.id).sort((a, b) => b.data.localeCompare(a.data) || (b.ordem || 0) - (a.ordem || 0));
  document.querySelector('#selected-card-title').textContent = selected ? `Gastos em ${selected.name}` : 'Gastos nos cartões';
  const total = transactions.reduce((sum, item) => sum + (item.tipo === 'Estorno' ? -item.valor : item.valor), 0);
  document.querySelector('#card-expense-total').textContent = money(total);
  document.querySelector('#card-transaction-list').innerHTML = transactions.length ? transactions.map((item) => `<div class="card-transaction"><div><strong>${escapeHtml(item.descricao)}</strong><span>${fullDate(item.data)} · ${escapeHtml(item.categoria)}</span></div><strong class="${item.tipo === 'Estorno' ? 'income-value' : 'expense-value'}">${item.tipo === 'Estorno' ? '+' : '−'} ${money(item.valor)}</strong></div>`).join('') : '<p class="muted-copy">Nenhum gasto encontrado neste mês.</p>';
}

function selectCard(event) {
  if (event.target.closest('[data-card-owner]')) return;
  const id = event.target.closest('[data-card-id]')?.dataset.cardId;
  if (!id) return;
  state.selectedCardId = state.selectedCardId === id ? 'all' : id;
  renderCards();
}

async function changeCardResponsible(event) {
  const select = event.target.closest('[data-card-owner]');
  if (!select) return;
  select.disabled = true;
  try {
    await updateCardResponsible(select.dataset.cardOwner, select.value);
    await load();
    notify('Responsável do cartão atualizado.');
  } catch (error) { notify(error.message, true); select.disabled = false; }
}

async function synchronizePluggy() {
  const button = document.querySelector('#sync-pluggy-button');
  const previousMentorUpdate = state.mentor?.sync?.updatedAt;
  button.disabled = true;
  try {
    const result = await syncPluggy();
    await load();
    notify(result.mentorQueued ? 'Dados bancários sincronizados. O Mentor Duo está atualizando a orientação.' : 'Dados bancários sincronizados.');
    if (result.mentorQueued) refreshSyncMentor(previousMentorUpdate);
  }
  catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function refreshSyncMentor(previousUpdate) {
  const delays = previousUpdate === undefined ? [0] : [5000, 5000, 5000, 5000, 5000];
  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const insight = (await getSyncMentor(elements.month.value)).insight;
      if (insight?.updatedAt && insight.updatedAt !== previousUpdate) {
        state.mentor = { ...state.mentor, sync: insight };
        renderMentor();
        return;
      }
    } catch {
      return;
    }
  }
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
  const filled = values.filter((value) => value > 0);
  const average = filled.reduce((sum, value) => sum + value, 0) / Math.max(1, filled.length);
  document.querySelector('#trend-metrics').innerHTML = `<div><span>Mês atual</span><strong>${money(current)}</strong></div><div><span>Média (meses com gasto)</span><strong>${money(average)}</strong></div><div><span>Maior mês</span><strong>${money(Math.max(...values, 0))}</strong></div>`;
  const responsibleValues = months.at(-1)?.responsibles || {};
  const responsibleKeys = [...new Set(['Ele', 'Ela', 'Nós', ...Object.keys(responsibleValues)])];
  const responsibles = responsibleKeys.map((name) => [name, responsibleValues[name] || 0]);
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
  const accountOrigins = ['Conta Corrente', 'Externo'];
  const boxOrigins = state.configuration.caixinhas.map((box) => box.nome);
  const origins = [...accountOrigins, ...boxOrigins];
  originSelect.innerHTML = `<optgroup label="Conta">${accountOrigins.map((item) => `<option>${escapeHtml(item)}</option>`).join('')}</optgroup>${boxOrigins.length ? `<optgroup label="Caixinhas">${boxOrigins.map((item) => `<option>${escapeHtml(item)}</option>`).join('')}</optgroup>` : ''}`;
  if (origins.includes(currentOrigin)) originSelect.value = currentOrigin;
  const boxSelect = document.querySelector('#box-select');
  if (boxSelect) {
    const currentBox = boxSelect.value;
    const boxes = state.configuration.caixinhas.map((box) => box.nome);
    if (boxes.length) {
      boxSelect.innerHTML = boxes.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
      if (boxes.includes(currentBox)) boxSelect.value = currentBox;
    } else {
      boxSelect.innerHTML = '<option value="">Nenhuma caixinha</option>';
    }
  }
  toggleCardField();
  syncDepositFields();
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
    const isDepositTx = ['Depósito', 'Depósito Caixinha'].includes(transaction.tipo);
    if (isDepositTx) {
      const boxField = transaction.categoria && state.configuration.caixinhas.some((b) => sameLabel(b.nome, transaction.categoria))
        ? transaction.categoria
        : transaction.origem && state.configuration.caixinhas.some((b) => sameLabel(b.nome, transaction.origem))
          ? transaction.origem
          : state.configuration.caixinhas[0]?.nome || '';
      const boxSelect = document.querySelector('#box-select');
      if (boxSelect && boxField) boxSelect.value = boxField;
    }
  } else {
    const lastDay = new Date(Number(elements.month.value.slice(0, 4)), Number(elements.month.value.slice(5, 7)), 0).getDate();
    elements.form.elements.data.value = `${elements.month.value}-${String(Math.min(new Date().getDate(), lastDay)).padStart(2, '0')}`;
    elements.form.elements.responsavel.value = 'Nós';
  }
  enforceDepositStatus();
  toggleCardField();
  syncDepositFields();
  elements.dialog.showModal();
  setTimeout(() => elements.form.elements.descricao.focus(), 0);
}

async function saveTransaction(event) {
  event.preventDefault();
  const form = new FormData(elements.form);
  const existingId = String(form.get('id') || '');
  const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(form.get('tipo'));
  const status = isDeposit ? 'Pago' : form.get('status');
  const caixinha = String(form.get('caixinha') || '').trim();
  if (isDeposit && !caixinha) {
    notify('Selecione a caixinha para o depósito.', true);
    return;
  }
  const transaction = {
    id: existingId, tipo: form.get('tipo'), descricao: form.get('descricao').trim(), valor: Number(form.get('valor')),
    data: form.get('data'), dataPg: status === 'Pago' ? form.get('data') : '', mesRef: form.get('data').slice(0, 7),
    status, categoria: isDeposit ? caixinha : String(form.get('categoria') || '').trim(), responsavel: form.get('responsavel'), parcelaAtual: 1, totalParcelas: 1,
    idParcelamento: '', recorrente: form.get('recorrente') === 'on', origem: form.get('origem'), cartao: form.get('cartao') || ''
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

function toggleCardField() {
  const field = document.querySelector('#card-field');
  const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(elements.form.elements.tipo.value);
  if (isDeposit) {
    field.hidden = true;
    elements.form.elements.cartao.required = false;
    elements.form.elements.cartao.value = '';
    return;
  }
  const isCardBill = normalize(elements.form.elements.categoria.value) === 'cartao de credito';
  field.hidden = !isCardBill;
  document.querySelector('#date-label').textContent = isCardBill ? 'Vencimento' : 'Data';
  elements.form.elements.cartao.required = isCardBill;
  if (!isCardBill) elements.form.elements.cartao.value = '';
}

function syncDepositFields() {
  const isDeposit = ['Depósito', 'Depósito Caixinha'].includes(elements.form.elements.tipo.value);
  const categoryField = document.querySelector('#category-field');
  const boxField = document.querySelector('#box-field');
  if (categoryField) categoryField.hidden = isDeposit;
  if (boxField) boxField.hidden = !isDeposit;
  const categorySelect = document.querySelector('#category-select');
  const boxSelect = document.querySelector('#box-select');
  if (categorySelect) categorySelect.required = !isDeposit;
  if (boxSelect) boxSelect.required = isDeposit;
  if (isDeposit) {
    const cardField = document.querySelector('#card-field');
    if (cardField) {
      cardField.hidden = true;
      elements.form.elements.cartao.required = false;
    }
  } else {
    toggleCardField();
  }
}

async function handleTransactionAction(event) {
  const billId = event.target.closest('[data-edit-bill]')?.dataset.editBill;
  const editId = event.target.closest('[data-edit]')?.dataset.edit;
  const deleteId = event.target.closest('[data-delete]')?.dataset.delete;
  const statusId = event.target.closest('[data-status]')?.dataset.status;
  if (billId) return openBillForm(state.transactions.find((item) => item.id === billId));
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

function openBillForm(bill) {
  if (!bill) return;
  elements.billForm.reset();
  elements.billForm.elements.id.value = bill.id;
  elements.billForm.elements.valor.value = bill.valor;
  elements.billForm.elements.fontePagamento.value = bill.fontePagamento || 'Conta Corrente';
  document.querySelector('#bill-dialog-title').textContent = bill.descricao;
  elements.billDialog.showModal();
  setTimeout(() => elements.billForm.elements.valor.focus(), 0);
}

async function saveBill(event) {
  event.preventDefault();
  const form = new FormData(elements.billForm);
  const button = document.querySelector('#save-bill-button');
  button.disabled = true;
  try {
    await updateBill(String(form.get('id')), Number(form.get('valor')), String(form.get('fontePagamento')));
    elements.billDialog.close();
    await load();
    notify('Valor e fonte da fatura atualizados.');
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function toggleStatus(id, button) {
  const transaction = state.transactions.find((item) => item.id === id);
  if (!transaction || transaction.fonte === 'pluggy' || ['Aberta', 'Projetada'].includes(transaction.situacao)) return;
  const status = transaction.status === 'Pago' ? 'Pendente' : 'Pago';
  button.disabled = true;
  try {
    if (transaction.fonte === 'pluggy-bill') {
      await updateBillStatus(transaction.id, status);
      await load();
      notify(`Fatura marcada como ${status.toLowerCase()}.`);
      return;
    }
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
  state.cashCycles = null;
  render();
}

function calculateSummary() {
  const result = { receitas: 0, despesas: 0, saldoPrevisto: 0, saldoAtual: 0, pendente: 0, aReceber: 0, aPagar: 0, categorias: {}, caixinhas: state.configuration.caixinhas.map((box) => ({ ...box, saldo: state.boxBase[box.nome] || 0, progresso: 0 })) };
  state.transactions.forEach((item) => {
    if (item.fonte === 'pluggy') return;
    if (item.fonte === 'pluggy-bill') {
      result.despesas += item.valor;
      result.categorias[item.categoria] = (result.categorias[item.categoria] || 0) + item.valor;
      if (item.status === 'Pendente') result.aPagar += item.valor;
      const effect = accountEffect(item);
      result.saldoPrevisto += effect;
      if (item.status === 'Pago') result.saldoAtual += effect;
      return;
    }
    const effect = accountEffect(item);
    if (item.tipo === 'Receita') result.receitas += item.valor;
    if (item.tipo === 'Despesa') { result.despesas += item.valor; result.categorias[item.categoria] = (result.categorias[item.categoria] || 0) + item.valor; }
    if (item.tipo === 'Estorno') { result.despesas -= item.valor; result.categorias[item.categoria] = (result.categorias[item.categoria] || 0) - item.valor; }
    if (item.status === 'Pendente') {
      result.pendente += item.valor;
      if (item.tipo === 'Receita') result.aReceber += item.valor;
      if (item.tipo === 'Despesa' && item.fonte !== 'pluggy') result.aPagar += item.valor;
    }
    result.saldoPrevisto += effect;
    if (item.status === 'Pago') result.saldoAtual += effect;
    applyBoxContribution(result.caixinhas, item, 1);
  });
  result.caixinhas.forEach((box) => { box.progresso = box.meta ? Math.min(100, Math.max(0, box.saldo / box.meta * 100)) : 0; });
  return result;
}

function renderCycles(data) {
  const container = document.querySelector('#cashflow-cycles');
  const cycles = data.cycles || [];
  if (data.pastMonth || !cycles.length) {
    container.innerHTML = '';
    return;
  }
  const today = todayText();
  const current = cycles.find((cycle) => cycle.start <= today && today <= cycle.end) || cycles[0];
  const livre = Number(data.safeToSpend ?? current.livre ?? 0);
  const headline = current.status === 'ok'
    ? `Você pode gastar <strong>${money(livre)}</strong> livres até ${shortDate(current.end)}.`
    : `Até ${shortDate(current.end)} faltam <strong class="negative">${money(current.falta)}</strong>. Antecipe ou adie compromissos.`;
  container.innerHTML = `<p class="cycle-headline">${headline}</p><div class="cycle-grid">${cycles.map((cycle) => cycleCard(cycle, today)).join('')}</div>`;
}

function cycleCard(cycle, today) {
  const pill = cycle.status === 'falta' ? `Faltam ${money(cycle.falta)}` : `Folga de ${money(cycle.menorSaldo)}`;
  const starter = cycle.inicio ? `${escapeHtml(cycle.inicio.descricao)} · ${money(cycle.inicio.valor)}` : 'Início do mês';
  const timing = cycle.end < today ? 'passado' : cycle.start <= today ? 'atual' : 'futuro';
  return `<article class="cycle-card ${cycle.status} ${timing}"><p class="cycle-start">${starter}</p><h3>${shortDate(cycle.start)} a ${shortDate(cycle.end)}</h3><div class="cycle-row"><span>Saldo no início</span><strong>${money(cycle.saldoInicio)}</strong></div><div class="cycle-row"><span>Compromissos</span><strong>${money(cycle.compromissos)}</strong></div><div class="cycle-row"><span>Entradas</span><strong>${money(cycle.entradas)}</strong></div><div class="cycle-row"><span>Menor saldo</span><strong class="${cycle.menorSaldo < 0 ? 'negative' : ''}">${money(cycle.menorSaldo)}</strong></div><span class="cycle-pill ${cycle.status}">${pill}</span></article>`;
}

function todayText() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function calculateLocalCashCycles() {
  const today = todayText();
  const month = elements.month.value;
  if (month < today.slice(0, 7)) return { pastMonth: true, cycles: [], safeToSpend: null };
  const anchor = state.summary?.saldoAtual || 0;
  const pending = state.transactions.filter((item) => item.status === 'Pendente' && item.data).map((item) => ({ date: item.data < today ? today : item.data, effect: accountEffect(item) })).filter((item) => item.effect !== 0);
  const balanceOn = (date) => anchor + pending.filter((item) => item.date <= date).reduce((sum, item) => sum + item.effect, 0);
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(days).padStart(2, '0')}`;
  const receipts = state.transactions.filter((item) => item.tipo === 'Receita' && item.data && item.data >= monthStart).sort((a, b) => a.data.localeCompare(b.data));
  const boundaries = [...new Set([monthStart, ...receipts.map((item) => item.data)])].sort();
  const inMonth = boundaries.filter((date) => date <= monthEnd);
  const nextAfter = receipts.find((item) => item.data > monthEnd)?.data;
  const cycles = inMonth.map((start, index) => {
    const nextStart = inMonth[index + 1] || nextAfter;
    const end = nextStart ? shiftDateLocal(nextStart, -1) : monthEnd;
    const dates = [];
    for (let date = start; date <= end; date = shiftDateLocal(date, 1)) dates.push(date);
    const menorSaldo = Math.min(...dates.map(balanceOn));
    const future = dates.filter((date) => date >= today);
    const livre = future.length ? Math.min(...future.map(balanceOn)) : menorSaldo;
    const compromissos = pending.filter((item) => item.date >= start && item.date <= end && item.effect < 0).reduce((sum, item) => sum - item.effect, 0);
    const entradas = pending.filter((item) => item.date > start && item.date <= end && item.effect > 0).reduce((sum, item) => sum + item.effect, 0);
    const starter = receipts.find((item) => item.data === start);
    return { start, end, inicio: starter ? { descricao: starter.descricao, valor: starter.valor, status: starter.status } : null, saldoInicio: balanceOn(start), entradas, compromissos, saldoFim: balanceOn(end), menorSaldo, livre, status: menorSaldo < 0 ? 'falta' : 'ok', falta: Math.max(0, -menorSaldo) };
  });
  const current = cycles.find((cycle) => cycle.start <= today && today <= cycle.end);
  return { pastMonth: false, cycles, safeToSpend: current ? Math.max(0, current.livre) : null };
}

function shiftDateLocal(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function calculateLocalCashFlow() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const month = elements.month.value;
  if (month < today.slice(0, 7)) return { openingBalance: null, closingBalance: null, minimumBalance: null, negativePeriods: [], points: [], pastMonth: true };
  const anchor = state.summary?.saldoAtual || 0;
  const pending = state.transactions.filter((item) => item.status === 'Pendente' && item.data).map((item) => ({ date: item.data < today ? today : item.data, effect: accountEffect(item) }));
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const points = [];
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (date < (month === today.slice(0, 7) ? today : `${month}-01`)) continue;
    const movement = pending.filter((item) => item.date === date).reduce((sum, item) => sum + item.effect, 0);
    const balance = anchor + pending.filter((item) => item.date <= date).reduce((sum, item) => sum + item.effect, 0);
    points.push({ date, movement, balance });
  }
  const negativePeriods = [];
  let open = null;
  for (const point of points) {
    if (point.balance < 0 && !open) open = { start: point.date, minimum: point.balance };
    if (point.balance < 0) open.minimum = Math.min(open.minimum, point.balance);
    if (point.balance >= 0 && open) {
      negativePeriods.push({ ...open, end: points[points.indexOf(point) - 1].date });
      open = null;
    }
  }
  if (open) negativePeriods.push({ ...open, end: points.at(-1).date });
  return { openingBalance: points[0]?.balance ?? anchor, closingBalance: points.at(-1)?.balance ?? anchor, minimumBalance: Math.min(...points.map((point) => point.balance)), negativePeriods, points };
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
  const source = item.fontePagamento || item.origem;
  if (!['Conta Corrente', 'Cartão de Crédito'].includes(source)) return 0;
  if (['Receita', 'Resgate'].includes(item.tipo)) return item.valor;
  if (['Despesa', 'Pagamento Fatura', 'Depósito', 'Depósito Caixinha'].includes(item.tipo)) return -item.valor;
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

function renderMentor() {
  const sync = state.mentor?.sync;
  document.querySelector('#general-mentor-text').textContent = sync?.message || 'Sincronize os cartões para o Mentor Duo avaliar o impacto dos gastos mais recentes.';
  const monthly = state.mentor?.monthly;
  if (monthly?.perception && monthly?.question) elements.insight.textContent = `${monthly.perception}\n\n${monthly.question}`;
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
function fullMonthLabel(value) { return new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(`${value}-01T12:00:00`)); }
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
