-- Rode este SQL no Supabase: menu lateral "SQL Editor" -> "New query" -> colar -> Run

create table if not exists scrc_kv (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- Habilita Row Level Security (obrigatório no Supabase) mas libera
-- leitura e escrita pra qualquer pessoa com o link do site — o mesmo
-- comportamento "sem login" que a versão dentro do Claude já tinha.
alter table scrc_kv enable row level security;

create policy "Leitura pública" on scrc_kv
  for select using (true);

create policy "Escrita pública" on scrc_kv
  for insert with check (true);

create policy "Atualização pública" on scrc_kv
  for update using (true);
