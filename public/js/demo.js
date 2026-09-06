function date(day) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function demoData() {
  const month = date(1).slice(0, 7);
  const transactions = [
    ['1', 'Receita', 'Salário', 6800, 5, 'Renda', 'Ele', 'Conta Corrente', 'Pago'],
    ['2', 'Receita', 'Freelance de design', 1850, 12, 'Renda extra', 'Ela', 'Conta Corrente', 'Pago'],
    ['3', 'Despesa', 'Aluguel', 2100, 7, 'Moradia', 'Nós', 'Conta Corrente', 'Pago'],
    ['4', 'Despesa', 'Mercado da semana', 638.4, 15, 'Alimentação', 'Nós', 'Cartão de Crédito', 'Pago'],
    ['5', 'Despesa', 'Jantar de sexta', 186.9, 19, 'Lazer', 'Nós', 'Cartão de Crédito', 'Pago'],
    ['6', 'Despesa', 'Conta de energia', 224.3, 22, 'Moradia', 'Ele', 'Conta Corrente', 'Pendente'],
    ['7', 'Depósito Caixinha', 'Plano de viagem', 700, 10, 'Metas', 'Nós', 'Viagem', 'Pago'],
    ['8', 'Depósito Caixinha', 'Reserva do casal', 500, 10, 'Metas', 'Nós', 'Reserva', 'Pago'],
    ['9', 'Despesa', 'Farmácia', 118.7, 23, 'Saúde', 'Ela', 'Cartão de Crédito', 'Pendente']
  ].map(([id, tipo, descricao, valor, day, categoria, responsavel, origem, status]) => ({
    id, tipo, descricao, valor, data: date(day), dataPg: status === 'Pago' ? date(day) : '', mesRef: month,
    status, categoria, responsavel, parcelaAtual: 1, totalParcelas: 1, idParcelamento: '', recorrente: false, origem
  }));
  return {
    transactions,
    configuration: {
      categorias: ['Alimentação', 'Lazer', 'Metas', 'Moradia', 'Renda', 'Renda extra', 'Saúde', 'Transporte'],
      responsaveis: ['Ele', 'Ela', 'Nós'],
      caixinhas: [
        { nome: 'Viagem', meta: 8000, favorito: true },
        { nome: 'Reserva', meta: 12000, favorito: true },
        { nome: 'Aliança', meta: 3500, favorito: true }
      ]
    }
  };
}
