// Webhook receptor de eventos do Asaas
// Dispara mensagens WhatsApp via Twilio automaticamente
// Eventos tratados: PAYMENT_CREATED, PAYMENT_OVERDUE, PAYMENT_RECEIVED

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  // Twilio verifica via POST — aceitar apenas POST
  if (req.method !== 'POST') return res.status(405).json({ erro: "Método não permitido" });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { event, payment } = body;

  // Ignorar eventos que não interessam
  const EVENTOS_TRATADOS = ['PAYMENT_CREATED', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED'];
  if (!event || !payment || !EVENTOS_TRATADOS.includes(event)) {
    return res.status(200).json({ ok: true, acao: 'ignorado', evento: event || 'desconhecido' });
  }

  const SB = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK = process.env.SUPABASE_SERVICE_KEY;
  const SH = { 'apikey': SK, 'Authorization': 'Bearer ' + SK };

  // ── 1. Buscar cliente pelo asaas_id ──────────────────────────────
  const rCli = await fetch(
    `${SB}/rest/v1/clientes?asaas_id=eq.${payment.customer}&select=nome,contato`,
    { headers: SH }
  );
  const clientes = rCli.ok ? await rCli.json() : [];
  if (!clientes.length) {
    return res.status(200).json({ ok: true, aviso: 'Cliente não encontrado no Supabase', asaas_customer: payment.customer });
  }

  const cliente = clientes[0];

  // ── 2. Validar e formatar telefone ───────────────────────────────
  const tel = (cliente.contato || '').replace(/\D/g, '');
  if (tel.length < 10) {
    return res.status(200).json({ ok: true, aviso: 'Telefone inválido ou ausente', cliente: cliente.nome });
  }
  // Garante formato E.164 com código Brasil
  const phone = tel.startsWith('55') ? `+${tel}` : `+55${tel}`;

  // ── 3. Montar mensagem conforme evento ───────────────────────────
  const valor = payment.value != null
    ? payment.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '';
  const link  = payment.invoiceUrl || payment.bankSlipUrl || '';
  const venc  = payment.dueDate
    ? new Date(payment.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')
    : '';

  let mensagem = '';

  if (event === 'PAYMENT_CREATED') {
    mensagem =
      `Olá, ${cliente.nome}! 👋\n\n` +
      `Seu boleto de honorários no valor de *${valor}* foi emitido com vencimento em *${venc}*.\n\n` +
      (link ? `Acesse aqui para pagar:\n${link}\n\n` : '') +
      `_Cavalcante Pinheiro Advocacia_\n_(71) 99129-2322_`;

  } else if (event === 'PAYMENT_OVERDUE') {
    mensagem =
      `Olá, ${cliente.nome}. Identificamos que seu boleto no valor de *${valor}* encontra-se em aberto.\n\n` +
      (link ? `Para regularizar, acesse:\n${link}\n\n` : '') +
      `Em caso de dúvidas, estamos à disposição.\n\n` +
      `_Cavalcante Pinheiro Advocacia_\n_(71) 99129-2322_`;

  } else if (event === 'PAYMENT_RECEIVED') {
    mensagem =
      `Olá, ${cliente.nome}! Confirmamos o recebimento do seu pagamento de *${valor}*. 🟢\n\n` +
      `Obrigada pela confiança e pontualidade.\n\n` +
      `_Cavalcante Pinheiro Advocacia_`;
  }

  // ── 4. Enviar via Twilio ─────────────────────────────────────────
  const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM  = process.env.TWILIO_WHATSAPP_FROM; // ex: whatsapp:+14155238886

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return res.status(500).json({ erro: 'Variáveis Twilio não configuradas no ambiente.' });
  }

  const params = new URLSearchParams({
    From: TWILIO_FROM,
    To:   `whatsapp:${phone}`,
    Body: mensagem
  });

  const rTwilio = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method:  'POST',
      headers: {
        'Authorization':  'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
        'Content-Type':   'application/x-www-form-urlencoded'
      },
      body: params.toString()
    }
  );

  if (!rTwilio.ok) {
    const err = await rTwilio.text();
    return res.status(500).json({ erro: 'Erro ao enviar WhatsApp', detalhe: err });
  }

  const twilioResult = await rTwilio.json();
  return res.status(200).json({
    ok:          true,
    evento:      event,
    destinatario: cliente.nome,
    telefone:    phone,
    twilio_sid:  twilioResult.sid
  });
};
