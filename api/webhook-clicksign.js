// Webhook ClickSign — recebe notificações de assinatura e atualiza Supabase
// Configurar em: app.clicksign.com → Configurações → Webhooks → URL: sistemacp.vercel.app/api/webhook-clicksign

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const evento = body.event?.name;
  const envelope = body.event?.data?.envelope;

  if (!envelope?.key) return res.status(200).json({ ok: true, aviso: 'Sem envelope_key' });

  const SB  = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK  = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
  const SH  = { 'apikey': SK, 'Authorization': 'Bearer ' + SK, 'Content-Type': 'application/json' };

  const envelopeKey = envelope.key;

  // Mapear evento para status legível
  const STATUS_MAP = {
    'sign':        'parcialmente_assinado',
    'auto_close':  'assinado',
    'close':       'assinado',
    'cancel':      'cancelado',
    'refusal':     'recusado',
    'deadline':    'prazo_expirado'
  };
  const novoStatus = STATUS_MAP[evento] || evento;

  // Registrar no histórico de transações (se for de uma transação)
  const rTrans = await fetch(
    `${SB}/rest/v1/transacoes?clicksign_envelope_key=eq.${envelopeKey}&select=id,cliente_nome`,
    { headers: SH }
  );
  if (rTrans.ok) {
    const transacoes = await rTrans.json();
    for (const t of transacoes) {
      await fetch(`${SB}/rest/v1/transacoes_historico`, {
        method: 'POST', headers: SH,
        body: JSON.stringify({
          transacao_id: t.id,
          tipo:         'contrato',
          descricao:    `ClickSign: ${novoStatus} — envelope ${envelopeKey}`,
          criado_por:   'Sistema'
        })
      });
    }
  }

  // Atualizar status dos contratos vinculados ao envelope
  const rCt = await fetch(
    `${SB}/rest/v1/contratos?clicksign_envelope_key=eq.${envelopeKey}`,
    { headers: SH }
  );
  if (rCt.ok) {
    const contratos = await rCt.json();
    for (const ct of contratos) {
      const sbStatus = novoStatus === 'assinado' ? 'assinado'
                     : novoStatus === 'cancelado' || novoStatus === 'recusado' ? 'cancelado'
                     : 'aguardando';
      await fetch(`${SB}/rest/v1/contratos?id=eq.${ct.id}`, {
        method: 'PATCH', headers: SH,
        body: JSON.stringify({ status: sbStatus })
      });
    }
  }

  return res.status(200).json({ ok: true, evento, envelopeKey, status: novoStatus });
};
