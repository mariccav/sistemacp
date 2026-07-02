// api/db.js — Proxy seguro para o Supabase
// O frontend chama este endpoint em vez de acessar o Supabase diretamente.
// Usa a SUPABASE_SERVICE_KEY (secreta, no servidor) para bypassar o RLS.
// Verifica a sessão do usuário antes de qualquer operação.

const SB_URL = 'https://svwwmxapmppjkmbazhul.supabase.co';

// Tabelas permitidas — whitelist explícita de segurança
const TABELAS_PERMITIDAS = new Set([
  'usuarios', 'clientes', 'leads', 'leads_contatos', 'leads_interacoes',
  'contratos', 'despesas', 'repasses', 'lancamentos_manuais', 'agenda',
  'tarefas_astrea', 'publicacoes', 'sessoes',
  'transacoes', 'transacoes_historico', 'transacoes_prazos',
  'mural', 'elogios', 'redes_posts'
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
    const rI = await fetch(`${SB_URL}/rest/v1/publicacoes`, {
      method: 'POST', headers: SH2,
      body: JSON.stringify({ data_disponibilizacao, data_publicacao, jornal, tribunal,
        vara, numero_processo, conteudo, email_origem, status: 'nao_tratada' })
    });
    const ins = rI.ok ? await rI.json() : null;
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
