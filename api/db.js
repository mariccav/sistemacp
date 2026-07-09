// api/db.js — Proxy seguro para o Supabase
// O frontend chama este endpoint em vez de acessar o Supabase diretamente.
// Usa a SUPABASE_SERVICE_KEY (secreta, no servidor) para bypassar o RLS.
// Verifica a sessão do usuário antes de qualquer operação.

const SB_URL = 'https://svwwmxapmppjkmbazhul.supabase.co';

// ── Helpers: E-mail (Gmail Apps Script) e arquivos (Supabase Storage) ──
const BUCKET_PORTAL = 'portal-docs';

// Webhook do Gmail Apps Script (mesmo que usa para alertas de tarefas)
const WEBHOOK_EMAIL_PORTAL = 'https://script.google.com/macros/s/AKfycbzf8-XI0ojhmNDWAMbOgWepyJdwltcXCdzAisfHqInu-6pop32NdmBRz906O5HMFN7W/exec';

// E-mails fixos da equipe
const EMAILS_EQUIPE = {
  'Mariana Pinheiro': 'mariana@cavalcantepinheiroadv.com.br',
  'Diana':            'diana@cavalcantepinheiroadv.com.br',
  'Jade':             'juridico@cavalcantepinheiroadv.com.br',
  'Mariana Barboza':  'comercial@cavalcantepinheiroadv.com.br',
  'Laila Costa':      'lailabomfim01@gmail.com'
};

async function enviarEmail(para, assunto, corpo) {
  if (!para) return false;
  try {
    await fetch(WEBHOOK_EMAIL_PORTAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: para, subject: assunto, body: corpo })
    });
    console.log('[Email] enviado para:', para, '| assunto:', assunto);
    return true;
  } catch(e) {
    console.error('[Email] ERRO:', e.message);
    return false;
  }
}

// Mantém compatibilidade: chama enviarEmail em vez de WhatsApp
async function enviarWhatsApp(ignorado, mensagem, emailPara) {
  return enviarEmail(emailPara, '🔔 Portal CP — Notificação', mensagem);
}

// E-mail da colaboradora responsável
async function telefoneDoUsuario(SERVICE_KEY, nome) {
  // Retorna o e-mail da colaboradora para notificações
  return EMAILS_EQUIPE[nome] || null;
}

// Link temporário (assinado) para arquivo no bucket privado
async function linkArquivo(SERVICE_KEY, path, expiresIn = 3600) {
  if (!path) return null;
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET_PORTAL}/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.signedURL ? `${SB_URL}/storage/v1${d.signedURL}` : null;
  } catch { return null; }
}

// Tabelas permitidas — whitelist explícita de segurança
const TABELAS_PERMITIDAS = new Set([
  'usuarios', 'clientes', 'leads', 'leads_contatos', 'leads_interacoes',
  'contratos', 'despesas', 'repasses', 'lancamentos_manuais', 'agenda',
  'tarefas_astrea', 'publicacoes', 'sessoes',
  'transacoes', 'transacoes_historico', 'transacoes_prazos',
  'mural', 'elogios', 'redes_posts',
  'processos', 'processos_historico',
  'projetos_cp', 'projetos_etapas', 'projetos_docs', 'projetos_logs',
  'projetos_avaliacoes', 'projetos_checklist'
]);

// Operações permitidas
const OPS_LEITURA  = new Set(['GET']);
const OPS_ESCRITA  = new Set(['POST', 'PATCH', 'DELETE']);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://sistemacp.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ erro: 'SUPABASE_SERVICE_KEY não configurada.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  // ── Rotas do Portal do Cliente (sem sessão — acesso por token) ──────
  if (body.action === 'portal') {
    const { token } = body;
    if (!token) return res.status(400).json({ erro: 'Token obrigatório.' });
    const SHP = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const rP = await fetch(`${SB_URL}/rest/v1/projetos_cp?token_acesso=eq.${encodeURIComponent(token)}&limit=1`, { headers: SHP });
    const projArr = rP.ok ? await rP.json() : [];
    if (!projArr.length) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    const projeto = projArr[0];
    const [etapas, docs, logs] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/projetos_etapas?projeto_id=eq.${projeto.id}&order=ordem.asc`, { headers: SHP }).then(r=>r.json()).catch(()=>[]),
      fetch(`${SB_URL}/rest/v1/projetos_docs?projeto_id=eq.${projeto.id}&order=criado_em.asc`, { headers: SHP }).then(r=>r.json()).catch(()=>[]),
      fetch(`${SB_URL}/rest/v1/projetos_logs?projeto_id=eq.${projeto.id}&order=criado_em.asc`, { headers: SHP }).then(r=>r.json()).catch(()=>[])
    ]);
    // Gerar link temporário para arquivos já enviados pelo cliente
    if (Array.isArray(docs)) {
      await Promise.all(docs.map(async d => {
        if (d.arquivo_path) d.arquivo_url = await linkArquivo(SERVICE_KEY, d.arquivo_path);
      }));
    }
    return res.status(200).json({ projeto, etapas, docs, logs });
  }

  if (body.action === 'portal_log') {
    const { token, projeto_id, texto, autor, tipo } = body;
    if (!token || !projeto_id || !texto) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHP = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    // SEGURANÇA: verificar que o token pertence ao projeto_id antes de inserir
    const rV = await fetch(`${SB_URL}/rest/v1/projetos_cp?token_acesso=eq.${encodeURIComponent(token)}&id=eq.${projeto_id}&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const vArr = rV.ok ? await rV.json() : [];
    if (!vArr.length) return res.status(403).json({ erro: 'Acesso negado.' });
    await fetch(`${SB_URL}/rest/v1/projetos_logs`, { method: 'POST', headers: SHP, body: JSON.stringify({ projeto_id, texto, autor, tipo: tipo||'cliente' }) });
    // Avisar a responsável no WhatsApp quando o cliente escreve
    if ((tipo || 'cliente') === 'cliente') {
      const proj = vArr[0];
      const emailResp = await telefoneDoUsuario(SERVICE_KEY, proj.responsavel) || 'mariana@cavalcantepinheiroadv.com.br';
      await enviarEmail(emailResp,
        `💬 Portal CP — mensagem de ${proj.cliente_nome}`,
        `O cliente ${proj.cliente_nome} enviou uma mensagem no projeto "${proj.nome}":\n\n${String(texto).slice(0, 500)}\n\nAcesse: https://sistemacp.vercel.app/colaborativo.html`);
    }
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'portal_doc') {
    const { token, doc_id, status } = body;
    if (!token || !doc_id) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHP = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    // SEGURANÇA: verificar que o doc pertence a um projeto com esse token
    const rD = await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}&select=projeto_id,titulo`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const dArr = rD.ok ? await rD.json() : [];
    if (!dArr.length) return res.status(404).json({ erro: 'Documento não encontrado.' });
    const rV = await fetch(`${SB_URL}/rest/v1/projetos_cp?token_acesso=eq.${encodeURIComponent(token)}&id=eq.${dArr[0].projeto_id}&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const vArr = rV.ok ? await rV.json() : [];
    if (!vArr.length) return res.status(403).json({ erro: 'Acesso negado.' });
    await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}`, { method: 'PATCH', headers: SHP, body: JSON.stringify({ status }) });
    // Avisar a responsável quando o cliente confirma envio por e-mail
    if (status === 'recebido') {
      const proj = vArr[0];
      const emailResp2 = await telefoneDoUsuario(SERVICE_KEY, proj.responsavel) || 'mariana@cavalcantepinheiroadv.com.br';
      await enviarEmail(emailResp2,
        `📥 Portal CP — documento confirmado por ${proj.cliente_nome}`,
        `O cliente ${proj.cliente_nome} confirmou o envio do documento "${dArr[0].titulo}" no projeto "${proj.nome}".\n\nVerifique o e-mail do cliente e acesse:\nhttps://sistemacp.vercel.app/colaborativo.html`);
    }
    return res.status(200).json({ ok: true });
  }

  // Cliente confirma que enviou o documento por e-mail (usado pelo portal)
  if (body.action === 'portal_doc_enviado') {
    const { token, doc_id } = body;
    if (!token || !doc_id) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW = { ...SHK, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const rD = await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}&select=projeto_id,titulo`, { headers: SHK });
    const dArr = rD.ok ? await rD.json() : [];
    if (!dArr.length) return res.status(404).json({ erro: 'Documento não encontrado.' });
    const rV = await fetch(`${SB_URL}/rest/v1/projetos_cp?token_acesso=eq.${encodeURIComponent(token)}&id=eq.${dArr[0].projeto_id}&limit=1`, { headers: SHK });
    const vArr = rV.ok ? await rV.json() : [];
    if (!vArr.length) return res.status(403).json({ erro: 'Acesso negado.' });
    const proj = vArr[0];
    await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}`, {
      method: 'PATCH', headers: SHW, body: JSON.stringify({ status: 'recebido' })
    });
    await fetch(`${SB_URL}/rest/v1/projetos_logs`, {
      method: 'POST', headers: SHW,
      body: JSON.stringify({
        projeto_id: proj.id,
        texto: `Documento confirmado como enviado por e-mail: "${dArr[0].titulo}"`,
        autor: proj.cliente_nome, tipo: 'cliente'
      })
    });
    const telResp = await telefoneDoUsuario(SERVICE_KEY, proj.responsavel) || process.env.WHATSAPP_EQUIPE;
    if (telResp) {
      await enviarWhatsApp(telResp,
        `📥 *Portal CP* — ${proj.cliente_nome} confirmou o envio do documento "${dArr[0].titulo}" por e-mail (projeto "${proj.nome}"). Verifique a caixa de entrada.`);
    }
    return res.status(200).json({ ok: true });
  }

  // ── Upload de documento pelo cliente (Supabase Storage) ────────────
  // 1º passo: gerar URL assinada de upload
  if (body.action === 'portal_upload') {
    const { token, doc_id, nome_arquivo } = body;
    if (!token || !doc_id || !nome_arquivo) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const rD = await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}&select=projeto_id,titulo`, { headers: SHK });
    const dArr = rD.ok ? await rD.json() : [];
    if (!dArr.length) return res.status(404).json({ erro: 'Documento não encontrado.' });
    const rV = await fetch(`${SB_URL}/rest/v1/projetos_cp?token_acesso=eq.${encodeURIComponent(token)}&id=eq.${dArr[0].projeto_id}&limit=1`, { headers: SHK });
    const vArr = rV.ok ? await rV.json() : [];
    if (!vArr.length) return res.status(403).json({ erro: 'Acesso negado.' });
    const limpo = String(nome_arquivo).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'documento';
    const path = `${dArr[0].projeto_id}/${doc_id}/${Date.now()}_${limpo}`;
    const rU = await fetch(`${SB_URL}/storage/v1/object/upload/sign/${BUCKET_PORTAL}/${path}`, {
      method: 'POST',
      headers: { ...SHK, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!rU.ok) return res.status(502).json({ erro: 'Não foi possível preparar o upload. Verifique se o bucket portal-docs existe.' });
    const dU = await rU.json();
    return res.status(200).json({ upload_url: `${SB_URL}/storage/v1${dU.url}`, path });
  }

  // 2º passo: confirmar upload → marca recebido, registra log e avisa a equipe
  if (body.action === 'portal_upload_done') {
    const { token, doc_id, path, nome_arquivo } = body;
    if (!token || !doc_id || !path) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW = { ...SHK, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const rD = await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}&select=projeto_id,titulo`, { headers: SHK });
    const dArr = rD.ok ? await rD.json() : [];
    if (!dArr.length) return res.status(404).json({ erro: 'Documento não encontrado.' });
    const rV = await fetch(`${SB_URL}/rest/v1/projetos_cp?token_acesso=eq.${encodeURIComponent(token)}&id=eq.${dArr[0].projeto_id}&limit=1`, { headers: SHK });
    const vArr = rV.ok ? await rV.json() : [];
    if (!vArr.length) return res.status(403).json({ erro: 'Acesso negado.' });
    // O path precisa pertencer a este documento
    if (!String(path).startsWith(`${dArr[0].projeto_id}/${doc_id}/`)) {
      return res.status(403).json({ erro: 'Caminho de arquivo inválido.' });
    }
    const proj = vArr[0];
    await fetch(`${SB_URL}/rest/v1/projetos_docs?id=eq.${doc_id}`, {
      method: 'PATCH', headers: SHW,
      body: JSON.stringify({ status: 'recebido', arquivo_path: path, arquivo_nome: nome_arquivo || null })
    });
    await fetch(`${SB_URL}/rest/v1/projetos_logs`, {
      method: 'POST', headers: SHW,
      body: JSON.stringify({
        projeto_id: proj.id,
        texto: `📎 Documento enviado pelo portal: "${dArr[0].titulo}"`,
        autor: proj.cliente_nome, tipo: 'cliente'
      })
    });
    const emailResp3 = await telefoneDoUsuario(SERVICE_KEY, proj.responsavel) || 'mariana@cavalcantepinheiroadv.com.br';
    await enviarEmail(emailResp3, `📎 Portal CP — arquivo enviado por ${proj.cliente_nome}`,
        `📎 Portal CP — ${proj.cliente_nome} anexou o documento "${dArr[0].titulo}" no projeto "${proj.nome}". O arquivo já está disponível no colaborativo.`);
    return res.status(200).json({ ok: true });
  }

  // ── Avaliação de projeto pelo cliente (sem sessão — acesso por token) ──
  if (body.action === 'avaliar_projeto') {
    const { token: tkAval, projeto_id, nota, comentario } = body;
    if (!tkAval || !projeto_id || !nota) return res.status(400).json({ erro: 'Dados incompletos.' });
    if (nota < 1 || nota > 5) return res.status(400).json({ erro: 'Nota deve ser entre 1 e 5.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW = { ...SHK, 'Content-Type': 'application/json', Prefer: 'return=minimal' };

    // Verificar que o token do cliente tem acesso ao projeto
    const rC = await fetch(`${SB_URL}/rest/v1/clientes?portal_token=eq.${encodeURIComponent(tkAval)}&select=id,nome&limit=1`, { headers: SHK });
    const cArr = rC.ok ? await rC.json() : [];
    if (!cArr.length) return res.status(403).json({ erro: 'Token inválido.' });
    const cli = cArr[0];

    const rP = await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${projeto_id}&cliente_id=eq.${cli.id}&limit=1`, { headers: SHK });
    const pArr = rP.ok ? await rP.json() : [];
    if (!pArr.length) return res.status(403).json({ erro: 'Acesso negado a este projeto.' });

    // Criar tabela graciosamente: tenta inserir; se falhar por tabela inexistente, retorna ok parcial
    // (a tabela projetos_avaliacoes deve ser criada na migração do Supabase)
    try {
      // Upsert: uma avaliação por cliente por projeto
      const rAval = await fetch(`${SB_URL}/rest/v1/projetos_avaliacoes`, {
        method: 'POST',
        headers: { ...SHW, Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({
          projeto_id,
          cliente_id: cli.id,
          nota: Number(nota),
          comentario: comentario || null,
          criado_em: new Date().toISOString()
        })
      });
      // Marcar projeto com flag de avaliação
      await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${projeto_id}`, {
        method: 'PATCH',
        headers: SHW,
        body: JSON.stringify({ _avaliacao_nota: Number(nota) })
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      // Tabela ainda não existe — retorna ok para não quebrar o frontend
      console.warn('[avaliar_projeto] tabela projetos_avaliacoes não encontrada:', e.message);
      return res.status(200).json({ ok: true, aviso: 'Tabela de avaliações não configurada.' });
    }
  }

  // ── ÁREA DO CLIENTE: visão consolidada de todos os assuntos ────────
  // Acesso por token único do cliente + verificação leve (4 últimos
  // dígitos do CPF/CNPJ, quando cadastrado).
  if (body.action === 'portal_cliente') {
    const { token, verificacao } = body;
    if (!token) return res.status(400).json({ erro: 'Token obrigatório.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const rC = await fetch(`${SB_URL}/rest/v1/clientes?portal_token=eq.${encodeURIComponent(token)}&limit=1`, { headers: SHK });
    const cArr = rC.ok ? await rC.json() : [];
    if (!cArr.length) return res.status(404).json({ erro: 'Link inválido ou expirado.' });
    const cli = cArr[0];

    // Verificação leve
    const doc = (cli.cpf_cnpj || '').replace(/\D/g, '');
    if (doc.length >= 4) {
      if (!verificacao) {
        return res.status(200).json({ precisa_verificacao: true, nome: (cli.nome || '').split(' ')[0] });
      }
      if (String(verificacao).replace(/\D/g, '') !== doc.slice(-4)) {
        return res.status(403).json({ erro: 'Código não confere. Use os 4 últimos dígitos do seu CPF ou CNPJ.' });
      }
    }

    // Todos os assuntos do cliente
    const rP = await fetch(`${SB_URL}/rest/v1/projetos_cp?cliente_id=eq.${cli.id}&order=atualizado_em.desc`, { headers: SHK });
    const projetos = rP.ok ? await rP.json() : [];
    if (!projetos.length) {
      return res.status(200).json({ cliente: { nome: cli.nome }, projetos: [], etapas: [], docs: [], logs: [] });
    }
    const ids = projetos.map(p => p.id).join(',');
    const [etapas, docs, logs, checklist] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/projetos_etapas?projeto_id=in.(${ids})&order=ordem.asc`, { headers: SHK }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_docs?projeto_id=in.(${ids})&order=criado_em.asc`, { headers: SHK }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_logs?projeto_id=in.(${ids})&or=(tipo.eq.publico,tipo.eq.cliente)&order=criado_em.asc`, { headers: SHK }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_checklist?etapa_id=in.(select id from projetos_etapas where projeto_id=in.(${ids}))&order=ordem.asc`, { headers: SHK }).then(r => r.ok ? r.json() : []).catch(() => [])
    ]);
    // Buscar checklist de outra forma (join manual)
    const etapaIds = Array.isArray(etapas) ? etapas.map(e => e.id).join(',') : '';
    const checklistReal = etapaIds
      ? await fetch(`${SB_URL}/rest/v1/projetos_checklist?etapa_id=in.(${etapaIds})&order=ordem.asc`, { headers: SHK }).then(r => r.ok ? r.json() : []).catch(() => [])
      : [];
    if (Array.isArray(docs)) {
      await Promise.all(docs.map(async d => {
        if (d.arquivo_path) d.arquivo_url = await linkArquivo(SERVICE_KEY, d.arquivo_path);
      }));
    }
    return res.status(200).json({ cliente: { nome: cli.nome }, projetos, etapas, docs, logs, checklist: checklistReal });
  }

  // ── Rota especial: WEBHOOK PUBLICAÇÕES (Apps Script OAB/BA) ────────
  // Não requer sessão — usa PUBLICACAO_WEBHOOK_SECRET
  if (body.action === 'publicacao') {
    const SECRET = process.env.PUBLICACAO_WEBHOOK_SECRET;
    if (SECRET && body.secret !== SECRET) {
      return res.status(401).json({ erro: 'Webhook secret inválido.' });
    }
    const SH2 = {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    };
    const { data_disponibilizacao, data_publicacao, jornal, tribunal, vara,
            numero_processo, conteudo, email_origem } = body;
    if (!tribunal && !jornal) return res.status(400).json({ erro: 'Publicação inválida.' });
    // Deduplicar
    if (numero_processo && data_disponibilizacao) {
      const rD = await fetch(
        `${SB_URL}/rest/v1/publicacoes?numero_processo=eq.${encodeURIComponent(numero_processo)}&data_disponibilizacao=eq.${data_disponibilizacao}&limit=1`,
        { headers: SH2 }
      );
      if (rD.ok) { const d = await rD.json(); if (d.length) return res.status(200).json({ status: 'duplicata' }); }
    }
    // Inserir publicação
    const rI = await fetch(`${SB_URL}/rest/v1/publicacoes`, {
      method: 'POST', headers: SH2,
      body: JSON.stringify({ data_disponibilizacao, data_publicacao, jornal, tribunal,
        vara, numero_processo, conteudo, email_origem, status: 'nao_tratada' })
    });
    const ins = rI.ok ? await rI.json() : null;
    const pubId = ins?.[0]?.id || ins?.id;

    // Auto-criar processo se tiver número CNJ e não existir ainda
    if (numero_processo && pubId) {
      const rProc = await fetch(
        `${SB_URL}/rest/v1/processos?numero_processo=eq.${encodeURIComponent(numero_processo)}&limit=1`,
        { headers: SH2 }
      );
      const procs = rProc.ok ? await rProc.json() : [];
      if (procs.length === 0) {
        // Criar processo novo
        const rNovo = await fetch(`${SB_URL}/rest/v1/processos`, {
          method: 'POST', headers: SH2,
          body: JSON.stringify({ numero_processo, tribunal, vara, status: 'ativo' })
        });
        if (rNovo.ok) {
          const proc = await rNovo.json();
          const procId = proc?.[0]?.id || proc?.id;
          // Adicionar publicação ao histórico do processo
          if (procId) {
            await fetch(`${SB_URL}/rest/v1/processos_historico`, {
              method: 'POST', headers: SH2,
              body: JSON.stringify({
                processo_id: procId, tipo: 'publicacao',
                descricao: `Publicação capturada automaticamente — ${jornal||tribunal||''}`,
                data_evento: data_disponibilizacao || data_publicacao,
                publicacao_id: pubId, criado_por: 'Sistema'
              })
            });
            // Vincular processo à publicação
            await fetch(`${SB_URL}/rest/v1/publicacoes?id=eq.${pubId}`, {
              method: 'PATCH', headers: SH2,
              body: JSON.stringify({ processo_id: procId })
            });
          }
        }
      } else {
        // Processo já existe — só adicionar ao histórico
        const procId = procs[0].id;
        await fetch(`${SB_URL}/rest/v1/processos_historico`, {
          method: 'POST', headers: SH2,
          body: JSON.stringify({
            processo_id: procId, tipo: 'publicacao',
            descricao: `Nova publicação — ${jornal||tribunal||''}`,
            data_evento: data_disponibilizacao || data_publicacao,
            publicacao_id: pubId, criado_por: 'Sistema'
          })
        });
        await fetch(`${SB_URL}/rest/v1/processos?id=eq.${procId}`, {
          method: 'PATCH', headers: SH2,
          body: JSON.stringify({ atualizado_em: new Date().toISOString() })
        });
        await fetch(`${SB_URL}/rest/v1/publicacoes?id=eq.${pubId}`, {
          method: 'PATCH', headers: SH2,
          body: JSON.stringify({ processo_id: procId })
        });
      }
    }

    return res.status(rI.ok ? 200 : 502).json(ins || { erro: await rI.text() });
  }

  // ── Rota especial: LOGIN (não requer sessão) ──────────────────────
  if (body.action === 'login') {
    const { username, senha_hash } = body;
    if (!username || !senha_hash) return res.status(400).json({ erro: 'Credenciais inválidas.' });
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}&senha_hash=eq.${senha_hash}&ativo=eq.true&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const users = r.ok ? await r.json() : [];
      if (!users.length) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
      const u = users[0];
      // Gerar token de sessão: base64(username:hash:timestamp)
      const token = Buffer.from(`${u.username}:${u.senha_hash}:${Date.now()}`).toString('base64');
      return res.status(200).json({
        token,
        user: { id: u.id, username: u.username, nome: u.nome, cargo: u.cargo,
                ini: u.ini, cor: u.cor, is_admin: u.is_admin }
      });
    } catch (e) { return res.status(500).json({ erro: e.message }); }
  }

  // ── 1. Verificar sessão ──────────────────────────────────────────
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) return res.status(401).json({ erro: 'Sessão não autenticada.' });

  // Decodificar token de sessão (base64: username:hash:timestamp)
  let sessaoValida = false;
  let usuarioAtual = null;
  try {
    const decoded = Buffer.from(sessionToken, 'base64').toString('utf8');
    const [username, senhaHash, timestamp] = decoded.split(':');

    // Verificar se a sessão não expirou (12 horas)
    if (Date.now() - Number(timestamp) > 12 * 3600 * 1000) {
      return res.status(401).json({ erro: 'Sessão expirada.' });
    }

    // Verificar usuário no banco usando service role
    const r = await fetch(
      `${SB_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}&senha_hash=eq.${senhaHash}&ativo=eq.true&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const users = r.ok ? await r.json() : [];
    if (users.length > 0) {
      sessaoValida = true;
      usuarioAtual = users[0];
    }
  } catch {}

  if (!sessaoValida) return res.status(401).json({ erro: 'Sessão inválida.' });

  // ── Ações autenticadas da equipe ──────────────────────────────────
  // Link temporário para abrir arquivo enviado pelo cliente
  if (body.action === 'arquivo_url') {
    const url = await linkArquivo(SERVICE_KEY, body.path, 3600);
    if (!url) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    return res.status(200).json({ url });
  }

  // Gerar (ou recuperar) o link único da Área do Cliente
  if (body.action === 'portal_cliente_link') {
    const { cliente_id } = body;
    if (!cliente_id) return res.status(400).json({ erro: 'cliente_id obrigatório.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const rC = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${cliente_id}&select=id,portal_token&limit=1`, { headers: SHK });
    const cArr = rC.ok ? await rC.json() : [];
    if (!cArr.length) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    let tk = cArr[0].portal_token;
    if (!tk) {
      tk = require('crypto').randomBytes(24).toString('hex');
      const rU = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${cliente_id}`, {
        method: 'PATCH',
        headers: { ...SHK, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ portal_token: tk })
      });
      if (!rU.ok) return res.status(502).json({ erro: 'Não foi possível gerar o link. Rode a migração da Área do Cliente no Supabase.' });
    }
    return res.status(200).json({ link: `https://sistemacp.vercel.app/portal-cliente.html?t=${tk}` });
  }

  // Avisar o cliente no WhatsApp (etapa concluída, doc solicitado, nova mensagem)
  if (body.action === 'notificar_cliente') {
    const { projeto_id, evento, detalhe } = body;
    if (!projeto_id || !evento) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHK = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const rP = await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${projeto_id}&limit=1`, { headers: SHK });
    const pArr = rP.ok ? await rP.json() : [];
    if (!pArr.length) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    const p = pArr[0];
    // Telefone: o do projeto ou, se vinculado, o do cadastro do cliente.
    // Link: prefere a Área do Cliente quando o vínculo existe.
    let telefone = p.cliente_telefone || null;
    let link = `https://sistemacp.vercel.app/portal.html?token=${p.token_acesso}`;
    if (p.cliente_id) {
      try {
        const rC = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${p.cliente_id}&select=contato,portal_token&limit=1`, { headers: SHK });
        const cArr = rC.ok ? await rC.json() : [];
        if (cArr.length) {
          if (!telefone) telefone = cArr[0].contato || null;
          if (cArr[0].portal_token) link = `https://sistemacp.vercel.app/portal-cliente.html?t=${cArr[0].portal_token}`;
        }
      } catch {}
    }
    if (!telefone) return res.status(200).json({ ok: false, motivo: 'sem_telefone' });
    const nome = (p.cliente_nome || '').split(' ')[0];
    let msg;
    if (evento === 'etapa_concluida') {
      msg = `Olá, ${nome}! ✅\n\nBoa notícia: avançamos no seu projeto *${p.nome}*. A etapa *${detalhe}* foi concluída.\n\nAcompanhe tudo em tempo real no seu portal exclusivo:\n${link}\n\n_Cavalcante Pinheiro Advocacia_`;
    } else if (evento === 'documento_solicitado') {
      msg = `Olá, ${nome}! 📄\n\nPara avançarmos no seu projeto *${p.nome}*, precisamos de um documento: *${detalhe}*.\n\nVocê pode enviá-lo com segurança, em poucos cliques, pelo seu portal:\n${link}\n\n_Cavalcante Pinheiro Advocacia_`;
    } else {
      msg = `Olá, ${nome}! 💬\n\nVocê tem uma nova atualização da equipe no portal do seu projeto *${p.nome}*.\n\nConfira:\n${link}\n\n_Cavalcante Pinheiro Advocacia_`;
    }
    const enviado = await enviarWhatsApp(telefone, msg);
    return res.status(200).json({ ok: enviado });
  }

  // ── 2. Validar tabela e operação ─────────────────────────────────
  const { tabela, filtros = '', dados } = body;

  if (!tabela || !TABELAS_PERMITIDAS.has(tabela)) {
    return res.status(400).json({ erro: `Tabela não permitida: ${tabela}` });
  }

  // Não-admins não acessam a tabela de usuários
  if (tabela === 'usuarios' && !usuarioAtual.is_admin) {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }

  const SH = {
    apikey:        SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer':       'return=representation'
  };

  // ── 3. Executar operação com service role ────────────────────────
  try {
    const url = `${SB_URL}/rest/v1/${tabela}${filtros ? '?' + filtros : ''}`;

    let r;
    // GET e SELECT (POST sem _op=insert) → SELECT
    if (req.method === 'GET' || (req.method === 'POST' && body._op !== 'insert')) {
      r = await fetch(url, { headers: SH });
    } else if (req.method === 'POST' && body._op === 'insert') {
      r = await fetch(url, { method: 'POST', headers: SH, body: JSON.stringify(dados) });
    } else if (req.method === 'PATCH') {
      r = await fetch(url, { method: 'PATCH', headers: SH, body: JSON.stringify(dados) });
    } else if (req.method === 'DELETE') {
      r = await fetch(url, { method: 'DELETE', headers: { ...SH, Prefer: 'return=minimal' } });
      return res.status(r.status).end();
    } else {
      return res.status(405).json({ erro: 'Método não permitido.' });
    }

    const resultado = await r.json();
    return res.status(r.status).json(resultado);

  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
