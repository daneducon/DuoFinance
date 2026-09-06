# 🧠 DuoFinance - Software Design Document (SDD) v2.1

## 1. Visão Geral e Propósito do Sistema
**DuoFinance** é um Progressive Web App (PWA) de gestão financeira focado em casais. 
Mais do que um simples rastreador de despesas, o app atua como um **mentor financeiro baseado em IA**, utilizando conceitos de *Learning Experience Design (LXD)* e Neurociência para reduzir a carga cognitiva, combater a habituação e promover feedbacks dopaminérgicos positivos na gestão do dinheiro.

---

## 2. Instruções Críticas para Agentes de IA (AI Coding Guidelines)
**IMPORTANTE:** Qualquer agente de IA atuando nesta base de código DEVE respeitar as seguintes regras arquiteturais para evitar o "efeito macarronada" (acoplamento excessivo) e proteger as chaves de API:

1. **Separação de Responsabilidades (Single Responsibility):**
   - Front-end (HTML/JS/CSS) cuida APENAS de UI, estado visual e PWA.
   - Vercel Serverless Functions (`/api/*`) cuidam APENAS de regras de negócio, persistência (Google Sheets API) e integrações (OpenRouter).
2. **Segurança em Primeiro Lugar:**
   - **NUNCA** exponha chaves de API (`GOOGLE_PRIVATE_KEY`, `OPENROUTER_API_KEY`) no front-end. Toda chamada externa deve passar por uma rota `/api/` na Vercel.
   - Toda rota `/api/` privada DEVE exigir e validar o JWT (Google Sign-In) enviado via `Authorization: Bearer <token>`.
3. **Gerenciamento de Carga Cognitiva:**
   - Funções grandes devem ser quebradas (chunking). Mantenha o limite de memória de trabalho baixo. 
   - Arquivos devem ser modulares (`auth.js`, `api.js`, `ui.js`, `sw.js`).

---

## 3. Arquitetura do Sistema (Jamstack)

### 3.1. Front-end (Camada de Apresentação)
- **Hospedagem:** Vercel (Edge Network).
- **Stack:** Vanilla JavaScript modular (ES6 Modules), HTML5, Tailwind CSS (via CDN ou build leve).
- **UX/UI:** Foco em Dark Mode elegante (Tailwind `slate-950` e `emerald-500`).
- **PWA Capabilities:** 
  - `manifest.json` configurado para instalação.
  - `Service Worker` interceptando requisições (Estratégia *Cache-First* para assets, *Network-First* para dados).
  - Uso de `IndexedDB` para guardar ações offline temporárias (Background Sync).

### 3.2. Back-end (Camada de Lógica)
- **Infraestrutura:** Vercel Serverless Functions (Node.js).
- **Endpoints Principais:**
  - `POST /api/auth` (Validação de login JWT).
  - `GET /api/financas` (Busca dados do mês).
  - `POST /api/financas` (Adiciona/Edita/Exclui transações).
  - `POST /api/ai/analyze` (Processa insights via OpenRouter).

### 3.3. Banco de Dados (Persistência)
- **Provedor:** Google Sheets via **Google Sheets API v4** (REST).
- **Autenticação Server-to-Server:** Google Service Account (JWT via credenciais injetadas nas Vercel Env Vars).

### 3.4. Motor de IA (Análise e Feedback)
- **Provedor:** OpenRouter (Modelos sugeridos: Claude 3.5 Sonnet, GPT-4o-mini).
- **Integração:** Serverless function monta o *prompt* com um JSON resumido dos gastos do mês e solicita a análise.

---

## 4. Estrutura de Dados Oficial (Modelo do Google Sheets)

O banco de dados espelha EXATAMENTE as seguintes abas e colunas:

### 4.1. Aba: `Lancamentos`
| Coluna | Campo | Tipo | Descrição |
|---|---|---|---|
| A | ID | UUID (String) | Identificador único da transação. |
| B | Tipo | Enum | 'Receita', 'Despesa', 'Depósito Caixinha', 'Resgate'. |
| C | Descricao | String | Nome descritivo (ex: Mercado, Salário). |
| D | Valor | Float | Valor absoluto em R$. |
| E | Data | Date (YYYY-MM-DD) | Data de competência da transação. |
| F | Data_pg | Date (YYYY-MM-DD) | Data de liquidação no fluxo de caixa (pode ser vazia se Pendente). |
| G | Mes_Ref | String (YYYY-MM)| Mês/Ano de agrupamento do dashboard. |
| H | Status | Enum | 'Pago', 'Pendente'. |
| I | Categoria | String | Agrupamento de gastos (ex: Moradia, Alimentação). |
| J | Responsavel| Enum | 'Ele', 'Ela', 'Nós'. (Mapeia internamente para Danilo, Talyta, Casal). |
| K | Parcela_Atual | Int | Número da parcela corrente (ex: 1). |
| L | Total_Parcelas | Int | Quantidade total de parcelas (ex: 12). |
| M | Id_Parcelamento| String | ID comum para agrupar as parcelas de uma mesma compra. |
| N | Recorrente | Boolean | 'VERDADEIRO' ou 'FALSO'. |
| O | Origem | String | 'Conta Corrente', 'Cartão de Crédito' ou NOME_DA_CAIXINHA. |

### 4.2. Aba: `Configuracoes`
| Coluna | Campo | Descrição |
|---|---|---|
| A | Categorias | Lista de categorias ativas (ex: Cartão de Crédito, Moradia). |
| B | Responsaveis | 'Ele', 'Ela', 'Nós'. |
| C | Nome_Caixa | Identificador da Caixinha (ex: Casal, Aliança, Viagem). |
| D | Meta | Valor alvo em R$ (ex: 12000, 2000). |
| E | Favorito | 'TRUE' ou 'FALSE' para exibição na Home. |

---

## 5. Fluxos Críticos e Lógicas de Negócio

### 5.1. Fluxo de Autenticação Segura (GIS)
1. **Front-end:** Renderiza o botão Google Sign-In (GIS).
2. **Usuário:** Loga com conta Google.
3. **GIS:** Devolve um JWT.
4. **Front-end:** Verifica se o e-mail está na `ALLOWLIST`. Se sim, salva JWT no `localStorage`.
5. **Comunicação:** Todas as requisições para a Vercel incluem `Authorization: Bearer <JWT>`.
6. **Back-end:** Vercel Function usa `google-auth-library` para verificar a assinatura e expiração do JWT antes de responder com dados financeiros.

### 5.2. Lógica Financeira e "Caixinhas"
- **Saldo Previsto CC:** `(Soma Receitas Pagas) - (Soma Despesas Pagas CC) + (Receitas Pendentes) - (Despesas Pendentes CC)`.
- **Motor de Caixinha:** Se uma despesa é lançada com `Origem = "Nome_da_Caixinha"`, o valor NÃO é abatido do Saldo Previsto da Conta Corrente, mas sim do saldo interno calculado da respectiva caixinha.

### 5.3. Integração com IA (Feedback Dopaminérgico e LXD)
- O Córtex Pré-frontal do usuário não processa bem planilhas brutas. A IA atua como tradutor.
- **O Trigger:** Ao final do mês ou via botão "Gerar Insights", o front chama `/api/ai/analyze`.
- **O Payload (Chunking):** O back-end calcula totais por categoria e progresso de metas, montando um JSON reduzido para poupar tokens.
- **Prompting:** A IA assume a persona de um mentor sincero e encorajador.
- **Output:** 
  - *Reforço Positivo:* Comemora metas batidas e sobras de caixa (Dopamina).
  - *Análise:* Explica os gráficos em texto natural.
  - *Nudges:* Sugere pequenas ações concretas (ex: "Sobrou R$ 100,00 na categoria Lazer, que tal investir na caixinha 'Viagem' agora?").

---

## 6. Proposta de Estrutura de Diretórios (Para a Vercel)

```text
duo-finance/
├── public/                 # Assets estáticos
│   ├── index.html          # Ponto de entrada SPA
│   ├── login.html          # Tela de autenticação separada
│   ├── manifest.json       # Configuração do PWA
│   ├── sw.js               # Service Worker
│   ├── css/
│   │   └── style.css       # Tailwind/Estilos customizados
│   └── js/
│       ├── app.js          # Lógica principal de UI
│       ├── api.js          # Funções de fetch (com injeção de JWT)
│       └── auth.js         # Lógica de login GIS
├── api/                    # Vercel Serverless Functions
│   ├── auth.js             # Validação de Token Google
│   ├── financas.js         # Integração Google Sheets (GET/POST)
│   └── analyze.js          # Chamada OpenRouter (IA)
├── package.json
└── vercel.json             # Regras de roteamento e headers
```


---

## 7. Diretrizes de Design de Interface (UX/UI & LXD)
Qualquer desenvolvimento ou prototipagem de telas para o DuoFinance deve obrigatoriamente seguir as diretrizes baseadas em *Learning Experience Design (LXD)* e boas práticas de usabilidade:

### 7.1. Organização Visual e "Respiro"
- **Macro Espaço:** Prever áreas de respiro generosas (margens e espaçamentos amplos entre seções) para evitar a sobrecarga visual do usuário [cite: 3].
- **Micro Espaço:** Garantir espaçamentos adequados entre letras, linhas de texto e elementos visuais [cite: 3].
- **Minimalismo:** Eliminar elementos desnecessários (ruído visual) que impeçam a leitura fluida [cite: 3].
- **Grids Harmônicos:** Distribuir os elementos utilizando grids equilibrados para que o layout nunca pareça sufocado ou confuso [cite: 3].
- **Imagens e Alinhamento:** Utilizar imagens abertas (com fundo removido) quando aplicável para focar nos textos/CTAs [cite: 3]. Manter rigoroso alinhamento visual para guiar o olhar do usuário [cite: 3].

### 7.2. Clareza e Tipografia
- **Legibilidade:** Priorizar fontes altamente legíveis e contraste adequado entre texto e fundo [cite: 3].
- **Texto Direto:** Frases curtas e objetivas. Os rótulos (labels) dos botões devem explicar a ação por si mesmos, sem depender de ícones para se fazerem compreendidos [cite: 3, 4].

### 7.3. Regras para o Uso de Ícones em Botões
- **Posicionamento por Função:**
  - *Esquerda:* Quando o ícone serve como pista de reconhecimento imediato antes da leitura (ex: *Editar*, *Baixar*, *Criar*) [cite: 4].
  - *Direita:* Quando o ícone indica direção, continuidade ou mudança de tela (ex: *Próximo*, *Enviar*, *Abrir no app*) [cite: 4].
  - *Exceção de Direção:* Botões de retorno (*Voltar*, *Anterior*) mantêm a seta à esquerda [cite: 4].
- **Simplicidade:** Ações amplamente conhecidas ou simples (ex: campos de formulário, botões de login padrão como *Entrar* ou *Cadastrar*) **não** devem levar ícones, evitando poluição visual [cite: 4]. (O botão *Continuar com Google* é exceção por conter a logomarca oficial) [cite: 4].
- **Zero Ícones Duplos:** Proibido o uso de múltiplos ícones em um único botão [cite: 4].
- **Agrupamento:** Ícone e texto devem formar um único bloco visual coeso e centralizado, sem elementos soltos [cite: 4].
- **Apenas Ícones:** Botões restritos a ícones (espaço reduzido) exigem ícones universais e suporte obrigatório com *tooltip* no foco/*hover* [cite: 4].
