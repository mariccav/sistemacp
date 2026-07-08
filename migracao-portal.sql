-- ═══════════════════════════════════════════════════════════════════
-- MIGRAÇÃO: Portal do Cliente — upload de documentos + notificações
-- Executar no Supabase: painel → SQL Editor → colar tudo → Run
-- Pode rodar mais de uma vez sem problema (idempotente).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Telefone do cliente no projeto (para avisos automáticos no WhatsApp)
alter table projetos_cp
  add column if not exists cliente_telefone text;

-- 2. Arquivo enviado pelo cliente em cada solicitação de documento
alter table projetos_docs
  add column if not exists arquivo_path text,
  add column if not exists arquivo_nome text;

-- 3. Telefone das colaboradoras (para receberem os avisos do portal)
alter table usuarios
  add column if not exists telefone text;

-- 4. Bucket privado para os documentos do portal
insert into storage.buckets (id, name, public)
values ('portal-docs', 'portal-docs', false)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- DEPOIS DE RODAR: cadastre os telefones da equipe (com DDD), ex.:
--
-- update usuarios set telefone = '71991292322' where nome = 'Mariana Pinheiro';
-- update usuarios set telefone = '719XXXXXXXX' where nome = 'Diana';
-- update usuarios set telefone = '719XXXXXXXX' where nome = 'Jade';
-- update usuarios set telefone = '719XXXXXXXX' where nome = 'Mariana Barboza';
-- update usuarios set telefone = '719XXXXXXXX' where nome = 'Laila Costa';
--
-- Quem não tiver telefone cadastrado não recebe aviso; como reserva,
-- é possível definir a variável WHATSAPP_EQUIPE no Vercel.
-- ═══════════════════════════════════════════════════════════════════
