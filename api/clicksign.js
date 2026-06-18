// Integração ClickSign — cria envelope, sobe documento, adiciona signatários e ativa
// Recebe: { arquivo_base64, nome_arquivo, signatarios: [{nome, email, cpf, telefone}], mensagem }
// Retorna: { envelope_key, link }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const TOKEN = process.env.CLICKSIGN_TOKEN;
  if (!TOKEN) return res.status(500).json({ erro: 'CLICKSIGN_TOKEN não configurado no Vercel.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { arquivo_base64, nome_arquivo, signatarios = [], mensagem } = body;

  if (!arquivo_base64 || !nome_arquivo) {
    return res.status(400).json({ erro: 'arquivo_base64 e nome_arquivo são obrigatórios.' });
  }
  if (!signatarios.length) {
    return res.status(400).json({ erro: 'Informe ao menos um signatário.' });
  }

  const BASE = 'https://app.clicksign.com/api/v1';
  const qs = `access_token=${TOKEN}`;

  try {
    // ── 1. Criar envelope ──────────────────────────────────────────
    const rEnv = await fetch(`${BASE}/envelopes?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envelope: {
          locale: 'pt-BR',
          auto_close: true,
          remind_interval: 3,
          block_after_refusal: true
        }
      })
    });
    if (!rEnv.ok) {
      const t = await rEnv.text();
      return res.status(502).json({ erro: `ClickSign: erro ao criar envelope. ${t}` });
    }
    const envData = await rEnv.json();
    const envelopeKey = envData.envelope?.key;
    if (!envelopeKey) return res.status(502).json({ erro: 'ClickSign: envelope_key não retornado.' });

    // ── 2. Upload do documento ─────────────────────────────────────
    const contentBase64 = arquivo_base64.startsWith('data:')
      ? arquivo_base64
      : `data:application/pdf;base64,${arquivo_base64}`;

    const nomeArq = nome_arquivo.endsWith('.pdf') ? nome_arquivo : nome_arquivo + '.pdf';

    const rDoc = await fetch(`${BASE}/envelopes/${envelopeKey}/documents?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: {
          path: `/${nomeArq}`,
          content_base64: contentBase64,
          sequence_enabled: false
        }
      })
    });
    if (!rDoc.ok) {
      const t = await rDoc.text();
      return res.status(502).json({ erro: `ClickSign: erro ao enviar documento. ${t}` });
    }
    const docData = await rDoc.json();
    const documentKey = docData.document?.key;

    // ── 3. Adicionar signatários e vincular ao documento ───────────
    for (const sig of signatarios) {
      if (!sig.nome || !sig.email) continue;

      const rSig = await fetch(`${BASE}/envelopes/${envelopeKey}/signers?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer: {
            name:               sig.nome,
            email:              sig.email,
            has_documentation:  !!sig.cpf,
            documentation:      sig.cpf ? sig.cpf.replace(/\D/g, '') : null,
            phone_number:       sig.telefone ? sig.telefone.replace(/\D/g, '') : null,
            delivery:           'email',
            message:            mensagem || 'Por favor, assine o documento do escritório Cavalcante Pinheiro Advocacia.'
          }
        })
      });
      if (!rSig.ok) continue;
      const sigData = await rSig.json();
      const signerKey = sigData.signer?.key;

      // Vincular signatário ao documento
      if (signerKey && documentKey) {
        await fetch(`${BASE}/envelopes/${envelopeKey}/requirements?${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requirement: {
              action:       'sign',
              signer_key:   signerKey,
              document_key: documentKey,
              auth:         'email'
            }
          })
        });
      }
    }

    // ── 4. Ativar envelope (envia e-mails aos signatários) ─────────
    await fetch(`${BASE}/envelopes/${envelopeKey}/close?${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });

    return res.status(200).json({
      envelope_key: envelopeKey,
      link: `https://app.clicksign.com/sign/${envelopeKey}`,
      documento: nomeArq,
      signatarios: signatarios.length
    });

  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
