import { requireSession, clearSession } from './auth.js';
import { getFinances, getCards, getSyncMentor, syncPluggy, updateBillStatus, updateBill, updateCardResponsible, mutate, updateBox, analyze, syncQueue, subscribePush, macroCategory } from './api.js?v=42';

const currentSession = requireSession();
const state = {
  transactions: [], configuration: { categorias: [], responsaveis: [], caixinhas: [] },
  summary: null, cashFlow: null, analysis: { months: [] }, mentor: {}, boxBase: {},
  transactionFilter: 'payable', search: '', analysisPeriod: 3, cardsData: { items: [], cards: [], transactions: [], bills: [], bankBalance: 0 }, selectedCardId: 'all'
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
renderGreeting();

document.querySelectorAll('[data-open-form]').forEach((button) => button.addEventListener('click', () => openForm()));
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => elements.dialog.close()));
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelectorAll('[data-go-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.goTab)));
document.querySelector('#logout-button').addEventListener('click', () => { clearSession(); window.location.assign('/login'); });
document.querySelector('#analyze-button').addEventListener('click', generateInsight);
document.querySelector('#sync-pluggy-button').addEventListener('click', synchronizePluggy);
document.querySelector('#connected-card-grid').addEventListener('click', selectCard);
document.querySelector('#connected-card-grid').addEventListener('change', changeCardResponsible);
document.querySelector('#upcoming-list').addEventListener('click', handleTransactionAction);
document.querySelector('#action-sheet').addEventListener('click', handleSheetAction);
document.querySelector('#search-toggle').addEventListener('click', toggleListSearch);
document.querySelector('#selected-card-detail').addEventListener('click', handleCardDetail);
document.querySelector('#selected-card-detail').addEventListener('change', changeCardResponsible);
document.querySelector('#fab-button').addEventListener('click', toggleFab);
document.querySelector('#fab-menu').addEventListener('click', handleFabAction);
document.addEventListener('click', (event) => { if (!event.target.closest('#fab')) closeFab(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeFab(); });
document.querySelector('#enable-reminders').addEventListener('click', enableReminders);
document.querySelector('#bill-history-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget || event.target.closest('[data-close-history]')) event.currentTarget.close();
});
document.querySelector('#transaction-search').addEventListener('input', (event) => { state.search = event.target.value; renderTransactions(); });
document.querySelector('#transaction-filters').addEventListener('click', handleFilter);
document.querySelector('#analysis-period').addEventListener('click', handleAnalysisPeriod);
document.querySelector('#category-chart').addEventListener('click', handleCategoryClick);
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshSyncMentor(); renderGreeting(); } });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'FINANCES_SYNCED') { notify('Alterações offline sincronizadas.'); load(); }
  });
  navigator.serviceWorker.register('/sw.js');
}

switchTab(location.hash.slice(1) || 'general', false);
updateConnectivity();
load();
setupReminders();
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
    state.comparison = data.comparison || null;
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
  renderTrend('#income-trend', summary.receitas, state.comparison?.receitas, 'up-good');
  renderTrend('#expense-trend', summary.despesas, state.comparison?.despesas, 'up-bad');
  renderUpcoming();
  renderHomeHero(summary);
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
  summary.innerHTML = `<div><span>Saldo inicial do mês</span><strong>${money(cashFlow.openingBalance)}</strong></div><div><span>Menor saldo</span><strong class="${cashFlow.minimumBalance < 0 ? 'negative' : ''}">${money(cashFlow.minimumBalance)}</strong></div><div><span>Fechamento previsto</span><strong>${money(cashFlow.closingBalance)}</strong></div><p>${hasRisk ? `Risco de saldo negativo: ${periods}.` : 'Nenhum intervalo negativo previsto para este mês.'}</p>`;
}

function renderCategoryChart(summary) {
  const categories = Object.entries(summary.categorias || {}).filter((entry) => entry[1] > 0).sort((a, b) => b[1] - a[1]);
  const total = categories.reduce((sum, [, value]) => sum + value, 0) || 1;
  elements.chart.hidden = categories.length === 0;
  elements.chartEmpty.hidden = categories.length > 0;
  elements.chart.innerHTML = categories.map(([name, value]) => `<button type="button" class="category-row-btn" data-category="${escapeHtml(name)}"><span class="category-name">${escapeHtml(name)}</span><span class="category-value">${money(value)}<small>${Math.round(value / total * 100)}%</small></span><span class="bar-track"><span class="bar" style="width:${value / total * 100}%"></span></span></button>`).join('');
  const expenses = state.transactions.filter((item) => ['Despesa', 'Pagamento Fatura'].includes(item.tipo)).length;
  document.querySelector('#expense-count').textContent = `${expenses} ${expenses === 1 ? 'lançamento' : 'lançamentos'}`;
}

function openCategorySheet(name) {
  const items = state.transactions
    .filter((item) => ['Despesa', 'Pagamento Fatura'].includes(item.tipo) && macroCategory(item.categoria) === name)
    .sort((a, b) => b.valor - a.valor);
  const total = items.reduce((sum, item) => sum + item.valor, 0);
  const sheet = document.querySelector('#action-sheet');
  sheet.dataset.id = '';
  sheet.innerHTML = `<div class="sheet-body"><span class="sheet-handle" aria-hidden="true"></span><p class="sheet-title">${escapeHtml(name)}</p><p class="sheet-sub">${money(total)} em ${items.length} ${items.length === 1 ? 'lançamento' : 'lançamentos'}</p><div class="sheet-list">${items.map((item) => `<div class="sheet-list-row"><div><strong>${escapeHtml(item.descricao)}</strong><span>${shortDate(item.data)} · ${escapeHtml(item.categoria || '')}</span></div><strong class="expense-value">${money(item.valor)}</strong></div>`).join('') || '<p class="muted-copy">Nenhum lançamento nesta categoria.</p>'}</div><div class="sheet-actions"><button type="button" class="cancel" data-sheet-action="cancel">Fechar</button></div></div>`;
  sheet.showModal();
  sheet.querySelector('.cancel')?.focus();
}

function handleCategoryClick(event) {
  const name = event.target.closest('[data-category]')?.dataset.category;
  if (name) openCategorySheet(name);
}

function shortMonthName(month) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(`${month}-01T12:00:00`)).replace('.', '');
}

function renderAnalysis() {
  const all = state.analysis.months || [];
  const months = all.slice(-(state.analysisPeriod || 3));
  const values = months.map((month) => month.total);
  const current = all.at(-1)?.total || 0;
  const previous = all.at(-2);
  document.querySelector('#analysis-month-label').textContent = `Gasto em ${fullMonthLabel(elements.month.value)}`;
  document.querySelector('#analysis-total').textContent = money(current);
  const badge = document.querySelector('#analysis-trend');
  if (previous?.total > 0) {
    const change = Math.round((current - previous.total) / previous.total * 100);
    badge.hidden = false;
    badge.className = `trend-badge ${change <= 0 ? 'good' : 'bad'}`;
    badge.textContent = `${change > 0 ? '+' : ''}${change}% vs ${fullMonthLabel(previous.month)}`;
  } else {
    badge.hidden = true;
  }
  document.querySelectorAll('[data-period]').forEach((button) => button.classList.toggle('active', Number(button.dataset.period) === (state.analysisPeriod || 3)));
  const maximum = Math.max(...values, 1);
  document.querySelector('#trend-chart').innerHTML = months.length ? `<div class="period-bars">${months.map((month, index) => `<div class="period-bar ${index === months.length - 1 ? 'current' : ''}" title="${monthLabel(month.month)}: ${money(values[index])}"><span class="period-track"><span class="period-fill" style="height:${Math.max(3, values[index] / maximum * 100)}%"></span></span><small>${shortMonthName(month.month)}</small></div>`).join('')}</div>` : '<p class="muted-copy">Histórico indisponível.</p>';
  const filled = values.filter((value) => value > 0);
  const average = filled.reduce((sum, value) => sum + value, 0) / Math.max(1, filled.length);
  const highestIndex = values.indexOf(Math.max(...values, 0));
  document.querySelector('#trend-metrics').innerHTML = `<div><span>Média dos meses com gasto</span><strong>${money(average)}</strong></div><div><span>Maior mês</span><strong>${highestIndex >= 0 && values[highestIndex] > 0 ? `${money(values[highestIndex])} · ${shortMonthName(months[highestIndex].month)}` : '—'}</strong></div>`;
  const responsibleValues = all.at(-1)?.responsibles || {};
  const colors = { Ele: 'var(--green)', Ela: '#e99d7d', Nós: '#5cb8cc' };
  const responsibles = [...new Set(['Ele', 'Ela', 'Nós', ...Object.keys(responsibleValues)])].map((name) => [name, Math.max(0, responsibleValues[name] || 0)]);
  const responsibleTotal = responsibles.reduce((sum, [, value]) => sum + value, 0);
  document.querySelector('#responsible-chart').innerHTML = responsibleTotal > 0
    ? `<div class="split-bar">${responsibles.filter(([, value]) => value > 0).map(([name, value]) => `<span style="width:${value / responsibleTotal * 100}%;background:${colors[name] || '#8fa39a'}" title="${escapeHtml(responsibleName(name))}"></span>`).join('')}</div><div class="split-legend">${responsibles.map(([name, value]) => `<div><i style="background:${colors[name] || '#8fa39a'}"></i><span>${escapeHtml(responsibleName(name))}</span><strong>${money(value)}</strong><small>${Math.round(value / responsibleTotal * 100)}%</small></div>`).join('')}</div>`
    : '<p class="muted-copy">Sem despesas no período.</p>';
}

function handleAnalysisPeriod(event) {
  const button = event.target.closest('[data-period]');
  if (!button) return;
  state.analysisPeriod = Number(button.dataset.period);
  renderAnalysis();
}

function boxRing(percent) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return `<span class="box-ring" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="${radius}" class="ring-track"/><circle cx="26" cy="26" r="${radius}" class="ring-fill" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/></svg><b>${Math.round(percent)}%</b></span>`;
}

function projectionText(projection) {
  if (!projection) return '';
  if (projection.status === 'reached') return 'Meta atingida';
  if (projection.status === 'no-contribution') return 'Sem aporte recorrente no histórico';
  return `Meta em ${fullMonthLabel(projection.targetMonth)} de ${projection.targetMonth.slice(0, 4)} · ${money(projection.monthlyAverage)}/mês`;
}

function renderBoxes(boxes) {
  const total = boxes.reduce((sum, box) => sum + box.saldo, 0);
  const goals = boxes.reduce((sum, box) => sum + (box.meta || 0), 0);
  document.querySelector('#boxes-total').textContent = money(total);
  const subtitle = document.querySelector('#boxes-subtitle');
  if (subtitle) subtitle.textContent = boxes.length ? `${boxes.length} ${boxes.length === 1 ? 'caixinha' : 'caixinhas'} · ${goals > 0 ? Math.round(total / goals * 100) : 0}% das metas` : '';
  elements.boxes.innerHTML = boxes.length ? boxes.map((box) => {
    const name = escapeHtml(box.nome);
    return `<article class="box-item"><button type="button" class="box-top" data-box-plan="${name}" aria-label="Abrir a caixinha ${name}">${boxRing(box.progresso || 0)}<span class="box-info"><strong>${name}</strong><span>${money(box.saldo)} de ${money(box.meta)}</span><small>${escapeHtml(projectionText(box.projection))}</small></span></button><button type="button" class="box-save" data-save-box="${name}">Guardar</button><button type="button" class="box-more" data-box-plan="${name}" aria-label="Planejar, histórico e meta de ${name}">›</button></article>`;
  }).join('') : '<div class="check-empty"><p>Nenhuma caixinha configurada.</p></div>';
  const favoriteList = document.querySelector('#favorite-box-list');
  if (favoriteList) favoriteList.innerHTML = '';
}

function monthsBetween(from, to) {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear * 12 + toMonth) - (fromYear * 12 + fromMonth);
}

function openBoxSheet(name) {
  const box = (state.summary?.caixinhas || []).find((item) => item.nome === name);
  if (!box) return;
  const baseMonth = todayText().slice(0, 7);
  const defaultTarget = box.projection?.status === 'projected' ? box.projection.targetMonth : shiftMonthKeyLocal(baseMonth, 12);
  const sheet = document.querySelector('#action-sheet');
  sheet.dataset.id = '';
  sheet.dataset.box = box.nome;
  sheet.innerHTML = `<div class="sheet-body"><span class="sheet-handle" aria-hidden="true"></span><p class="sheet-title">${escapeHtml(box.nome)}</p><p class="sheet-sub">${money(box.saldo)} de ${money(box.meta)} · ${Math.round(box.progresso || 0)}%</p>
    <p class="box-sheet-projection">${escapeHtml(projectionText(box.projection))}</p>
    <div class="box-target"><label class="field"><span>Quero chegar à meta até</span><input type="month" id="box-target-month" min="${shiftMonthKeyLocal(baseMonth, 1)}" value="${defaultTarget}"></label><p id="box-target-result"></p></div>
    <div class="sheet-actions"><button type="button" data-sheet-action="box-save"><span aria-hidden="true">+</span>Guardar</button><button type="button" data-sheet-action="box-history"><span aria-hidden="true">◷</span>Ver histórico</button><button type="button" data-sheet-action="box-edit"><span aria-hidden="true">✎</span>Editar meta</button><button type="button" class="cancel" data-sheet-action="cancel">Fechar</button></div></div>`;
  const input = sheet.querySelector('#box-target-month');
  const result = sheet.querySelector('#box-target-result');
  const update = () => {
    const months = monthsBetween(baseMonth, input.value || baseMonth);
    const missing = Math.max(0, box.meta - box.saldo);
    if (!missing) result.textContent = 'Essa meta já foi atingida.';
    else if (months <= 0) result.textContent = 'Escolha um mês depois do atual.';
    else result.innerHTML = `Guardem <strong>${money(missing / months)}</strong> por mês durante ${months} ${months === 1 ? 'mês' : 'meses'}.`;
  };
  input.addEventListener('input', update);
  update();
  sheet.showModal();
  sheet.querySelector('.cancel')?.focus();
}

function openBoxHistory(name) {
  const box = (state.summary?.caixinhas || []).find((item) => item.nome === name);
  if (!box) return;
  // Sem o histórico do servidor (modo demonstração), mostra os movimentos do mês.
  const history = box.history || state.transactions
    .filter((item) => (item.origem === box.nome || item.categoria === box.nome) && ['Depósito', 'Depósito Caixinha', 'Resgate'].includes(item.tipo))
    .sort((a, b) => b.data.localeCompare(a.data));
  const isOut = (item) => ['Resgate', 'Despesa'].includes(item.tipo);
  const saved = history.filter((item) => !isOut(item)).reduce((sum, item) => sum + item.valor, 0);
  const withdrawn = history.filter(isOut).reduce((sum, item) => sum + item.valor, 0);
  const sheet = document.querySelector('#action-sheet');
  sheet.dataset.id = '';
  sheet.dataset.box = box.nome;
  sheet.innerHTML = `<div class="sheet-body"><span class="sheet-handle" aria-hidden="true"></span><p class="sheet-title">Histórico · ${escapeHtml(box.nome)}</p><p class="sheet-sub">Guardado ${money(saved)}${withdrawn ? ` · Resgatado ${money(withdrawn)}` : ''}</p><div class="sheet-list sheet-list-tall">${history.map((item) => `<div class="sheet-list-row"><div><strong>${escapeHtml(item.descricao)}</strong><span>${fullDate(item.data)} · ${escapeHtml(item.tipo)}</span></div><strong class="${isOut(item) ? 'expense-value' : 'income-value'}">${isOut(item) ? '− ' : '+ '}${money(item.valor)}</strong></div>`).join('') || '<p class="muted-copy">Nenhum depósito registrado ainda.</p>'}</div><div class="sheet-actions"><button type="button" data-sheet-action="box-save"><span aria-hidden="true">+</span>Guardar</button><button type="button" class="cancel" data-sheet-action="cancel">Fechar</button></div></div>`;
  sheet.showModal();
  sheet.querySelector('.cancel')?.focus();
}

function shiftMonthKeyLocal(month, amount) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function openBoxEditor(name) {
  const box = state.configuration.caixinhas.find((item) => item.nome === name);
  if (!box) return;
  elements.boxForm.elements.currentName.value = box.nome;
  elements.boxForm.elements.nome.value = box.nome;
  elements.boxForm.elements.meta.value = box.meta;
  elements.boxDialog.showModal();
  setTimeout(() => elements.boxForm.elements.nome.focus(), 0);
}

function handleBoxAction(event) {
  const saveName = event.target.closest('[data-save-box]')?.dataset.saveBox;
  if (saveName) return openBoxDeposit(saveName);
  const editName = event.target.closest('[data-edit-box]')?.dataset.editBox;
  if (editName) return openBoxEditor(editName);
  const historyName = event.target.closest('[data-box-history]')?.dataset.boxHistory;
  if (historyName) return openBoxHistory(historyName);
  const planName = event.target.closest('[data-box-plan]')?.dataset.boxPlan;
  if (planName) openBoxSheet(planName);
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
  const today = todayText();
  const weekEnd = shiftDateLocal(today, 6);
  const filter = state.transactionFilter;
  const matchesFilter = (item) => filter === 'all'
    || (filter === 'payable' && ['Despesa', 'Pagamento Fatura'].includes(item.tipo))
    || (filter === 'receivable' && item.tipo === 'Receita');
  const items = state.transactions
    .filter((item) => item.fonte !== 'pluggy' && matchesFilter(item) && (!query || normalize(`${item.descricao} ${item.categoria} ${item.responsavel} ${item.cartao || ''}`).includes(query)))
    .sort((a, b) => a.data.localeCompare(b.data) || (a.ordem || 0) - (b.ordem || 0));
  const done = items.filter(isTransactionDone);
  const open = items.filter((item) => !isTransactionDone(item));
  const remaining = open.reduce((sum, item) => sum + item.valor, 0);
  const words = { payable: ['pagas', 'a pagar', 'Pagas'], receivable: ['recebidas', 'a receber', 'Recebidas'], all: ['concluídos', 'pendentes', 'Concluídos'] }[filter] || ['concluídos', 'pendentes', 'Concluídos'];
  document.querySelector('#transaction-count').textContent = `${items.length} ${items.length === 1 ? 'lançamento' : 'lançamentos'} no período`;
  document.querySelector('#transaction-progress-label').textContent = items.length ? `${done.length} de ${items.length} ${words[0]} · ${money(remaining)} ${words[1]}` : 'Nada por aqui neste mês';
  document.querySelector('#transaction-progress-bar').style.width = `${items.length ? done.length / items.length * 100 : 0}%`;
  const groups = [
    ['Atrasadas', open.filter((item) => item.data < today), 'overdue'],
    ['Esta semana', open.filter((item) => item.data >= today && item.data <= weekEnd), ''],
    ['Mais tarde', open.filter((item) => item.data > weekEnd), '']
  ].filter(([, list]) => list.length);
  const groupHtml = groups.map(([title, list, tone]) => `<section class="check-group ${tone}"><h3 class="check-group-title">${title}<span>${list.length}</span></h3><div class="check-list">${list.map((item) => checkRow(item, today)).join('')}</div></section>`).join('');
  const doneHtml = done.length ? `<details class="check-group done-group"><summary class="check-group-title">${words[2]}<span>${done.length}</span></summary><div class="check-list">${done.map((item) => checkRow(item, today)).join('')}</div></details>` : '';
  elements.list.innerHTML = groupHtml + doneHtml || '<div class="check-empty"><p>Nenhum lançamento encontrado.</p></div>';
}

function isTransactionDone(item) {
  return ['Pago', 'Paga'].includes(item.status);
}

function checkRow(item, today) {
  const positive = ['Receita', 'Resgate', 'Estorno'].includes(item.tipo);
  const deposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
  const bill = item.fonte === 'pluggy-bill';
  const locked = bill && ['Aberta', 'Projetada'].includes(item.situacao);
  const paid = isTransactionDone(item);
  const overdue = !paid && item.data < today;
  const when = paid ? `${positive ? 'Recebido' : 'Pago'} ${shortDate(item.data)}` : `${overdue ? 'Venceu' : positive ? 'Entra' : 'Vence'} ${shortDate(item.data)}`;
  const tag = bill ? (item.estimada ? ' · estimativa' : item.ajustada ? ' · ajustada' : '') : '';
  const meta = `${when}${item.categoria ? ` · ${escapeHtml(item.categoria)}` : ''}${item.cartao ? ` · ${escapeHtml(item.cartao)}` : ''}${tag}`;
  const valueClass = deposit ? 'deposit' : positive ? 'income-value' : 'expense-value';
  const sign = deposit ? '' : positive ? '+ ' : '− ';
  const label = `${paid ? 'Desmarcar' : 'Marcar'} ${escapeHtml(item.descricao)} como ${positive ? 'recebido' : 'pago'}`;
  return `<div class="check-row ${paid ? 'done' : ''} ${overdue ? 'overdue' : ''}"><button type="button" class="check-circle ${paid ? 'checked' : ''}" ${deposit || locked ? 'disabled' : `data-status="${escapeHtml(item.id)}"`} aria-label="${label}">${paid ? iconSvg('check') : ''}</button><button type="button" class="check-main" data-open-actions="${escapeHtml(item.id)}" title="Opções do lançamento"><span class="check-text"><strong>${escapeHtml(item.descricao)}</strong><span>${meta}</span></span><strong class="check-value ${valueClass}">${sign}${money(item.valor)}</strong><span class="row-more" aria-hidden="true">⋮</span></button></div>`;
}

function openActionSheet(id) {
  const item = state.transactions.find((entry) => entry.id === id);
  if (!item) return;
  const positive = ['Receita', 'Resgate', 'Estorno'].includes(item.tipo);
  const deposit = ['Depósito', 'Depósito Caixinha'].includes(item.tipo);
  const bill = item.fonte === 'pluggy-bill';
  const locked = bill && ['Aberta', 'Projetada'].includes(item.situacao);
  const paid = isTransactionDone(item);
  const actions = [];
  if (!deposit && !locked) actions.push(['toggle', paid ? `Marcar como ${positive ? 'não recebido' : 'pendente'}` : `Marcar como ${positive ? 'recebido' : 'pago'}`, '✓']);
  if (bill && !locked) actions.push(['bill', 'Ajustar valor da fatura', '✎']);
  if (!bill) actions.push(['edit', 'Editar', '✎'], ['delete', 'Excluir', '✕']);
  const sheet = document.querySelector('#action-sheet');
  sheet.dataset.id = id;
  sheet.innerHTML = `<div class="sheet-body"><span class="sheet-handle" aria-hidden="true"></span><p class="sheet-title">${escapeHtml(item.descricao)}</p><p class="sheet-sub">${deposit ? '' : positive ? '+ ' : '− '}${money(item.valor)} · ${fullDate(item.data)}${item.categoria ? ` · ${escapeHtml(item.categoria)}` : ''}</p><div class="sheet-actions">${actions.map(([action, label, icon]) => `<button type="button" data-sheet-action="${action}" class="${action === 'delete' ? 'danger' : ''}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}<button type="button" class="cancel" data-sheet-action="cancel">Cancelar</button></div></div>`;
  sheet.showModal();
  sheet.querySelector('.cancel')?.focus();
}

function handleSheetAction(event) {
  const sheet = event.currentTarget;
  if (event.target === sheet) return sheet.close();
  const button = event.target.closest('[data-sheet-action]');
  if (!button) return;
  const action = button.dataset.sheetAction;
  sheet.close();
  if (action === 'box-save') return openBoxDeposit(sheet.dataset.box);
  if (action === 'box-edit') return openBoxEditor(sheet.dataset.box);
  if (action === 'box-history') return openBoxHistory(sheet.dataset.box);
  const item = state.transactions.find((entry) => entry.id === sheet.dataset.id);
  if (!item) return;
  if (action === 'toggle') return toggleStatus(item.id, button);
  if (action === 'edit') return openForm(item);
  if (action === 'bill') return openBillForm(item);
  if (action === 'delete') return deleteTransactionById(item.id);
}

function toggleListSearch() {
  const field = document.querySelector('#list-search');
  field.hidden = !field.hidden;
  document.querySelector('#search-toggle').setAttribute('aria-expanded', String(!field.hidden));
  if (!field.hidden) document.querySelector('#transaction-search').focus();
}

function openBoxDeposit(name) {
  openForm(null, 'Depósito');
  const select = document.querySelector('#box-select');
  if (select) select.value = name;
  elements.form.elements.descricao.value = `Guardar em ${name}`;
  document.querySelector('#dialog-title').textContent = `Guardar em ${name}`;
}

function renderCards() {
  const data = state.cardsData || {};
  const cards = data.cards || [];
  const bills = data.bills || [];
  const budget = data.budget || {};
  const monthLabel = fullMonthLabel(data.spendingMonth || elements.month.value);
  if (!cards.some((card) => card.id === state.selectedCardId)) state.selectedCardId = cards[0]?.id || 'all';
  document.querySelector('#bank-balance').textContent = money(data.bankBalance || 0);
  document.querySelector('#card-available-total').textContent = cards.length ? money(data.availableLimit || 0) : '—';
  const status = document.querySelector('#pluggy-status');
  status.textContent = data.error || (data.items?.length ? `${data.items.length} instituição(ões) sincronizada(s)` : data.hasConfiguredItems ? 'Toque em sincronizar para a primeira importação.' : 'Configure os Item IDs da Pluggy na Vercel.');
  status.classList.toggle('error-copy', Boolean(data.error));
  renderCeiling(data, budget, monthLabel);
  document.querySelector('#connected-card-grid').innerHTML = cards.length ? cards.map((card, index) => {
    const billTotal = bills.filter((bill) => bill.accountId === card.id).reduce((sum, bill) => sum + bill.valor, 0);
    const active = state.selectedCardId === card.id;
    return `<button type="button" class="connected-card card-tone-${index % 3} ${active ? 'active' : ''}" data-card-id="${escapeHtml(card.id)}" aria-pressed="${active}"><span class="card-face-top"><span class="card-issuer">${escapeHtml(card.institution)}</span>${brandMark(card.brand)}</span><span class="card-chip" aria-hidden="true"></span><span class="card-number">•••• ${escapeHtml(String(card.number).slice(-4))}</span><span class="card-face-bottom"><span class="card-holder">${escapeHtml(card.name)}</span><span class="card-face-bill">${money(billTotal)}</span></span></button>`;
  }).join('') : '<div class="cards-empty"><p>Nenhum cartão conectado.</p></div>';
  renderSelectedCard(data, monthLabel);
  renderCardTransactions();
}

function renderSelectedCard(data, monthLabel) {
  const container = document.querySelector('#selected-card-detail');
  const card = (data.cards || []).find((item) => item.id === state.selectedCardId);
  if (!card) {
    container.innerHTML = '';
    return;
  }
  const cardBills = (data.bills || []).filter((bill) => bill.accountId === card.id);
  const billTotal = cardBills.reduce((sum, bill) => sum + bill.valor, 0);
  const dueDate = cardBills[0]?.data ? ` · vence ${shortDate(cardBills[0].data)}` : '';
  const billStatus = cardBills.length ? `${cardBills.map((bill) => (bill.estimada ? 'Estimativa' : bill.status)).join(' · ')}${dueDate}` : 'Sem fatura neste mês';
  const nextBill = (data.nextBills || []).find((bill) => bill.accountId === card.id && bill.valor > 0);
  const nextLabel = fullMonthLabel(data.paymentMonth || elements.month.value);
  const used = card.creditLimit > 0 ? Math.min(100, Math.max(0, (card.usedLimit || 0) / card.creditLimit * 100)) : 0;
  const owners = [['Ele', 'Danilo'], ['Ela', 'Talyta'], ['Nós', 'Casal']].map(([value, label]) => `<option value="${value}" ${card.responsavel === value ? 'selected' : ''}>${label}</option>`).join('');
  container.innerHTML = `<article class="card-detail">
    <p class="card-detail-label">Fatura de ${monthLabel}</p>
    <strong class="card-detail-value">${cardBills.length ? money(billTotal) : '—'}</strong>
    <p class="card-detail-status">${escapeHtml(billStatus)}</p>
    <div class="limit-bar" role="progressbar" aria-label="Limite usado" aria-valuenow="${Math.round(used)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${used}%"></span></div>
    <div class="limit-row"><span>Usado ${money(card.usedLimit || 0)}</span><span>Disponível ${money(card.availableLimit || 0)}</span></div>
    <p class="card-detail-next">Próxima (${nextLabel}): ${nextBill ? `${money(nextBill.valor)} · ${nextBill.estimada ? 'estimativa' : 'oficial'}` : 'sem previsão'}</p>
    <div class="card-actions">
      <button type="button" data-bill-history="${escapeHtml(card.id)}"><span class="action-icon" aria-hidden="true">▥</span>Histórico</button>
      <button type="button" data-show-purchases><span class="action-icon" aria-hidden="true">≡</span>Compras</button>
      <label><span class="action-icon" aria-hidden="true">◐</span><select data-card-owner="${escapeHtml(card.id)}" aria-label="Responsável pelo cartão">${owners}</select></label>
    </div>
  </article>`;
}

function handleCardDetail(event) {
  const historyId = event.target.closest('[data-bill-history]')?.dataset.billHistory;
  if (historyId) return openBillHistory(historyId);
  if (event.target.closest('[data-show-purchases]')) document.querySelector('.card-expenses-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function brandMark(brand) {
  const name = String(brand || '').toUpperCase();
  if (name.includes('MASTER')) return '<span class="card-brand-mark" aria-label="Mastercard"><svg viewBox="0 0 48 30" aria-hidden="true"><circle cx="18" cy="15" r="12" fill="#eb001b"/><circle cx="30" cy="15" r="12" fill="#f79e1b" fill-opacity=".92"/></svg></span>';
  if (name.includes('VISA')) return '<span class="card-brand-mark brand-visa">VISA</span>';
  return `<span class="card-brand-mark brand-text">${escapeHtml(name || 'CARTÃO')}</span>`;
}

function renderTrend(selector, current, previous, mode) {
  const badge = document.querySelector(selector);
  if (!state.comparison || !(previous > 0)) {
    badge.hidden = true;
    return;
  }
  const change = Math.round((current - previous) / previous * 100);
  const good = mode === 'up-good' ? change >= 0 : change <= 0;
  badge.hidden = false;
  badge.className = `trend-badge ${good ? 'good' : 'bad'}`;
  badge.textContent = `${change > 0 ? '+' : ''}${change}% vs ${fullMonthLabel(state.comparison.month)}`;
}

function renderUpcoming() {
  const today = todayText();
  const items = state.transactions
    .filter((item) => item.status === 'Pendente' && item.data && ['Despesa', 'Pagamento Fatura', 'Receita'].includes(item.tipo) && item.fonte !== 'pluggy' && !['Aberta', 'Projetada'].includes(item.situacao))
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 3);
  document.querySelector('#upcoming-list').innerHTML = items.length ? items.map((item) => {
    const income = item.tipo === 'Receita';
    const overdue = item.data < today;
    const label = income ? 'recebido' : 'pago';
    return `<div class="upcoming-row ${overdue ? 'overdue' : ''}"><button class="status-toggle" data-status="${escapeHtml(item.id)}" title="Marcar como ${label}" aria-label="Marcar ${escapeHtml(item.descricao)} como ${label}"></button><div class="upcoming-info"><strong>${escapeHtml(item.descricao)}</strong><span>${overdue ? 'Venceu' : income ? 'Entra' : 'Vence'} ${shortDate(item.data)}${item.categoria ? ` · ${escapeHtml(item.categoria)}` : ''}</span></div><strong class="${income ? 'income-value' : 'expense-value'}">${income ? '+' : '−'} ${money(item.valor)}</strong></div>`;
  }).join('') : '<p class="muted-copy">Tudo em dia neste mês.</p>';
}

function toggleFab(event) {
  event.stopPropagation();
  const menu = document.querySelector('#fab-menu');
  const open = menu.hidden;
  menu.hidden = !open;
  document.querySelector('#fab-button').setAttribute('aria-expanded', String(open));
  document.querySelector('#fab').classList.toggle('open', open);
}

function closeFab() {
  const menu = document.querySelector('#fab-menu');
  if (menu.hidden) return;
  menu.hidden = true;
  document.querySelector('#fab-button').setAttribute('aria-expanded', 'false');
  document.querySelector('#fab').classList.remove('open');
}

function handleFabAction(event) {
  const action = event.target.closest('[data-fab-action]')?.dataset.fabAction;
  if (!action) return;
  closeFab();
  if (action === 'sync') return synchronizePluggy();
  openForm(null, { despesa: 'Despesa', receita: 'Receita', caixinha: 'Depósito' }[action]);
}

function compactMoney(value) {
  return `R$ ${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)}`;
}

function openBillHistory(id) {
  const card = (state.cardsData.cards || []).find((item) => item.id === id);
  // Histórico termina no mês selecionado: parcelas futuras não são faturas passadas.
  const cutoff = elements.month.value;
  const history = ((state.cardsData.billHistory || {})[id] || []).filter((bill) => bill.mesRef <= cutoff).slice(-12);
  const official = history.filter((bill) => !bill.estimada);
  const average = official.length ? official.reduce((sum, bill) => sum + bill.valor, 0) / official.length : 0;
  const highest = official.reduce((max, bill) => (bill.valor > (max?.valor || 0) ? bill : max), null);
  document.querySelector('#bill-history-title').textContent = card ? `${card.name} · ${String(card.number).slice(-4)}` : 'Cartão';
  document.querySelector('#bill-history-stats').innerHTML = `<div><span>Média das faturas</span><strong>${money(average)}</strong></div><div><span>Maior fatura</span><strong>${highest ? `${money(highest.valor)} · ${monthLabel(highest.mesRef)}` : '—'}</strong></div><div><span>Faturas registradas</span><strong>${official.length}</strong></div>`;
  const maximum = Math.max(...history.map((bill) => bill.valor), 1);
  const chart = document.querySelector('#bill-history-chart');
  chart.innerHTML = history.length ? `<div class="history-bars">${history.map((bill) => `<div class="history-bar ${bill.estimada ? 'estimated' : ''} ${bill.mesRef === elements.month.value ? 'current' : ''}" title="${monthLabel(bill.mesRef)}: ${money(bill.valor)}${bill.estimada ? ' (estimativa)' : ''}"><span class="history-value">${compactMoney(bill.valor)}</span><span class="history-track"><span class="history-fill" style="height:${Math.max(3, bill.valor / maximum * 100)}%"></span></span><small>${monthLabel(bill.mesRef)}</small></div>`).join('')}</div>` : '<p class="muted-copy">Nenhuma fatura registrada para este cartão.</p>';
  document.querySelector('#bill-history-list').innerHTML = [...history].reverse().slice(0, 12).map((bill) => `<div class="history-row"><span>${monthLabel(bill.mesRef)}</span><span class="history-status">${bill.estimada ? 'Estimativa' : bill.ajustada ? 'Ajustada' : escapeHtml(bill.status || '')}</span><strong>${money(bill.valor)}</strong></div>`).join('');
  document.querySelector('#bill-history-dialog').showModal();
  requestAnimationFrame(() => {
    const bars = chart.querySelector('.history-bars');
    if (bars) bars.scrollLeft = bars.scrollWidth;
  });
}

let pushPublicKey = '';

async function setupReminders() {
  const button = document.querySelector('#enable-reminders');
  if (currentSession?.demo || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  try {
    pushPublicKey = (await fetch('/api/config').then((response) => response.json())).vapidPublicKey || '';
    if (!pushPublicKey) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    button.hidden = Boolean(existing) && Notification.permission === 'granted';
  } catch {
    button.hidden = true;
  }
}

async function enableReminders() {
  const button = document.querySelector('#enable-reminders');
  button.disabled = true;
  try {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Permita as notificações do navegador para receber os lembretes.');
    const registration = await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription())
      || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushPublicKey) });
    await subscribePush(subscription.toJSON());
    button.hidden = true;
    notify('Lembretes ativados: você recebe um aviso dois dias antes de cada vencimento.');
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

function urlBase64ToUint8Array(value) {
  const base64 = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function renderCeiling(data, budget, monthLabel) {
  const lines = [
    ...(data.bills || []).map((bill) => ({ label: bill.descricao, detail: `vence ${fullDate(bill.data)} · ${bill.estimada ? 'estimativa' : bill.status}`, value: bill.valor })),
    ...(data.manualBills || []).map((item) => ({ label: `${item.cartao} (manual)`, detail: `vence ${fullDate(item.data)} · ${item.status}`, value: item.valor }))
  ];
  const panel = document.querySelector('#ceiling-panel');
  if (!lines.length && !budget.consumption) {
    panel.innerHTML = `<div class="ceiling-compact"><div class="ceiling-compact-head"><span>Teto do mês</span><strong>Sem dados</strong></div><p>Sincronize os bancos para ver os vencimentos de ${monthLabel}.</p></div>`;
    return;
  }
  const remaining = Number(budget.remaining || 0);
  const over = remaining < 0;
  const used = budget.ceiling > 0 ? Math.min(100, (budget.consumption || 0) / budget.ceiling * 100) : 0;
  const rows = lines.map((line) => `<div class="ceiling-line"><div><strong>${escapeHtml(line.label)}</strong><span>${escapeHtml(line.detail)}</span></div><strong>${money(line.value)}</strong></div>`).join('');
  panel.innerHTML = `<div class="ceiling-compact">
    <div class="ceiling-compact-head"><span>Teto do mês</span><strong class="${over ? 'negative' : 'positive'}">${over ? `Passou ${money(-remaining)}` : `Faltam ${money(remaining)}`}</strong></div>
    <div class="ceiling-bar ${over ? 'over' : ''}"><span style="width:${used}%"></span></div>
    <p>${money(budget.consumption || 0)} de ${money(budget.ceiling || 0)} em vencimentos de ${monthLabel}</p>
    <details class="ceiling-details"><summary>Ver vencimentos</summary><div class="ceiling-lines">${rows}</div></details>
  </div>`;
}

function renderHomeHero(summary) {
  const cycles = state.cashCycles || calculateLocalCashCycles();
  const today = todayText();
  const current = (cycles.cycles || []).find((cycle) => cycle.start <= today && today <= cycle.end);
  const free = document.querySelector('#home-free');
  if (current) {
    free.hidden = false;
    free.className = `home-free ${current.status === 'falta' ? 'negative' : ''}`;
    free.innerHTML = current.status === 'falta'
      ? `Faltam <strong>${money(current.falta)}</strong> até ${shortDate(current.end)}`
      : `<strong>${money(Math.max(0, cycles.safeToSpend ?? current.livre))}</strong> livres até ${shortDate(current.end)}`;
  } else {
    free.hidden = true;
  }
  const committed = summary.receitas > 0 ? summary.despesas / summary.receitas * 100 : 0;
  const progress = document.querySelector('#home-progress');
  progress.hidden = !(summary.receitas > 0);
  progress.querySelector('span').style.width = `${Math.min(100, committed)}%`;
  progress.classList.toggle('over', committed > 100);
  document.querySelector('#home-progress-label').textContent = summary.receitas > 0 ? `${Math.round(committed)}% das receitas do mês já comprometidas` : '';
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
  const historyId = event.target.closest('[data-bill-history]')?.dataset.billHistory;
  if (historyId) return openBillHistory(historyId);
  const id = event.target.closest('[data-card-id]')?.dataset.cardId;
  if (!id) return;
  state.selectedCardId = id;
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
  if (currentSession?.demo) return notify('A sincronização com os bancos funciona só com o login Google.');
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

function handleFilter(event) {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.transactionFilter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
  renderTransactions();
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

function openForm(transaction = null, presetType = null) {
  if (transaction?.fonte === 'pluggy') return notify('Este lançamento é atualizado automaticamente pela instituição.', true);
  elements.form.reset();
  populateSelects();
  document.querySelector('#dialog-title').textContent = transaction ? 'Editar lançamento' : ({ Receita: 'Nova receita', Despesa: 'Nova despesa', 'Depósito': 'Guardar na caixinha' })[presetType] || 'Novo lançamento';
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
    if (presetType) elements.form.elements.tipo.value = presetType;
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
  const actionsId = event.target.closest('[data-open-actions]')?.dataset.openActions;
  if (billId) return openBillForm(state.transactions.find((item) => item.id === billId));
  if (editId) return openForm(state.transactions.find((item) => item.id === editId));
  if (statusId) return toggleStatus(statusId, event.target.closest('[data-status]'));
  if (actionsId) return openActionSheet(actionsId);
  if (deleteId) return deleteTransactionById(deleteId);
}

async function deleteTransactionById(id) {
  const transaction = state.transactions.find((item) => item.id === id);
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
  return `<article class="cycle-card ${cycle.status} ${timing}"><p class="cycle-start">${starter}</p><h3>${shortDate(cycle.start)} a ${shortDate(cycle.end)}</h3><div class="cycle-row"><span>Saldo no início</span><strong>${money(cycle.saldoInicio)}</strong></div><div class="cycle-row"><span>Compromissos</span><strong>${money(cycle.compromissos)}</strong></div><div class="cycle-row"><span>Menor saldo</span><strong class="${cycle.menorSaldo < 0 ? 'negative' : ''}">${money(cycle.menorSaldo)}</strong></div><span class="cycle-pill ${cycle.status}">${pill}</span></article>`;
}

function todayText() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function monthEffectLocal(item) {
  if (item.tipo === 'Receita' || item.tipo === 'Estorno') return Number(item.valor || 0);
  if (item.tipo === 'Despesa' || item.tipo === 'Pagamento Fatura') return -Number(item.valor || 0);
  return 0;
}

function calculateLocalLedger() {
  const month = elements.month.value;
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const movements = new Map();
  for (const item of state.transactions) {
    if (!item.data || !item.data.startsWith(`${month}-`)) continue;
    movements.set(item.data, (movements.get(item.data) || 0) + monthEffectLocal(item));
  }
  let balance = 0;
  return Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const movement = movements.get(date) || 0;
    balance += movement;
    return { date, movement, balance };
  });
}

function calculateLocalCashCycles() {
  const today = todayText();
  const month = elements.month.value;
  if (month < today.slice(0, 7)) return { pastMonth: true, cycles: [], safeToSpend: null };
  const points = calculateLocalLedger();
  const monthEnd = points.at(-1).date;
  const receipts = state.transactions.filter((item) => item.tipo === 'Receita' && item.data && item.data.startsWith(`${month}-`)).sort((a, b) => a.data.localeCompare(b.data));
  const boundaries = [...new Set([`${month}-01`, ...receipts.map((item) => item.data)])].sort();
  const cycles = boundaries.map((start, index) => {
    const end = boundaries[index + 1] ? shiftDateLocal(boundaries[index + 1], -1) : monthEnd;
    const days = points.filter((point) => point.date >= start && point.date <= end);
    const menorSaldo = Math.min(...days.map((point) => point.balance));
    const future = days.filter((point) => point.date >= today);
    const livre = future.length ? Math.min(...future.map((point) => point.balance)) : menorSaldo;
    const compromissos = days.reduce((sum, point) => sum + Math.max(0, -point.movement), 0);
    const starter = receipts.find((item) => item.data === start);
    return { start, end, inicio: starter ? { descricao: starter.descricao, valor: starter.valor, status: starter.status } : null, saldoInicio: days[0].balance, compromissos, saldoFim: days.at(-1).balance, menorSaldo, livre, status: menorSaldo < 0 ? 'falta' : 'ok', falta: Math.max(0, -menorSaldo) };
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
  const points = calculateLocalLedger();
  const negativePeriods = [];
  let open = null;
  for (const point of points) {
    if (point.balance < 0 && !open) open = { start: point.date, minimum: point.balance };
    if (point.balance < 0) open.minimum = Math.min(open.minimum, point.balance);
    if (point.balance >= 0 && open) {
      negativePeriods.push({ ...open, end: shiftDateLocal(point.date, -1) });
      open = null;
    }
  }
  if (open) negativePeriods.push({ ...open, end: points.at(-1).date });
  return { openingBalance: 0, closingBalance: points.at(-1).balance, minimumBalance: Math.min(0, ...points.map((point) => point.balance)), negativePeriods, points };
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
// Saudação com o primeiro nome e a foto da conta Google usada no login.
function renderGreeting() {
  const user = currentSession?.user || {};
  const firstName = currentSession?.demo ? 'dupla' : String(user.name || '').trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const period = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  document.querySelector('#greeting').textContent = firstName ? `${period}, ${firstName}` : period;
  const avatar = document.querySelector('#user-avatar');
  const initial = (firstName || 'D').charAt(0).toUpperCase();
  if (!user.picture || currentSession?.demo) {
    avatar.textContent = initial;
    return;
  }
  avatar.innerHTML = `<img src="${escapeHtml(user.picture)}" alt="" referrerpolicy="no-referrer">`;
  avatar.querySelector('img').addEventListener('error', () => { avatar.textContent = initial; }, { once: true });
}
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
