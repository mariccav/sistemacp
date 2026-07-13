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
  'projetos_avaliacoes', 'projetos_checklist',
  'diligencias'
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

  // ── portal_reply: cliente ou equipe responde a uma atualização ──────
  if (body.action === 'portal_reply') {
    const { token: tkR, projeto_id: pjR, texto: txR, autor: autR, resposta_para } = body;
    if (!txR || !pjR) return res.status(400).json({ erro: 'Dados incompletos.' });
    const SHK2 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW2 = { ...SHK2, 'Content-Type': 'application/json', Prefer: 'return=representation' };

    // Aceita autenticação por token de cliente OU por sessão interna
    let autorNome = autR || 'Anônimo';
    let tipoAutor = 'cliente';
    let projParaEmail = null;

    if (tkR) {
      // Validar token de cliente
      const rV = await fetch(`${SB_URL}/rest/v1/clientes?portal_token=eq.${encodeURIComponent(tkR)}&select=id,nome,email&limit=1`, { headers: SHK2 });
      const cArr = rV.ok ? await rV.json() : [];
      if (!cArr.length) return res.status(403).json({ erro: 'Token inválido.' });
      autorNome = cArr[0].nome || autorNome;
      tipoAutor = 'cliente';
      // Verificar que o projeto pertence a esse cliente
      const rP = await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${pjR}&cliente_id=eq.${cArr[0].id}&limit=1`, { headers: SHK2 });
      const pArr = rP.ok ? await rP.json() : [];
      if (!pArr.length) return res.status(403).json({ erro: 'Acesso negado.' });
      projParaEmail = pArr[0];
    } else {
      // Sessão interna — verificar x-session-token inline
      const sessT = req.headers['x-session-token'];
      if (!sessT) return res.status(401).json({ erro: 'Autenticação necessária.' });
      try {
        const dec = Buffer.from(sessT, 'base64').toString('utf8');
        const [uname, uhash] = dec.split(':');
        const rU = await fetch(`${SB_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(uname)}&senha_hash=eq.${uhash}&ativo=eq.true&limit=1`, { headers: SHK2 });
        const uArr = rU.ok ? await rU.json() : [];
        if (!uArr.length) return res.status(403).json({ erro: 'Sessão inválida.' });
        autorNome = uArr[0].nome || uname;
        tipoAutor = 'equipe';
      } catch { return res.status(401).json({ erro: 'Token inválido.' }); }
    }

    const novoLog = {
      projeto_id: pjR,
      texto: txR,
      autor: autorNome,
      tipo: tipoAutor,
      subtipo: 'resposta',
      visivel_cliente: true,
      resposta_para: resposta_para || null,
      criado_em: new Date().toISOString()
    };
    const rLog = await fetch(`${SB_URL}/rest/v1/projetos_logs`, { method: 'POST', headers: SHW2, body: JSON.stringify(novoLog) });
    const logArr = rLog.ok ? await rLog.json() : [];

    // Notificar equipe se resposta do cliente
    if (tipoAutor === 'cliente' && projParaEmail) {
      const emailResp = await telefoneDoUsuario(SERVICE_KEY, projParaEmail.responsavel) || 'mariana@cavalcantepinheiroadv.com.br';
      await enviarEmail(emailResp,
        `💬 Portal CP — ${autorNome} respondeu`,
        `O cliente ${autorNome} respondeu a uma atualização no projeto "${projParaEmail.nome}":\n\n"${String(txR).slice(0, 400)}"\n\nAcesse: https://sistemacp.vercel.app/colaborativo.html`);
    }
    return res.status(200).json({ ok: true, log: Array.isArray(logArr) ? logArr[0] : logArr });
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
      return res.status(200).json({ cliente: { id: cli.id, nome: cli.nome }, projetos: [], etapas: [], docs: [], logs: [] });
    }
    const ids = projetos.map(p => p.id).join(',');
    const [etapas, docs, logs, checklist] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/projetos_etapas?projeto_id=in.(${ids})&order=ordem.asc`, { headers: SHK }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_docs?projeto_id=in.(${ids})&order=criado_em.asc`, { headers: SHK }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_logs?projeto_id=in.(${ids})&or=(visivel_cliente.is.null,visivel_cliente.eq.true)&order=criado_em.asc`, { headers: SHK }).then(r => r.json()).catch(() => []),
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
    return res.status(200).json({ cliente: { id: cli.id, nome: cli.nome }, projetos, etapas, docs, logs, checklist: checklistReal });
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

  // ── 1. Verificar sessão (equipe) OU portal_token (cliente colaborativo) ─
  let sessaoValida = false;
  let usuarioAtual = null;

  // Opção A: portal_token no body — cliente com acesso colaborativo completo
  if (body.portal_token) {
    try {
      const SHKpt = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
      const rCpt = await fetch(`${SB_URL}/rest/v1/clientes?portal_token=eq.${encodeURIComponent(body.portal_token)}&select=id,nome&limit=1`, { headers: SHKpt });
      const cptArr = rCpt.ok ? await rCpt.json() : [];
      if (cptArr.length) {
        sessaoValida = true;
        usuarioAtual = { id: cptArr[0].id, nome: cptArr[0].nome, cargo: 'cliente', is_admin: false, _cliente_id: cptArr[0].id };
      }
    } catch {}
  }

  // Opção B: x-session-token — colaboradora da equipe
  if (!sessaoValida) {
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) return res.status(401).json({ erro: 'Sessão não autenticada.' });
    try {
      const decoded = Buffer.from(sessionToken, 'base64').toString('utf8');
      const [username, senhaHash, timestamp] = decoded.split(':');
      if (Date.now() - Number(timestamp) > 12 * 3600 * 1000) {
        return res.status(401).json({ erro: 'Sessão expirada.' });
      }
      const r = await fetch(
        `${SB_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}&senha_hash=eq.${senhaHash}&ativo=eq.true&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const users = r.ok ? await r.json() : [];
      if (users.length > 0) { sessaoValida = true; usuarioAtual = users[0]; }
    } catch {}
  }

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
    return res.status(200).json({ link: `https://sistemacp.vercel.app/portal.html?t=${tk}` });
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

  // ── check_session — verificar se há sessão interna válida ───────────
  if (body.action === 'check_session') {
    return res.status(200).json({ ok: true, usuario: { nome: usuarioAtual.nome, cargo: usuarioAtual.cargo, ini: usuarioAtual.ini } });
  }

  // ── portal_etapa_add — adicionar atividade/etapa a um processo ────────
  if (body.action === 'portal_etapa_add') {
    const { projeto_id: pjEt, titulo: titEt, descricao: descEt, status: stEt } = body;
    if (!pjEt || !titEt) return res.status(400).json({ erro: 'projeto_id e titulo são obrigatórios.' });
    const SHKe = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const rMaxOrd = await fetch(`${SB_URL}/rest/v1/projetos_etapas?projeto_id=eq.${pjEt}&select=ordem&order=ordem.desc&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const ordArr = rMaxOrd.ok ? await rMaxOrd.json() : [];
    const proxOrdem = ordArr.length ? (ordArr[0].ordem || 0) + 1 : 1;
    const rEt = await fetch(`${SB_URL}/rest/v1/projetos_etapas`, {
      method: 'POST', headers: SHKe,
      body: JSON.stringify({ projeto_id: pjEt, titulo: titEt, descricao: descEt || null, status: stEt || 'pendente', ordem: proxOrdem, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
    });
    const etArr = rEt.ok ? await rEt.json() : null;
    await fetch(`${SB_URL}/rest/v1/projetos_logs`, { method: 'POST', headers: SHKe, body: JSON.stringify({ projeto_id: pjEt, texto: `Atividade adicionada: "${titEt}"`, autor: usuarioAtual.nome, tipo: usuarioAtual.cargo || 'equipe', subtipo: 'sistema', visivel_cliente: true }) });
    return res.status(200).json({ ok: true, etapa: Array.isArray(etArr) ? etArr[0] : etArr });
  }

  // ── portal_etapa_update — atualizar etapa (status, titulo, desc) ──────
  if (body.action === 'portal_etapa_update') {
    const { etapa_id, campos: camposEt } = body;
    if (!etapa_id || !camposEt) return res.status(400).json({ erro: 'etapa_id e campos são obrigatórios.' });
    const SHKeu = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const permEt = ['titulo','descricao','status','ordem'];
    const dadosEt = { atualizado_em: new Date().toISOString() };
    permEt.forEach(k => { if (camposEt[k] !== undefined) dadosEt[k] = camposEt[k]; });
    await fetch(`${SB_URL}/rest/v1/projetos_etapas?id=eq.${etapa_id}`, { method: 'PATCH', headers: SHKeu, body: JSON.stringify(dadosEt) });
    return res.status(200).json({ ok: true });
  }

  // ── portal_checklist_add — adicionar item de checklist ────────────────
  if (body.action === 'portal_checklist_add') {
    const { etapa_id: etCk, texto: txtCk } = body;
    if (!etCk || !txtCk) return res.status(400).json({ erro: 'etapa_id e texto são obrigatórios.' });
    const SHKck = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const rCk = await fetch(`${SB_URL}/rest/v1/projetos_checklist`, { method: 'POST', headers: SHKck, body: JSON.stringify({ etapa_id: etCk, texto: txtCk, concluido: false, criado_em: new Date().toISOString() }) });
    const ckArr = rCk.ok ? await rCk.json() : null;
    return res.status(200).json({ ok: true, item: Array.isArray(ckArr) ? ckArr[0] : ckArr });
  }

  // ── portal_checklist_toggle — marcar/desmarcar checklist ─────────────
  if (body.action === 'portal_checklist_toggle') {
    const { item_id, concluido } = body;
    if (!item_id) return res.status(400).json({ erro: 'item_id obrigatório.' });
    const SHKct = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    await fetch(`${SB_URL}/rest/v1/projetos_checklist?id=eq.${item_id}`, { method: 'PATCH', headers: SHKct, body: JSON.stringify({ concluido: !!concluido }) });
    return res.status(200).json({ ok: true });
  }

  // ── portal_clientes_lista — equipe: lista todos os clientes com contagem de projetos ─
  if (body.action === 'portal_clientes_lista') {
    const SHK8 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const [rCli, rPro] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/clientes?select=id,nome,contato,email,portal_token&order=nome.asc`, { headers: SHK8 }),
      fetch(`${SB_URL}/rest/v1/projetos_cp?select=id,cliente_id,status&status=neq.arquivado`, { headers: SHK8 })
    ]);
    const clientes = rCli.ok ? await rCli.json() : [];
    const projArr = rPro.ok ? await rPro.json() : [];
    // Contar projetos por cliente
    const contagemAndamento = {}, contagemTotal = {};
    (projArr || []).forEach(p => {
      if (!p.cliente_id) return;
      contagemTotal[p.cliente_id] = (contagemTotal[p.cliente_id] || 0) + 1;
      if (p.status !== 'concluido') contagemAndamento[p.cliente_id] = (contagemAndamento[p.cliente_id] || 0) + 1;
    });
    const resultado = clientes.map(c => ({
      id: c.id,
      nome: c.nome,
      email: c.email || c.contato || null,
      portal_token: c.portal_token || null,
      total_projetos: contagemTotal[c.id] || 0,
      em_andamento: contagemAndamento[c.id] || 0
    }));
    return res.status(200).json(resultado);
  }

  // ── portal_cliente_equipe — equipe: carrega portal de um cliente por ID (sem token de cliente) ─
  if (body.action === 'portal_cliente_equipe') {
    const { cliente_id: cliId } = body;
    if (!cliId) return res.status(400).json({ erro: 'cliente_id obrigatório.' });
    const SHK9 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const rCli2 = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${cliId}&select=id,nome,criado_em,portal_token&limit=1`, { headers: SHK9 });
    const cliArr2 = rCli2.ok ? await rCli2.json() : [];
    if (!cliArr2.length) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    const cli2 = cliArr2[0];
    const rP2 = await fetch(`${SB_URL}/rest/v1/projetos_cp?cliente_id=eq.${cli2.id}&order=atualizado_em.desc`, { headers: SHK9 });
    const projetos2 = rP2.ok ? await rP2.json() : [];
    if (!projetos2.length) {
      return res.status(200).json({ cliente: { id: cli2.id, nome: cli2.nome, criado_em: cli2.criado_em, portal_token: cli2.portal_token }, projetos: [], etapas: [], docs: [], logs: [] });
    }
    const ids2 = projetos2.map(p => p.id).join(',');
    const [etapas2, docs2, logs2] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/projetos_etapas?projeto_id=in.(${ids2})&order=ordem.asc`, { headers: SHK9 }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_docs?projeto_id=in.(${ids2})&order=criado_em.asc`, { headers: SHK9 }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/projetos_logs?projeto_id=in.(${ids2})&order=criado_em.asc`, { headers: SHK9 }).then(r => r.json()).catch(() => [])
    ]);
    if (Array.isArray(docs2)) {
      await Promise.all(docs2.map(async d => {
        if (d.arquivo_path) d.arquivo_url = await linkArquivo(SERVICE_KEY, d.arquivo_path);
      }));
    }
    return res.status(200).json({ cliente: { id: cli2.id, nome: cli2.nome, criado_em: cli2.criado_em, portal_token: cli2.portal_token }, projetos: projetos2, etapas: etapas2, docs: docs2, logs: logs2 });
  }

  // ── portal_criar_subprojeto — criar processo filho ───────────────────
  if (body.action === 'portal_criar_subprojeto') {
    const { parent_id, cliente_id, nome: nomeSub, numero_processo, tipo_acao, vara_tribunal,
            comarca, parte_autora, parte_re, valor_causa, situacao_atual, descricao_longa,
            responsavel: respSub, status: stSub } = body;
    if (!cliente_id || !nomeSub) return res.status(400).json({ erro: 'cliente_id e nome são obrigatórios.' });
    const SHK3 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW3 = { ...SHK3, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const dadosProc = {
      cliente_id, nome: nomeSub, tipo: 'processo',
      parent_id: parent_id || null,
      numero_processo: numero_processo || null,
      tipo_acao: tipo_acao || null,
      vara_tribunal: vara_tribunal || null,
      comarca: comarca || null,
      parte_autora: parte_autora || null,
      parte_re: parte_re || null,
      valor_causa: valor_causa || null,
      situacao_atual: situacao_atual || null,
      descricao_longa: descricao_longa || null,
      responsavel: respSub || usuarioAtual.nome,
      status: stSub || 'em_andamento',
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    };
    // Buscar cliente_nome para preencher campo legado
    try {
      const rCli = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${cliente_id}&select=nome&limit=1`, { headers: SHK3 });
      const cliArr = rCli.ok ? await rCli.json() : [];
      if (cliArr.length) dadosProc.cliente_nome = cliArr[0].nome;
    } catch {}
    const rCria = await fetch(`${SB_URL}/rest/v1/projetos_cp`, { method: 'POST', headers: SHW3, body: JSON.stringify(dadosProc) });
    if (!rCria.ok) return res.status(502).json({ erro: 'Erro ao criar processo.' });
    const criado = await rCria.json();
    const procId = Array.isArray(criado) ? criado[0]?.id : criado?.id;
    // Log de sistema
    if (procId) {
      await fetch(`${SB_URL}/rest/v1/projetos_logs`, {
        method: 'POST', headers: SHW3,
        body: JSON.stringify({ projeto_id: procId, texto: `Processo criado por ${usuarioAtual.nome}.`, autor: usuarioAtual.nome, tipo: 'equipe', subtipo: 'sistema', visivel_cliente: false })
      });
    }
    return res.status(200).json({ ok: true, processo: Array.isArray(criado) ? criado[0] : criado });
  }

  // ── portal_atualizar_projeto — editar campos de processo/projeto ─────
  if (body.action === 'portal_atualizar_projeto') {
    const { projeto_id: pjUp, campos } = body;
    if (!pjUp || !campos) return res.status(400).json({ erro: 'projeto_id e campos são obrigatórios.' });
    const SHK4 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW4 = { ...SHK4, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const camposPermitidos = ['nome','status','situacao_atual','proximos_passos','descricao_longa',
      'numero_processo','tipo_acao','vara_tribunal','comarca','parte_autora','parte_re','valor_causa','responsavel'];
    const dadosUp = { atualizado_em: new Date().toISOString() };
    const alterados = [];
    for (const k of camposPermitidos) {
      if (campos[k] !== undefined) { dadosUp[k] = campos[k]; alterados.push(k); }
    }
    await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${pjUp}`, { method: 'PATCH', headers: SHW4, body: JSON.stringify(dadosUp) });
    await fetch(`${SB_URL}/rest/v1/projetos_logs`, {
      method: 'POST', headers: { ...SHK4, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ projeto_id: pjUp, texto: `Atualizado por ${usuarioAtual.nome}: ${alterados.join(', ')}.`, autor: usuarioAtual.nome, tipo: 'equipe', subtipo: 'sistema', visivel_cliente: false })
    });
    return res.status(200).json({ ok: true });
  }

  // ── portal_timeline_add — equipe adiciona marco cronológico ──────────
  if (body.action === 'portal_timeline_add') {
    const { projeto_id: pjTl, titulo: tituloTl, texto: textoTl, data_evento } = body;
    if (!pjTl || !textoTl) return res.status(400).json({ erro: 'projeto_id e texto são obrigatórios.' });
    const SHK5 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const dtEvento = data_evento || new Date().toISOString();
    const rTl = await fetch(`${SB_URL}/rest/v1/projetos_logs`, {
      method: 'POST', headers: SHK5,
      body: JSON.stringify({ projeto_id: pjTl, titulo: tituloTl || null, texto: textoTl, autor: usuarioAtual.nome, tipo: 'equipe', subtipo: 'timeline', visivel_cliente: true, criado_em: dtEvento })
    });
    const tlArr = rTl.ok ? await rTl.json() : [];
    return res.status(200).json({ ok: true, log: Array.isArray(tlArr) ? tlArr[0] : tlArr });
  }

  // ── portal_update_pub — equipe publica atualização formal ao cliente ─
  if (body.action === 'portal_update_pub') {
    const { projeto_id: pjPub, titulo: tituloPub, texto: textoPub, enviar_email } = body;
    if (!pjPub || !textoPub) return res.status(400).json({ erro: 'projeto_id e texto são obrigatórios.' });
    const SHK6 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW6 = { ...SHK6, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    // Buscar projeto + cliente para email
    const rProj = await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${pjPub}&select=id,nome,cliente_id,cliente_nome,responsavel&limit=1`, { headers: SHK6 });
    const projArr = rProj.ok ? await rProj.json() : [];
    if (!projArr.length) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    const proj = projArr[0];
    // Inserir log
    const rPub = await fetch(`${SB_URL}/rest/v1/projetos_logs`, {
      method: 'POST', headers: SHW6,
      body: JSON.stringify({ projeto_id: pjPub, titulo: tituloPub || 'Atualização', texto: textoPub, autor: usuarioAtual.nome, tipo: 'equipe', subtipo: 'atualizacao', visivel_cliente: true })
    });
    const pubArr = rPub.ok ? await rPub.json() : [];
    const logId = Array.isArray(pubArr) ? pubArr[0]?.id : pubArr?.id;

    // Email ao cliente (se solicitado ou por padrão)
    if (enviar_email !== false) {
      let emailCliente = null;
      if (proj.cliente_id) {
        try {
          const rCli = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${proj.cliente_id}&select=email,contato,portal_token&limit=1`, { headers: SHK6 });
          const cliArr = rCli.ok ? await rCli.json() : [];
          if (cliArr.length) {
            emailCliente = cliArr[0].email || cliArr[0].contato || null;
            const portalUrl = cliArr[0].portal_token
              ? `https://sistemacp.vercel.app/portal-cliente.html?t=${cliArr[0].portal_token}${logId ? '#update-' + logId : ''}`
              : null;
            if (emailCliente && portalUrl) {
              await enviarEmail(emailCliente,
                `📋 ${tituloPub || 'Nova atualização no seu processo'} — Cavalcante Pinheiro`,
                `Olá,\n\nHá uma nova atualização sobre o seu assunto "${proj.nome}":\n\n"${String(textoPub).slice(0, 600)}${textoPub.length > 600 ? '...' : ''}"\n\nAcesse todos os detalhes e responda diretamente pelo portal:\n${portalUrl}\n\n_Cavalcante Pinheiro Advocacia_\nOAB/BA 49.675`);
            }
          }
        } catch {}
      }
    }
    return res.status(200).json({ ok: true, log: Array.isArray(pubArr) ? pubArr[0] : pubArr });
  }

  // ── portal_solicitar_doc — equipe solicita documento ao cliente ──────
  if (body.action === 'portal_solicitar_doc') {
    const { projeto_id: pjDoc, titulo: titDoc, categoria: catDoc, prazo_entrega, descricao: descDoc, enviar_email: envEmail2 } = body;
    if (!pjDoc || !titDoc) return res.status(400).json({ erro: 'projeto_id e titulo são obrigatórios.' });
    const SHK7 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const SHW7 = { ...SHK7, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const rProjD = await fetch(`${SB_URL}/rest/v1/projetos_cp?id=eq.${pjDoc}&select=id,nome,cliente_id,responsavel&limit=1`, { headers: SHK7 });
    const projDAr = rProjD.ok ? await rProjD.json() : [];
    if (!projDAr.length) return res.status(404).json({ erro: 'Projeto não encontrado.' });
    const projD = projDAr[0];
    const rDocNew = await fetch(`${SB_URL}/rest/v1/projetos_docs`, {
      method: 'POST', headers: SHW7,
      body: JSON.stringify({ projeto_id: pjDoc, titulo: titDoc, descricao: descDoc || null, categoria: catDoc || 'Geral', prazo_entrega: prazo_entrega || null, status: 'solicitado', criado_em: new Date().toISOString() })
    });
    const docNew = rDocNew.ok ? await rDocNew.json() : [];
    const docId = Array.isArray(docNew) ? docNew[0]?.id : docNew?.id;
    // Email ao cliente
    if (envEmail2 !== false && projD.cliente_id) {
      try {
        const rCli2 = await fetch(`${SB_URL}/rest/v1/clientes?id=eq.${projD.cliente_id}&select=email,contato,portal_token&limit=1`, { headers: SHK7 });
        const cliArr2 = rCli2.ok ? await rCli2.json() : [];
        if (cliArr2.length) {
          const emailC = cliArr2[0].email || cliArr2[0].contato || null;
          const portalU = cliArr2[0].portal_token
            ? `https://sistemacp.vercel.app/portal-cliente.html?t=${cliArr2[0].portal_token}${docId ? '#doc-' + docId : ''}`
            : null;
          if (emailC && portalU) {
            const prazoStr = prazo_entrega ? ` Prazo: ${prazo_entrega.split('-').reverse().join('/')}.` : '';
            await enviarEmail(emailC,
              `📄 Documento solicitado: ${titDoc} — Cavalcante Pinheiro`,
              `Olá!\n\nO escritório solicitou o seguinte documento para o processo "${projD.nome}":\n\n*${titDoc}*${prazoStr}\n${descDoc ? '\n' + descDoc + '\n' : ''}\nVocê pode enviar diretamente pelo portal:\n${portalU}\n\n_Cavalcante Pinheiro Advocacia_`);
          }
        }
      } catch {}
    }
    return res.status(200).json({ ok: true, doc: Array.isArray(docNew) ? docNew[0] : docNew });
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
