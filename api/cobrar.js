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
  const { cliente_id, valor, vencimento, descricao } = body;
  if (!cliente_id || !valor || !vencimento) return res.status(400).json({ erro: "cliente_id, valor e vencimento são obrigatórios." });

  const ASAAS = process.env.ASAAS_KEY_PESSOAL;
  const SB    = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK    = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
  const SH    = { 'apikey':SK, 'Authorization':'Bearer '+SK, 'Content-Type':'application/json', 'Prefer':'return=representation' };

  // 1. Buscar cliente no Supabase
  const rCli = await fetch(`${SB}/rest/v1/clientes?id=eq.${cliente_id}&select=*`, { headers: SH });
  if (!rCli.ok) return res.status(500).json({ erro: 'Erro ao buscar cliente.' });
  const clientes = await rCli.json();
  if (!clientes.length) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const cliente = clientes[0];

  let asaasId = cliente.asaas_id;

  // 2. Se não tem asaas_id, cria no Asaas agora
  if (!asaasId && ASAAS) {
    const tel = (cliente.contato||'').replace(/\D/g,'');
    const payload = { name: cliente.nome };
    if (tel.length >= 10) payload.mobilePhone = tel;
    const rA = await fetch('https://api.asaas.com/v3/customers', {
      method: 'POST',
      headers: { 'access_token': ASAAS, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (rA.ok) {
      const dA = await rA.json();
      asaasId = dA.id;
      await fetch(`${SB}/rest/v1/clientes?id=eq.${cliente_id}`, {
        method: 'PATCH', headers: SH,
        body: JSON.stringify({ asaas_id: asaasId })
      });
    }
  }

  if (!asaasId) return res.status(400).json({ erro: 'Não foi possível identificar o cliente no Asaas.' });

  // 3. Criar cobrança
  const rC = await fetch('https://api.asaas.com/v3/payments', {
    method: 'POST',
    headers: { 'access_token': ASAAS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: asaasId,
      billingType: 'BOLETO',
      value: parseFloat(valor),
      dueDate: vencimento,
      description: descricao || `Honorários — ${cliente.nome}`
    })
  });
  if (!rC.ok) {
    const err = await rC.text();
    return res.status(500).json({ erro: `Erro no Asaas: ${err}` });
  }
  const cobranca = await rC.json();
  return res.status(200).json({
    id: cobranca.id,
    cliente: cliente.nome,
    valor: cobranca.value,
    vencimento: cobranca.dueDate,
    linkPagamento: cobranca.invoiceUrl || cobranca.bankSlipUrl || null
  });
};
