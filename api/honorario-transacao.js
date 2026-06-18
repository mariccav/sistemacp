// Gera cobrança de honorários no Asaas para um caso de transação
// Recebe: { nome_cliente, cnpj, valor, vencimento, descricao, conta }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { nome_cliente, cnpj, valor, vencimento, descricao, conta = 'pessoal' } = body;
  if (!nome_cliente || !valor || !vencimento) {
    return res.status(400).json({ erro: 'nome_cliente, valor e vencimento são obrigatórios' });
  }

  const CHAVE = conta === 'escritorio'
    ? process.env.ASAAS_KEY_ESCRITORIO
    : process.env.ASAAS_KEY_PESSOAL;

  if (!CHAVE) return res.status(500).json({ erro: 'Chave Asaas não configurada' });

  const HEADERS = { 'access_token': CHAVE, 'Content-Type': 'application/json' };

  // 1. Buscar cliente pelo nome no Asaas
  let customerId = null;
  const rBusca = await fetch(`https://api.asaas.com/v3/customers?name=${encodeURIComponent(nome_cliente)}&limit=1`, { headers: HEADERS });
  if (rBusca.ok) {
    const dBusca = await rBusca.json();
    if (dBusca.data?.length) customerId = dBusca.data[0].id;
  }

  // 2. Se não encontrou, criar
  if (!customerId) {
    const payload = { name: nome_cliente };
    if (cnpj) payload.cpfCnpj = cnpj.replace(/\D/g, '');
    const rCria = await fetch('https://api.asaas.com/v3/customers', {
      method: 'POST', headers: HEADERS, body: JSON.stringify(payload)
    });
    if (rCria.ok) { const dCria = await rCria.json(); customerId = dCria.id; }
  }

  if (!customerId) return res.status(500).json({ erro: 'Não foi possível identificar ou criar o cliente no Asaas' });

  // 3. Criar cobrança
  const rCob = await fetch('https://api.asaas.com/v3/payments', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      customer:    customerId,
      billingType: 'BOLETO',
      value:       parseFloat(valor),
      dueDate:     vencimento,
      description: descricao || `Honorários — ${nome_cliente}`
    })
  });
  if (!rCob.ok) {
    const err = await rCob.text();
    return res.status(500).json({ erro: 'Erro no Asaas: ' + err });
  }
  const cob = await rCob.json();
  return res.status(200).json({
    id:             cob.id,
    customer_id:    customerId,
    valor:          cob.value,
    vencimento:     cob.dueDate,
    linkPagamento:  cob.invoiceUrl || cob.bankSlipUrl || null
  });
};
