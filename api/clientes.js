module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === 'OPTIONS') {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: "Método não permitido" });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { nome, contato } = body;
  if (!nome) return res.status(400).json({ erro: "Nome é obrigatório." });

  const ASAAS = process.env.ASAAS_KEY_PESSOAL;
  const SB    = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK    = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
  const SH    = { 'apikey':SK, 'Authorization':'Bearer '+SK, 'Content-Type':'application/json', 'Prefer':'return=representation' };

  // 1. Criar no Asaas
  let asaasId = null;
  if (ASAAS) {
    try {
      const tel = (contato||'').replace(/\D/g,'');
      const body = { name: nome };
      if (tel.length >= 10) body.mobilePhone = tel;
      const r = await fetch('https://api.asaas.com/v3/customers', {
        method: 'POST',
        headers: { 'access_token': ASAAS, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.ok) { const d = await r.json(); asaasId = d.id; }
    } catch {}
  }

  // 2. Criar no Supabase
  const r = await fetch(`${SB}/rest/v1/clientes`, {
    method: 'POST', headers: SH,
    body: JSON.stringify({ nome, contato, asaas_id: asaasId })
  });
  if (!r.ok) return res.status(500).json({ erro: 'Erro ao salvar cliente.' });
  const d = await r.json();
  return res.status(200).json(Array.isArray(d) ? d[0] : d);
};
