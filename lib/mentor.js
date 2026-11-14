'use strict';

const { createHash } = require('node:crypto');
const { currentMonth } = require('./finance');
const { buildMonthlyCardBudget, spendingFlag } = require('./budget');
const { getCardBudget } = require('./budget-service');
const sheets = require('./sheets');

const PROTECTED_RULE = 'Nunca sugira cortes em mercado ou comida basica, farmacia, saude, saude & trabalho ou restaurantes. Delivery e sempre Otimizavel e pode ser sugerido.';

async function generateSyncInsight(month = currentMonth()) {
  const { budget } = await getCardBudget(month);
  const input = {
    percentualConsumido: round(budget.percentage),
    tetoDoMes: round(budget.ceiling),
    margemRestante: round(budget.remaining),
    categoriasOtimizaveisRecentes: budget.optimizable.categories
  };
  const contextHash = hash(input);
  const existing = (await sheets.getMentorInsights(month)).sync;
  if (existing?.contextHash === contextHash) return existing;
  const system = `Voce e o Mentor Duo. Avalie o impacto dos gastos recentes no teto mensal. Retorne estritamente uma unica frase curta em portugues do Brasil, sem markdown, focada em frear o impulso imediato. Proponha o corte de um gasto Otimizavel iminente para proteger a faixa vermelha de 95%. ${PROTECTED_RULE} Nao invente valores.`;
  const raw = await callModel(system, input, 120);
  const insight = { scenario: 'sync', month, message: oneSentence(raw), contextHash };
  await sheets.saveMentorInsight(insight);
  return insight;
}

async function generateMonthStartInsight(month = currentMonth()) {
  const { budget, pluggyTransactions, manualTransactions, accounts, pluggyBills } = await getCardBudget(month, { persist: true });
  const previous = previousMonth(month);
  const previousSaved = await sheets.getMonthlyBudget(previous);
  const previousBudget = buildMonthlyCardBudget(previous, pluggyTransactions, manualTransactions, accounts, previousSaved, pluggyBills);
  const previousItems = pluggyTransactions.filter((item) => item.mesRef === previous);
  const optimizable = previousItems.filter((item) => spendingFlag(item) === 'Otimizável').reduce((sum, item) => sum + signed(item), 0);
  const untouchable = previousItems.filter((item) => spendingFlag(item) === 'Intocável').reduce((sum, item) => sum + signed(item), 0);
  const input = {
    mes: month,
    mediaTrimestral: round(budget.historicalAverage),
    cicloAnterior: {
      teto: round(previousBudget.ceiling),
      gastoReal: round(previousBudget.consumption),
      intocavel: round(Math.max(0, untouchable)),
      otimizavel: round(Math.max(0, optimizable)),
      faturasLeroyCamicadoSemDetalhamento: round(previousBudget.fixedSpending),
      categoriasOtimizaveis: previousBudget.optimizable.categories
    }
  };
  const contextHash = hash(input);
  const existing = (await sheets.getMentorInsights(month)).monthly;
  if (existing?.contextHash === contextHash) return existing;
  const parsed = await runMonthlyGraph(input);
  if (!parsed.percepcao || !parsed.provocacao) throw new Error('O Mentor Duo retornou uma analise incompleta.');
  const insight = { scenario: 'month_start', month, perception: String(parsed.percepcao).trim(), question: String(parsed.provocacao).trim(), contextHash };
  await sheets.saveMentorInsight(insight);
  return insight;
}

// Grafo da análise mensal: cada nó lê só o seu recorte e devolve uma observação curta.
// Os nós rodam em paralelo; a síntese recebe apenas essas observações, não os dados brutos.
// Um nó que falhar some da síntese, sem derrubar a análise inteira.
function monthlyNodes(input) {
  return [
    {
      name: 'cartoes',
      data: { tetoDoCiclo: input.cicloAnterior.teto, gastoReal: input.cicloAnterior.gastoReal, faturasSemDetalhamento: input.cicloAnterior.faturasLeroyCamicadoSemDetalhamento },
      system: 'Analise somente o consumo do teto de cartões do ciclo anterior. Responda somente JSON no formato {"observacao":"uma frase objetiva com o fato principal"}. Não invente valores.'
    },
    {
      name: 'otimizavel',
      data: { otimizavel: input.cicloAnterior.otimizavel, categoriasOtimizaveis: input.cicloAnterior.categoriasOtimizaveis },
      system: `Analise somente os gastos Otimizáveis do ciclo anterior, sem julgamento. ${PROTECTED_RULE} Responda somente JSON no formato {"observacao":"uma frase com o maior espaço de ajuste"}. Não invente valores.`
    },
    {
      name: 'intocavel',
      data: { intocavel: input.cicloAnterior.intocavel, mediaTrimestral: input.mediaTrimestral },
      system: 'Compare os gastos intocáveis do ciclo anterior com a média trimestral. Responda somente JSON no formato {"observacao":"uma frase sobre a comparação"}. Não invente valores.'
    }
  ];
}

async function runMonthlyGraph(input) {
  const nodes = monthlyNodes(input);
  const settled = await Promise.allSettled(nodes.map(async (node) => {
    const raw = await callModel(node.system, node.data, 120);
    const parsed = parseJson(raw);
    return { analise: node.name, observacao: String(parsed.observacao || oneSentence(raw)).trim() };
  }));
  const observations = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (!observations.length) throw new Error('O Mentor Duo não conseguiu analisar o ciclo.');
  const system = `Voce e o Mentor Duo, conselheiro financeiro de um casal. Você recebe observações já analisadas sobre o último ciclo. Responda somente JSON válido no formato {"percepcao":"uma percepção direta e curta","provocacao":"uma única pergunta aberta para o casal negociar uma mudança de hábito"}. ${PROTECTED_RULE} Não use markdown nem invente dados.`;
  return parseJson(await callModel(system, { mes: input.mes, observacoes: observations }, 260));
}

async function callModel(system, input, maxTokens) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY nao configurada.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://duofinance.app', 'X-Title': 'DuoFinance' },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it', temperature: 0.25, max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }]
      })
    });
    if (!response.ok) throw openRouterError(response.status);
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('A analise nao retornou conteudo.');
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function oneSentence(value) {
  const clean = String(value).replace(/[*#`\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const match = clean.match(/^.*?[.!?](?:\s|$)/);
  return (match?.[0] || clean).trim().slice(0, 300);
}

function parseJson(value) {
  const clean = String(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(clean); } catch { return {}; }
}

function signed(item) {
  return item.tipo === 'Estorno' ? -Number(item.valor || 0) : Number(item.valor || 0);
}

function previousMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function round(value) { return Math.round(Number(value || 0) * 100) / 100; }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function openRouterError(status) {
  const messages = { 401: 'A chave do OpenRouter e invalida ou foi revogada.', 402: 'A conta do OpenRouter nao possui creditos suficientes.', 404: 'O modelo configurado nao esta disponivel no OpenRouter.', 429: 'O limite de requisicoes da IA foi atingido. Tente novamente em instantes.' };
  const error = new Error(messages[status] || 'O Mentor Duo esta indisponivel no momento.');
  error.statusCode = status === 429 ? 429 : 503;
  return error;
}

module.exports = { generateSyncInsight, generateMonthStartInsight, monthlyNodes, runMonthlyGraph };
