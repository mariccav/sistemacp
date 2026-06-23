// Integração ClickSign API v3
// Documentação: https://developers.clicksign.com/reference/comece-agora

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
  const { arquivo_base64, nome_arquivo, signatarios = [] } = body;

  if (!arquivo_base64 || !nome_arquivo) {
    return res.status(400).json({ erro: 'arquivo_base64 e nome_arquivo são obrigatórios.' });
  }
  if (!signatarios.length) {
    return res.status(400).json({ erro: 'Informe ao menos um signatário.' });
  }

  // API v3 — headers obrigatórios: JSON:API + Authorization sem Bearer
  const BASE = 'https://app.clicksign.com/api/v3';
  const HEADERS = {
    'Authorization': TOKEN,
    'Content-Type': 'application/vnd.api+json',
    'Accept': 'application/vnd.api+json'
  };

  const lerErro = async (r, contexto) => {
    const txt = await r.text();
    let msg = txt;
    try {
      const parsed = JSON.parse(txt);
      msg = parsed.errors?.[0]?.detail || parsed.errors?.[0]?.title || JSON.stringify(parsed);
    } catch {}
    return `ClickSign [${contexto}] ${r.status}: ${msg}`;
  };

  try {
    // ── 1. Criar envelope ─────────────────────────────────────────
    // Preserva acentos/cedilha no nome do envelope; remove apenas caracteres inválidos para filename
    const nomeArq = nome_arquivo.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const rEnv = await fetch(`${BASE}/envelopes`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        data: {
          type: 'envelopes',
          attributes: {
            name: nomeArq.replace(/\.[^.]+$/, ''),
            locale: 'pt-BR',
            auto_close: true,
            remind_interval: 3,
            block_after_refusal: true
          }
        }
      })
    });
    if (!rEnv.ok) return res.status(502).json({ erro: await lerErro(rEnv, 'criar envelope') });
    const envelopeId = (await rEnv.json()).data?.id;
    if (!envelopeId) return res.status(502).json({ erro: 'envelope_id não retornado pelo ClickSign.' });

    // ── 2. Upload do documento ────────────────────────────────────
    const contentBase64 = arquivo_base64.startsWith('data:')
      ? arquivo_base64.split(',')[1]
      : arquivo_base64;

    const rDoc = await fetch(`${BASE}/envelopes/${envelopeId}/documents`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        data: {
          type: 'documents',
          attributes: {
            filename: nomeArq.endsWith('.pdf') ? nomeArq : nomeArq + '.pdf',
            content_base64: `data:application/pdf;base64,${contentBase64}`
          }
        }
      })
    });
    if (!rDoc.ok) return res.status(502).json({ erro: await lerErro(rDoc, 'upload documento') });
    const documentId = (await rDoc.json()).data?.id;
    if (!documentId) return res.status(502).json({ erro: 'document_id não retornado.' });

    // ── 3. Adicionar signatários e requisitos ─────────────────────
    const signerIds = [];
    for (const sig of signatarios) {
      if (!sig.nome || !sig.email) continue;

      // Criar signatário
      // NOTA: não enviamos documentação (CPF/CNPJ) porque o ClickSign v3
      // valida o checksum e rejeita com erro silencioso se inválido.
      // O campo is opcional e não afeta a validade jurídica da assinatura.
      const rSig = await fetch(`${BASE}/envelopes/${envelopeId}/signers`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          data: {
            type: 'signers',
            attributes: {
              name: sig.nome,
              email: sig.email
            }
          }
        })
      });

      if (!rSig.ok) {
        const erroSig = await lerErro(rSig, `criar signatário ${sig.email}`);
        return res.status(502).json({ erro: erroSig });
      }

      const signerId = (await rSig.json()).data?.id;
      if (!signerId) return res.status(502).json({ erro: `signerId não retornado para ${sig.email}` });
      signerIds.push(signerId);

      // Requisito 1: concordância (agree/contractee)
      const rReq1 = await fetch(`${BASE}/envelopes/${envelopeId}/requirements`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          data: {
            type: 'requirements',
            attributes: { action: 'agree', role: 'contractee' },
            relationships: {
              document: { data: { type: 'documents', id: documentId } },
              signer:   { data: { type: 'signers',   id: signerId   } }
            }
          }
        })
      });
      if (!rReq1.ok) return res.status(502).json({ erro: await lerErro(rReq1, 'requisito agree') });

      // Requisito 2: assinatura digital por selfie + documento de identidade
      const rReq2 = await fetch(`${BASE}/envelopes/${envelopeId}/requirements`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          data: {
            type: 'requirements',
            attributes: { action: 'provide_evidence', auth: 'selfie' },
            relationships: {
              document: { data: { type: 'documents', id: documentId } },
              signer:   { data: { type: 'signers',   id: signerId   } }
            }
          }
        })
      });
      if (!rReq2.ok) return res.status(502).json({ erro: await lerErro(rReq2, 'requisito selfie') });
    }

    if (signerIds.length === 0) {
      return res.status(502).json({ erro: 'Nenhum signatário foi criado no ClickSign. Verifique nome e e-mail.' });
    }

    // ── 4. Ativar envelope ────────────────────────────────────────
    const rAct = await fetch(`${BASE}/envelopes/${envelopeId}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({
        data: { type: 'envelopes', id: envelopeId, attributes: { status: 'running' } }
      })
    });

    if (!rAct.ok) {
      const erroAct = await lerErro(rAct, 'ativar envelope');
      return res.status(502).json({ erro: erroAct });
    }

    // ── 5. Disparar notificação por e-mail ────────────────────────
    // O ClickSign v3 não envia e-mail automaticamente na ativação via API.
    // É necessário chamar /notifications com attributes:{} para disparar.
    // Rate limit: 1 por minuto — em produção cada envelope notifica uma vez.
    await fetch(`${BASE}/envelopes/${envelopeId}/notifications`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ data: { type: 'notifications', attributes: {} } })
    });
    // Ignora erro de notificação (rate limit ou falha não deve bloquear a resposta)

    // Link de assinatura: o formato correto usa signer_id (não envelope_id)
    const primeiroSignerId = signerIds[0];

    return res.status(200).json({
      envelope_id:  envelopeId,
      document_id:  documentId,
      signer_ids:   signerIds,
      signatarios:  signerIds.length,
      link:         `https://app.clicksign.com/sign/${primeiroSignerId}`,
      envelope_key: envelopeId
    });

  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
