// Webhook ClickSign — atualiza status no Supabase e gera cobrança no Asaas quando assinado
// Configurar em: app.clicksign.com → Configurações → Webhooks → URL: sistemacp.vercel.app/api/webhook-clicksign

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const evento    = body.event?.name;
  const envelope  = body.event?.data?.envelope;
  if (!envelope?.key) return res.status(200).json({ ok: true, aviso: 'Sem envelope_key' });

  const SB  = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK  = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
  const SH  = { 'apikey': SK, 'Authorization': 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
  const SHR = { 'apikey': SK, 'Authorization': 'Bearer ' + SK };

  const STATUS_MAP = {
    'sign':       'parcialmente_assinado',
    'auto_close': 'assinado',
    'close':      'assinado',
    'cancel':     'cancelado',
    'refusal':    'recusado',
    'deadline':   'prazo_expirado'
  };
  const novoStatus = STATUS_MAP[evento] || evento;
  const envelopeKey = envelope.key;
  const assinado = novoStatus === 'assinado';

  // ── 1. Atualizar contratos vinculados ao envelope ─────────────────
  const rCt = await fetch(
    `${SB}/rest/v1/contratos?clicksign_envelope_key=eq.${envelopeKey}&select=*`,
    { headers: SHR }
  );
  const contratos = rCt.ok ? await rCt.json() : [];

  for (const ct of contratos) {
    const sbStatus = assinado ? 'assinado' : (novoStatus === 'cancelado' || novoStatus === 'recusado') ? 'cancelado' : 'aguardando';
    await fetch(`${SB}/rest/v1/contratos?id=eq.${ct.id}`, {
      method: 'PATCH', headers: SH, body: JSON.stringify({ status: sbStatus })
    });

    // ── 2. Gerar cobrança no Asaas quando assinado ──────────────────
    if (assinado && ct.valor) {
      const ASAAS = process.env.ASAAS_KEY_PESSOAL;
      if (ASAAS) {
        let asaasId = null;

        // Buscar asaas_id do cliente
        if (ct.cliente_id) {
          const rCli = await fetch(`${SB}/rest/v1/clientes?id=eq.${ct.cliente_id}&select=nome,asaas_id,cpf_cnpj,contato`, { headers: SHR });
          if (rCli.ok) {
            const clis = await rCli.json();
            if (clis.length) {
              asaasId = clis[0].asaas_id;
              // Se não tem asaas_id, criar no Asaas agora
              if (!asaasId) {
                const c = clis[0];
                const doc = (c.cpf_cnpj || '').replace(/\D/g,'');
                const tel = (c.contato || '').replace(/\D/g,'');
                const payload = { name: c.nome };
                if (doc) payload.cpfCnpj = doc;
                if (tel.length >= 10) payload.mobilePhone = tel;
                const rA = await fetch('https://api.asaas.com/v3/customers', {
                  method: 'POST',
                  headers: { 'access_token': ASAAS, 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
                if (rA.ok) {
                  const dA = await rA.json();
                  asaasId = dA.id;
                  await fetch(`${SB}/rest/v1/clientes?id=eq.${ct.cliente_id}`, {
                    method: 'PATCH', headers: SH, body: JSON.stringify({ asaas_id: asaasId })
                  });
                }
              }
            }
          }
        }

        // Criar cobrança
        if (asaasId) {
          const venc = new Date();
          venc.setDate(venc.getDate() + 5); // 5 dias após assinatura
          const vencStr = venc.toISOString().split('T')[0];
          await fetch('https://api.asaas.com/v3/payments', {
            method: 'POST',
            headers: { 'access_token': ASAAS, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer:    asaasId,
              billingType: 'BOLETO',
              value:       parseFloat(ct.valor),
              dueDate:     vencStr,
              description: `Honorários — ${ct.cliente_nome} · Contrato assinado via ClickSign`
            })
          });
        }
      }
    }
  }

  // ── 3. Atualizar transações vinculadas ───────────────────────────
  const rTrans = await fetch(
    `${SB}/rest/v1/transacoes?clicksign_envelope_key=eq.${envelopeKey}&select=id,cliente_nome`,
    { headers: SHR }
  );
  const transacoes = rTrans.ok ? await rTrans.json() : [];

  for (const t of transacoes) {
    // Avançar etapa quando contrato assinado
    if (assinado) {
      await fetch(`${SB}/rest/v1/transacoes?id=eq.${t.id}`, {
        method: 'PATCH', headers: SH, body: JSON.stringify({ etapa: 'adesao' })
      });
    }
    await fetch(`${SB}/rest/v1/transacoes_historico`, {
      method: 'POST', headers: SH,
      body: JSON.stringify({
        transacao_id: t.id,
        tipo:         'contrato',
        descricao:    `ClickSign: ${novoStatus} — envelope ${envelopeKey}${assinado ? ' · Cobrança gerada no Asaas' : ''}`,
        criado_por:   'Sistema'
      })
    });
  }

  return res.status(200).json({ ok: true, evento, envelopeKey, status: novoStatus, contratos: contratos.length, transacoes: transacoes.length });
};
