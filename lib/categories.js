'use strict';

// Grupos da tela de análise. A ordem importa: a primeira regra que bater vence.
// As mesmas regras estão em public/js/categories.mjs; o teste test/categories.test.js garante que batem.
const GROUPS = [
  ['Moradia e contas', ['housing', 'moradia', 'aluguel', 'condominio', 'iptu', 'energia', 'electricity', 'agua', 'internet', 'telecommunications', 'telefone', 'houseware']],
  ['Alimentação', ['groceries', 'mercado', 'supermercado', 'eating out', 'food and drinks', 'food delivery', 'restaurante', 'almoco', 'comida', 'delivery', 'alimentacao', 'padaria', 'lanche']],
  ['Transporte', ['gas station', 'parking', 'estacionamento', 'taxi', 'ride-hailing', 'tolls', 'pedagio', 'vehicle', 'transporte', 'transportation', 'combustivel', 'uber', 'onibus', 'metro']],
  ['Saúde e bem-estar', ['healthcare', 'pharmacy', 'farmacia', 'gyms', 'academia', 'saude', 'bem-estar', 'pessoal']],
  ['Assinaturas e serviços digitais', ['digital services', 'assinatura', 'streaming', 'software']],
  ['Educação', ['school', 'escola', 'educacao', 'graduacao', 'curso', 'faculdade', 'livros']],
  ['Lazer e viagens', ['cinema', 'theater', 'concert', 'tickets', 'role', 'lazer', 'viagem', 'travel', 'entretenimento', 'accomodation', 'accommodation', 'hospedagem', 'hotel']],
  ['Compras', ['shopping', 'clothing', 'roupa', 'electronics', 'eletron', 'office supplies', 'compras']],
  ['Dívidas, taxas e impostos', ['divida', 'emprest', 'bank fees', 'tax on', 'taxa', 'imposto', 'insurance', 'seguro', 'trabalho', 'juros']],
  ['Transferências', ['transfer', 'transferencia', 'pix']],
  ['Cartão de crédito', ['cartao', 'fatura']],
  ['Casal e eventos', ['casal', 'alianca']]
];

const MACRO_CATEGORIES = [...GROUPS.map(([name]) => name), 'Outros'];

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function macroCategory(value) {
  const label = normalizeLabel(value);
  const match = GROUPS.find(([, terms]) => terms.some((term) => label.includes(term)));
  return match ? match[0] : 'Outros';
}

module.exports = { MACRO_CATEGORIES, macroCategory };
