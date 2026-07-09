-- ═══════════════════════════════════════════════════════════════════
-- MIGRAÇÃO: Área do Cliente — visão consolidada de todos os assuntos
-- Executar no Supabase: painel → SQL Editor → colar tudo → Run
-- Idempotente: pode rodar mais de uma vez sem problema.
-- Pré-requisito: já ter rodado a migracao-portal.sql
-- ═══════════════════════════════════════════════════════════════════

-- 1. Vincular projeto ao cadastro real de clientes
--    (detecta automaticamente o tipo do id da tabela clientes)
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'id';

  IF t = 'uuid' THEN
    EXECUTE 'alter table projetos_cp add column if not exists cliente_id uuid';
  ELSIF t IN ('bigint', 'integer', 'smallint') THEN
    EXECUTE 'alter table projetos_cp add column if not exists cliente_id bigint';
  ELSE
    EXECUTE 'alter table projetos_cp add column if not exists cliente_id text';
  END IF;
END $$;

-- 2. Token único da Área do Cliente (um link por cliente, todos os assuntos)
alter table clientes
  add column if not exists portal_token text;

-- Índice para busca rápida pelo token
create index if not exists idx_clientes_portal_token on clientes (portal_token);

-- ═══════════════════════════════════════════════════════════════════
-- DEPOIS DE RODAR:
-- 1. Nos projetos já existentes, abra "Editar projeto" no colaborativo
--    e selecione o cliente na lista (isso preenche o vínculo).
-- 2. O link da Área do Cliente é gerado no colaborativo, pelo botão
--    "Área do Cliente" no detalhe do projeto.
-- 3. A verificação de acesso usa os 4 últimos dígitos do CPF/CNPJ
--    cadastrado no cliente. Clientes sem CPF/CNPJ entram direto.
-- ═══════════════════════════════════════════════════════════════════

-- 3. Avaliação do cliente por projeto concluído
create table if not exists projetos_avaliacoes (
  id          uuid default gen_random_uuid() primary key,
  projeto_id  uuid references projetos_cp(id) on delete cascade,
  nota        smallint check (nota between 1 and 5),
  comentario  text,
  criado_em   timestamptz default now()
);

create unique index if not exists idx_projetos_avaliacoes_projeto
  on projetos_avaliacoes (projeto_id);
