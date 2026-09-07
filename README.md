# DuoFinance

PWA de gestão financeira para casais, com dashboard mensal, caixinhas, operação offline e insights por IA. O projeto segue o SDD v2.1 em `sdd_regras.md`.

## Executar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000/login`. O botão **Explorar demonstração** funciona sem credenciais e mantém os dados apenas no navegador.

## Configuração real

1. Copie as variáveis de `.env.example` para `.env.local` e preencha os valores.
2. No Google Cloud, crie um OAuth Client ID do tipo Web e autorize os domínios local e de produção.
3. Crie uma Service Account, habilite a Google Sheets API e compartilhe a planilha com o e-mail dessa conta como Editor.
4. Crie as abas `Lancamentos` e `Configuracoes` usando exatamente os cabeçalhos descritos em `sdd_regras.md`.
5. Em `ALLOWED_EMAILS`, informe os e-mails Google autorizados separados por vírgula.
6. Crie uma chave no OpenRouter e configure `OPENROUTER_API_KEY`. O padrão de `OPENROUTER_MODEL` é `google/gemma-4-31b-it`.
7. Na Pluggy, configure `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` e aponte um webhook `all` para `https://seu-dominio.vercel.app/api/pluggy/webhook`.

Na primeira execução, o app cria automaticamente as abas `PluggyItens`, `PluggyContas`, `PluggyTransacoes` e `PluggyEventos` na planilha. Para proteger um webhook criado pelo Dashboard, configure `PLUGGY_WEBHOOK_SECRET` e use a URL `https://seu-dominio.vercel.app/api/pluggy/webhook?secret=SEU_SEGREDO`. Se ele for criado via API, envie o mesmo valor no header `X-Pluggy-Secret`. Sem a variável, o endpoint fica sem autenticação e deve ser usado apenas temporariamente durante a configuração.

Na Vercel, cadastre as mesmas variáveis em **Project Settings > Environment Variables**. Nunca coloque chaves privadas dentro de `public/`.

## Comandos

- `npm run dev`: servidor local da Vercel.
- `npm test`: testes das regras financeiras.
- `npm run check`: verificação de sintaxe das funções serverless.

## Estrutura

- `public/`: SPA, login, estilos, módulos ES6, manifest e Service Worker.
- `api/`: funções serverless protegidas por Google JWT.
- `lib/`: autenticação, Google Sheets, HTTP e regras financeiras.
- `test/`: testes unitários com o runner nativo do Node.js.
