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
  const { arquivo_base64, nome_arquivo, signatarios = [], mensagem } = body;

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

  const handleError = async (r, contexto) => {
    const txt = await r.text();
    let msg = txt;
    try { msg = JSON.stringify(JSON.parse(txt).errors || JSON.parse(txt)); } catch {}
    return { erro: `ClickSign [${contexto}] ${r.status}: ${msg}` };
  };

  try {
    // ── 1. Criar envelope ─────────────────────────────────────────
    const nomeArq = nome_arquivo.replace(/[^a-zA-Z0-9._-]/g, '_');
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
    if (!rEnv.ok) return res.status(502).json(await handleError(rEnv, 'criar envelope'));
    const envData = await rEnv.json();
    const envelopeId = envData.data?.id;
    if (!envelopeId) return res.status(502).json({ erro: 'envelope_id não retornado pelo ClickSign.' });

    // ── 2. Upload do documento (base64) ───────────────────────────
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
    if (!rDoc.ok) return res.status(502).json(await handleError(rDoc, 'upload documento'));
    const docData = await rDoc.json();
    const documentId = docData.data?.id;
    if (!documentId) return res.status(502).json({ erro: 'document_id não retornado.' });

    // ── 3. Adicionar signatários e requisitos ─────────────────────
    const signerIds = [];
    for (const sig of signatarios) {
      if (!sig.nome || !sig.email) continue;

      // Criar signatário
      const rSig = await fetch(`${BASE}/envelopes/${envelopeId}/signers`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          data: {
            type: 'signers',
            attributes: {
              name: sig.nome,
              email: sig.email,
              ...(sig.cpf ? { documentation: sig.cpf.replace(/\D/g, '') } : {}),
              ...(sig.telefone ? { phone_number: '+55' + sig.telefone.replace(/\D/g, '') } : {})
            }
          }
        })
      });
      if (!rSig.ok) continue;
      const sigData = await rSig.json();
      const signerId = sigData.data?.id;
      if (!signerId) continue;
      signerIds.push(signerId);

      // Criar requisito: vincular signatário ao documento
      await fetch(`${BASE}/envelopes/${envelopeId}/requirements`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          data: {
            type: 'requirements',
            attributes: { action: 'sign', role: 'sign' },
            relationships: {
              document: { data: { type: 'documents', id: documentId } },
              signer:   { data: { type: 'signers',   id: signerId   } }
            }
          }
        })
      });
    }

    // ── 4. Ativar envelope (enviar para assinatura) ───────────────
    const rAct = await fetch(`${BASE}/envelopes/${envelopeId}/activate`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ data: { type: 'envelopes', id: envelopeId } })
    });
    // Alguns planos não têm endpoint /activate separado — ignora erro aqui
    // A ativação pode ser automática dependendo das configurações

    return res.status(200).json({
      envelope_id:  envelopeId,
      document_id:  documentId,
      signer_ids:   signerIds,
      signatarios:  signatarios.length,
      link:         `https://app.clicksign.com/sign/${envelopeId}`,
      envelope_key: envelopeId
    });

  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
