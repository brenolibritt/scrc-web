# SCRC — Controle de Recebimento de Cargas

App web para lançar cargas, ver histórico, painel resumo e cadastros
(fornecedores, motoristas, veículos, produtos, tanques). Os dados ficam
guardados num banco de dados compartilhado (Supabase), então todo mundo
que acessa o link vê a mesma informação.

Este guia assume que você **nunca programou antes**. São 3 contas grátis,
todas feitas pelo navegador, sem instalar nada no computador.

---

## Passo 1 — Criar o banco de dados (Supabase)

1. Acesse **supabase.com** e crie uma conta grátis.
2. Clique em **"New project"**. Dê um nome (ex: `scrc`), crie uma senha
   (guarde num lugar seguro) e escolha a região mais perto de você.
   Espere uns 2 minutos até o projeto ficar pronto.
3. No menu à esquerda, clique em **"SQL Editor"** → **"New query"**.
4. Abra o arquivo `supabase-schema.sql` (está junto com este projeto),
   copie todo o conteúdo, cole no editor e clique em **"Run"**.
5. Ainda no menu à esquerda, vá em **"Project Settings"** (ícone de
   engrenagem) → **"API"**. Você vai precisar de dois valores desta
   página no Passo 3:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`)
   - **anon public key** (uma chave longa)

## Passo 2 — Subir o código pro GitHub

1. Acesse **github.com** e crie uma conta grátis (se ainda não tiver).
2. Clique em **"New repository"**. Dê um nome (ex: `scrc-web`), deixe
   como **Private** ou **Public** (tanto faz) e clique em **"Create
   repository"**.
3. Na página do repositório vazio, clique em **"uploading an existing
   file"**.
4. Arraste **todos os arquivos e pastas deste projeto** (menos a pasta
   `node_modules`, se ela existir na sua cópia) pra essa página e
   confirme o upload ("Commit changes").

## Passo 3 — Publicar o site (Vercel)

1. Acesse **vercel.com** e crie uma conta grátis — escolha **"Continue
   with GitHub"** pra já conectar as duas contas.
2. Clique em **"Add New" → "Project"**.
3. Escolha o repositório `scrc-web` que você criou no Passo 2 e clique
   em **"Import"**.
4. Antes de clicar em "Deploy", abra a seção **"Environment Variables"**
   e adicione as duas chaves que você pegou no Passo 1:

   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | a Project URL do Supabase |
   | `VITE_SUPABASE_ANON_KEY` | a anon public key do Supabase |

5. Clique em **"Deploy"**. Em cerca de 1 minuto o site fica no ar, com
   um link tipo `https://scrc-web.vercel.app` — esse é o link
   definitivo pra compartilhar com a equipe.

Pronto. Qualquer atualização futura no código (se você me pedir pra
mudar algo e eu te mandar os arquivos de novo) é só repetir o Passo 2
(subir os arquivos novos no GitHub) — o Vercel publica a atualização
sozinho, automaticamente.

---

## Login de admin

A senha padrão de administrador é `admin123` (veja/altere em
`src/App.jsx`, constante `ADMIN_PASSWORD`, próximo ao topo do arquivo).

**Importante:** essa é uma trava de conveniência, não uma segurança de
verdade — qualquer pessoa que abrir o código-fonte da página consegue
ver essa senha. Ela evita edições acidentais por visitantes, mas não
impede alguém com conhecimento técnico e má intenção. Se um dia
precisarem de contas de usuário reais com permissões seguras, isso
exige uma estrutura diferente (autenticação de verdade) — me avisem
se chegarem nesse ponto que a gente conversa sobre como fazer.

## Rodando localmente (opcional, só se alguém tiver Node.js instalado)

```
npm install
cp .env.example .env   # depois preencha com os valores do Supabase
npm run dev
```
