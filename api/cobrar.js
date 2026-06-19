// Gera cobrança no Asaas — aceita cliente_id (Supabase) OU nome_cliente/cnpj direto
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
  const { cliente_id, nome_cliente, cnpj, valor, vencimento, descricao, conta = 'pessoal' } = body;

  if (!valor || !vencimento) return res.status(400).json({ erro: "valor e vencimento são obrigatórios." });
  if (!cliente_id && !nome_cliente) return res.status(400).json({ erro: "Informe cliente_id ou nome_cliente." });

  const ASAAS = conta === 'escritorio'
    ? process.env.ASAAS_KEY_ESCRITORIO
    : process.env.ASAAS_KEY_PESSOAL;

  const SB = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
  const SH = { 'apikey':SK, 'Authorization':'Bearer '+SK, 'Content-Type':'application/json', 'Prefer':'return=representation' };
  const HEADERS_ASAAS = { 'access_token': ASAAS, 'Content-Type': 'application/json' };

  let asaasId = null;
  let nomeCliente = nome_cliente;

  // ── Modo 1: via cliente_id do Supabase ──────────────────────────
  if (cliente_id) {
    const rCli = await fetch(`${SB}/rest/v1/clientes?id=eq.${cliente_id}&select=*`, { headers: SH });
    if (!rCli.ok) return res.status(500).json({ erro: 'Erro ao buscar cliente.' });
    const clientes = await rCli.json();
    if (!clientes.length) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    const cliente = clientes[0];
    nomeCliente = cliente.nome;
    asaasId = cliente.asaas_id;

    if (!asaasId && ASAAS) {
      const tel = (cliente.contato||'').replace(/\D/g,'');
      const doc = (cliente.cpf_cnpj||'').replace(/\D/g,'');
      const payload = { name: cliente.nome };
      if (tel.length >= 10) payload.mobilePhone = tel;
      if (doc) payload.cpfCnpj = doc;
      const rA = await fetch('https://api.asaas.com/v3/customers', { method:'POST', headers:HEADERS_ASAAS, body:JSON.stringify(payload) });
      if (rA.ok) {
        const dA = await rA.json(); asaasId = dA.id;
        await fetch(`${SB}/rest/v1/clientes?id=eq.${cliente_id}`, { method:'PATCH', headers:SH, body:JSON.stringify({ asaas_id:asaasId }) });
      }
    }
  }

  // ── Modo 2: via nome/CNPJ direto (sem cliente cadastrado) ────────
  if (!asaasId && nome_cliente && ASAAS) {
    // Buscar no Asaas por nome
    const rBusca = await fetch(`https://api.asaas.com/v3/customers?name=${encodeURIComponent(nome_cliente)}&limit=1`, { headers: HEADERS_ASAAS });
    if (rBusca.ok) {
      const dB = await rBusca.json();
      if (dB.data?.length) asaasId = dB.data[0].id;
    }
    // Criar se não encontrou
    if (!asaasId) {
      const doc = (cnpj||'').replace(/\D/g,'');
      const payload = { name: nome_cliente };
      if (doc) payload.cpfCnpj = doc;
      const rC = await fetch('https://api.asaas.com/v3/customers', { method:'POST', headers:HEADERS_ASAAS, body:JSON.stringify(payload) });
      if (rC.ok) { const dC = await rC.json(); asaasId = dC.id; }
    }
  }

  if (!asaasId) return res.status(400).json({ erro: 'Não foi possível identificar o cliente no Asaas.' });

  // ── Criar cobrança ────────────────────────────────────────────────
  const rC = await fetch('https://api.asaas.com/v3/payments', {
    method: 'POST', headers: HEADERS_ASAAS,
    body: JSON.stringify({
      customer: asaasId, billingType: 'BOLETO',
      value: parseFloat(valor), dueDate: vencimento,
      description: descricao || `Honorários — ${nomeCliente}`
    })
  });
  if (!rC.ok) { const err = await rC.text(); return res.status(500).json({ erro: `Erro no Asaas: ${err}` }); }
  const cobranca = await rC.json();
  return res.status(200).json({
    id: cobranca.id, cliente: nomeCliente,
    valor: cobranca.value, vencimento: cobranca.dueDate,
    linkPagamento: cobranca.invoiceUrl || cobranca.bankSlipUrl || null
  });
};
