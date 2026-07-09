# Briefing — Área do Cliente CP (visão geral + encantamento estilo Disney)

Instrução para o Claude Code: leia este arquivo inteiro antes de escrever qualquer código. Ele define contexto técnico, o produto e os critérios de aceite.

---

## 1. Contexto técnico (não violar)

- Stack: HTML estático em `/public` na Vercel + funções serverless em `/api` + Supabase (Postgres + Storage).
- **Limite crítico: o plano da Vercel permite no máximo 12 funções serverless e já estamos em 12.** NÃO criar arquivos novos em `/api`. Toda lógica nova entra como `action` dentro de `api/db.js`, que já funciona assim.
- Todo acesso ao banco passa por `api/db.js` (proxy com SUPABASE_SERVICE_KEY). O frontend nunca fala com o Supabase diretamente, exceto upload via URL assinada.
- Twilio WhatsApp já está configurado e funcionando (ver `api/webhook-asaas.js` e helpers em `api/db.js`). Reaproveitar.
- Tabelas: `clientes`, `usuarios`, `projetos_cp`, `projetos_etapas`, `projetos_docs`, `projetos_logs`.
- Identidade visual do portal: fundo #001711, dourado #e4c099, verde-claro #a9cfbe, fontes Playfair Display (títulos) e Manrope (texto). Slogan: "A excelência está no nosso DNA."
- Já existe `portal.html` (portal de UM projeto, acesso por `?token=` do projeto). Ele continua existindo; a Área do Cliente é uma camada acima.

## 2. Estado atual do working tree (verificar antes de recriar)

Rode `git status` e `git diff` primeiro. Há trabalho parcial NÃO commitado que pode ser aproveitado, ajustado ou substituído (decida pelo melhor resultado, sem duplicar):

- `api/db.js`: ações já implementadas — `portal_cliente` (payload consolidado por cliente com verificação de 4 dígitos), `portal_cliente_link` (gera token único do cliente), `portal_upload` / `portal_upload_done` (upload via URL assinada no bucket `portal-docs`), `portal_doc_enviado` (corrige botão do portal que chamava ação inexistente), `arquivo_url`, `notificar_cliente`, e helpers `enviarWhatsApp`, `telefoneDoUsuario`, `linkArquivo`.
- `public/portal-cliente.html`: primeira versão da Área do Cliente (pode ser evoluída ou reescrita).
- `public/colaborativo.html`: edições parciais (campo WhatsApp e autocomplete iniciados, botão Área do Cliente). Completar ou refazer de forma consistente com o kanban atual.
- `migracao-portal.sql` e `migracao-area-cliente.sql`: migrações idempotentes (colunas `cliente_telefone`, `arquivo_path`, `arquivo_nome`, `telefone` em usuarios, `cliente_id` em projetos_cp, `portal_token` em clientes, bucket `portal-docs`). Manter o padrão: tudo idempotente, e o tipo de `cliente_id` detectado dinamicamente do tipo de `clientes.id`.

## 3. O produto

**Área do Cliente**: o cliente (sobretudo o mensalista, que tem vários assuntos rodando em paralelo) acessa UM link único (`portal-cliente.html?t=TOKEN_DO_CLIENTE`) e enxerga tudo que o escritório conduz para ele. Objetivos: transparência total, interação que alimenta a equipe, e percepção de valor contínuo do honorário mensal.

Fluxo de acesso: link único por cliente (token aleatório na coluna `clientes.portal_token`, gerado pela equipe no colaborativo). Primeira tela pede os 4 últimos dígitos do CPF/CNPJ cadastrado (verificação leve, guardada em sessionStorage). Cliente sem CPF/CNPJ entra direto.

Estrutura da página, nesta ordem:
1. Header com logo CP e nome do cliente.
2. Saudação personalizada (ver seção Disney).
3. Resumo numérico: assuntos em andamento, concluídos, pendências "aguardando você".
4. **"O que precisamos de você"**: seção consolidada com TODOS os documentos solicitados e etapas bloqueadas de TODOS os assuntos, cada item com botão que leva direto ao ponto de resolução. É a seção mais importante da página; se não houver pendências, exibir mensagem positiva ("Nenhuma pendência com você. Estamos cuidando de tudo.").
5. Cards dos assuntos em andamento: nome, badge de status, barra de progresso, etapa atual, responsável, link "ver detalhes" para o `portal.html` do projeto.
6. Assuntos concluídos (colapsados ou com opacidade menor).
7. Linha do tempo unificada: últimas atualizações públicas de todos os assuntos, com tag do assunto em cada item.
8. Footer institucional com OAB, contato e link de WhatsApp do escritório.

## 4. Encantamento — "O Jeito Disney" traduzido em features

Princípio Disney → implementação concreta:

**Guestology (conhecer o hóspede).** Saudação por primeiro nome e período do dia ("Boa tarde, Carlos."). Abaixo, uma linha de contexto desde a última visita: guardar timestamp da última visita em localStorage e calcular contra os logs ("Desde sua última visita, avançamos em 2 etapas e concluímos 1 assunto."). Se primeira visita, mensagem de boas-vindas assinada pela responsável.

**Tudo comunica (atenção obsessiva ao detalhe / "bumping the lamp").** Zero juridiquês em qualquer texto: status traduzidos para linguagem de empresário ("Aguardando você" em vez de "bloqueado"). Loading com frases da marca em rotação ("Preparando sua visão geral...", "A excelência está no nosso DNA."). Estados vazios desenhados, nunca "sem dados". Favicon e título da aba personalizados ("Área do Cliente — Cavalcante Pinheiro"). Transições e animações sutis (fade-in em cascata nos cards, barra de progresso animando ao carregar). Datas humanizadas ("hoje", "ontem", "há 3 dias").

**Momentos mágicos (exceder a expectativa).** Quando um assunto chega a 100%, celebração elegante na tela (animação discreta, dourado sobre verde-escuro, nada infantil) com mensagem pessoal: "Concluímos mais uma etapa da sua jornada. Obrigada pela confiança. — Mariana Pinheiro". Contador de dedicação no resumo: "Nossa equipe registrou N atualizações nos seus assuntos nos últimos 30 dias" (contar logs do período). Aniversário de relacionamento: se `clientes.criado_em` faz aniversário no mês, exibir uma linha comemorativa.

**Antecipação (serviço proativo).** Em cada card, além da etapa atual, mostrar "Próximo passo" (primeira etapa pendente): o cliente nunca precisa perguntar "e agora?". Quando houver `data_conclusao` prevista em etapas futuras, exibir "previsto para [data]".

**Recuperação de serviço (quando algo trava).** Se uma etapa está bloqueada aguardando o cliente há mais de 7 dias, o tom NUNCA é de cobrança: "Sabemos que a rotina é corrida. Se precisar de ajuda com este item, fale direto com a responsável" + botão wa.me para o WhatsApp da responsável (coluna `usuarios.telefone`). 

**Elenco visível (cast members).** Cada assunto mostra quem cuida dele: inicial ou avatar com cor da responsável (colunas `ini` e `cor` já existem em `usuarios`) e o nome ("Diana está cuidando deste assunto"). Humaniza e cria vínculo.

**Feedback do hóspede.** Quando um assunto é concluído, o card ganha uma avaliação de 1 a 5 estrelas + comentário opcional, enviada uma única vez. Criar tabela `projetos_avaliacoes` (id, projeto_id, nota, comentario, criado_em) na migração e incluir na whitelist de `api/db.js`. Após avaliar, agradecer com calor ("Sua opinião constrói o nosso padrão de excelência."). A nota aparece para a equipe no colaborativo.

**Interação bidirecional (o cliente participa).** Upload de documento direto na pendência (usar ações `portal_upload`/`portal_upload_done` já prontas; bucket privado `portal-docs`; limite 25 MB; feedback de progresso). Mensagens por assunto (já existe via `portal_log`). Toda interação do cliente dispara WhatsApp para a responsável (já implementado no backend, manter).

**Notificações que encantam (já implementadas no backend, apontar para o novo link).** Etapa concluída, documento solicitado e mensagem nova disparam WhatsApp ao cliente via ação `notificar_cliente`, preferindo o link da Área do Cliente quando o vínculo `cliente_id` existir. Garantir que o colaborativo chama essa ação nos três gatilhos (mover card para Concluído, criar solicitação de documento, comentário público).

## 5. Mudanças necessárias no colaborativo (lado equipe)

1. Campo Cliente do modal de projeto vira autocomplete da tabela `clientes` (datalist), salvando `cliente_id` + preenchendo telefone/e-mail automaticamente do cadastro. Texto livre continua permitido (cliente_id null).
2. Campo "WhatsApp do cliente" no modal (coluna `cliente_telefone`).
3. Botão "Área do Cliente" no board: chama `portal_cliente_link` e copia o link único.
4. No drawer do card, documentos com arquivo enviado mostram "Ver arquivo" (ação `arquivo_url`).
5. Nota de avaliação do cliente visível no card do projeto concluído.

## 6. Regras de qualidade

- Nunca expor SUPABASE_SERVICE_KEY ou qualquer chave no frontend.
- Escapar TODO conteúdo dinâmico contra XSS (função `esc()` já existe nos arquivos).
- Mobile first: a maioria dos clientes abrirá pelo celular a partir do WhatsApp.
- Página única, sem frameworks, seguindo o padrão dos arquivos existentes.
- Migrações SQL sempre idempotentes, em arquivo separado na raiz, com instruções de execução no cabeçalho.
- Não quebrar os links `portal.html?token=` já enviados a clientes.
- Ao final: `node --check api/db.js` e teste manual do fluxo completo antes de commitar.

## 7. Critérios de aceite

1. Um link único abre a visão de todos os assuntos do cliente após verificação de 4 dígitos.
2. Pendências de todos os assuntos aparecem consolidadas com ação direta (upload funciona de ponta a ponta).
3. Saudação personalizada + resumo desde a última visita funcionando.
4. Celebração de conclusão + avaliação por estrelas gravando no banco.
5. Etapa bloqueada há 7+ dias exibe tom empático com WhatsApp da responsável.
6. Equipe recebe WhatsApp em toda interação do cliente; cliente recebe WhatsApp nos três gatilhos, com link da Área do Cliente.
7. Zero funções serverless novas; `node --check api/db.js` passa; nada de juridiquês nos textos do cliente.
