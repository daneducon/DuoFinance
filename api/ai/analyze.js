'use strict';

const { verifyRequest } = require('../../lib/auth');
const { send, methodNotAllowed, errorResponse } = require('../../lib/http');
const { summarize, calculateCashFlow, buildAnalysis } = require('../../lib/finance');
const sheets = require('../../lib/sheets');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyRequest(req);
    const month = String(req.body?.mes || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const error = new Error('Mes de referencia invalido.');
      error.statusCode = 400;
      throw error;
    }
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY nao configurada.');

    const [allTransactions, configuration] = await Promise.all([
      sheets.listAllTransactions(),
      sheets.getConfiguration()
    ]);
    const transactions = allTransactions.filter((item) => item.mesRef === month);
    const financialSummary = summarize(transactions, configuration.caixinhas, allTransactions);
    const cashFlow = calculateCashFlow(allTransactions, month);
    const analysis = buildAnalysis(allTransactions, month);
    const compactSummary = {
      mes: month,
      receitas: financialSummary.receitas,
      despesas: financialSummary.despesas,
      saldoPrevisto: financialSummary.saldoPrevisto,
      aReceber: financialSummary.aReceber,
      aPagar: financialSummary.aPagar,
      gastosPorCategoria: financialSummary.categorias,
      caixinhas: financialSummary.caixinhas.map(({ nome, saldo, meta, progresso }) => ({ nome, saldo, meta, progresso })),
      evolucaoTrimestral: analysis.months.map(({ month: mes, total }) => ({ mes, despesas: total })),
      fluxoDeCaixa: {
        saldoInicial: cashFlow.openingBalance,
        saldoFinal: cashFlow.closingBalance,
        menorSaldo: cashFlow.minimumBalance,
        periodosNegativos: cashFlow.negativePeriods
      }
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.origin || 'https://duofinance.app',
        'X-Title': 'DuoFinance'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it',
        temperature: 0.45,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content: 'Voce e um mentor financeiro sincero, encorajador e pratico para um casal brasileiro. Responda em portugues do Brasil, em ate 3 paragrafos curtos. Comece com um reforco positivo verdadeiro, explique o principal padrao sem julgamento e termine com uma unica acao pequena e concreta. Nao invente dados nem use markdown complexo.'
          },
          { role: 'user', content: JSON.stringify(compactSummary) }
        ]
      })
    });
    if (!response.ok) throw openRouterError(response.status);
    const result = await response.json();
    const insight = result.choices?.[0]?.message?.content;
    if (!insight) throw new Error('A analise nao retornou conteudo.');
    send(res, 200, { insight });
  } catch (error) {
    errorResponse(res, error);
  }
};

function openRouterError(status) {
  const messages = {
    401: 'A chave do OpenRouter e invalida ou foi revogada.',
    402: 'A conta do OpenRouter nao possui creditos suficientes.',
    404: 'O modelo configurado nao esta disponivel no OpenRouter.',
    429: 'O limite de requisicoes da IA foi atingido. Tente novamente em instantes.'
  };
  const error = new Error(messages[status] || 'O mentor financeiro esta indisponivel no momento.');
  error.statusCode = status === 429 ? 429 : 503;
  return error;
}
