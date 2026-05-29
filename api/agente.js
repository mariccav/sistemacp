module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method === 'OPTIONS') {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ erro: "JSON inválido" });
  }

  const { mensagem, historico = [] } = body;
  if (!mensagem) return res.status(400).json({ erro: "Informe a mensagem." });

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) return res.status(500).json({ erro: "CLAUDE_API_KEY não configurada." });

  const SB_URL = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SB_KEY = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';

  const tools = [
    {
      name: "buscar_honorarios",
      description: "Busca honorários recebidos (conta pessoal e escritório) para um mês/ano via Asaas.",
      input_schema: {
        type: "object",
        properties: {
          mes: { type: "number", description: "Mês (1-12)" },
          ano: { type: "number", description: "Ano (ex: 2026)" }
        },
        required: ["mes", "ano"]
      }
    },
    {
      name: "buscar_repasses",
      description: "Busca repasses a parceiros registrados para um mês/ano.",
      input_schema: {
        type: "object",
        properties: {
          mes: { type: "number", description: "Mês (1-12)" },
          ano: { type: "number", description: "Ano (ex: 2026)" }
        },
        required: ["mes", "ano"]
      }
    },
    {
      name: "buscar_despesas",
      description: "Busca despesas do escritório registradas para um mês/ano.",
      input_schema: {
        type: "object",
        properties: {
          mes: { type: "number", description: "Mês (1-12)" },
          ano: { type: "number", description: "Ano (ex: 2026)" }
        },
        required: ["mes", "ano"]
      }
    }
  ];

  const systemPrompt = `Você é o agente financeiro da Cavalcante Pinheiro Advocacia, escritório de Direito Tributário fundado por Mariana Pinheiro (OAB/BA nº 49.675), em Salvador/BA.

Sua função: responder perguntas sobre a situação financeira do escritório com precisão e clareza.

Você tem acesso a dados em tempo real:
- Honorários recebidos (Asaas — conta pessoal e conta do escritório)
- Repasses a parceiros (lançados manualmente no sistema)
- Despesas do escritório (lançadas manualmente no sistema)
- Resultado líquido = honorários - repasses - despesas

Regras:
- Sempre responda em português
- Formate valores como R$ X.XXX,XX
- Use **negrito** para destacar totais e valores importantes
- Se o mês não for especificado, pergunte qual mês antes de consultar
- Consulte os dados com as ferramentas ANTES de responder qualquer pergunta numérica
- Seja direta e concisa — Mariana é a advogada dona do escritório, não precisa de explicações longas
- O mês atual é maio de 2026`;

  const mensagens = [
    ...historico.slice(-10),
    { role: "user", content: mensagem }
  ];

  try {
    let resposta = await chamarClaude(CLAUDE_KEY, systemPrompt, mensagens, tools);
    let iteracoes = 0;

    while (resposta.stop_reason === 'tool_use' && iteracoes < 4) {
      iteracoes++;
      const toolUses = resposta.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const tu of toolUses) {
        const resultado = await executarFerramenta(tu.name, tu.input, SB_URL, SB_KEY);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(resultado)
        });
      }

      mensagens.push({ role: "assistant", content: resposta.content });
      mensagens.push({ role: "user", content: toolResults });
      resposta = await chamarClaude(CLAUDE_KEY, systemPrompt, mensagens, tools);
    }

    const texto = resposta.content.find(b => b.type === 'text')?.text
      || "Não consegui processar sua solicitação. Tente novamente.";

    return res.status(200).json({ resposta: texto });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
};

// ─── Chamada à API Claude ────────────────────────────────────────────────────

async function chamarClaude(apiKey, system, messages, tools) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system,
      messages,
      tools
    })
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Claude API ${r.status}: ${t}`);
  }
  return r.json();
}

// ─── Execução das ferramentas ────────────────────────────────────────────────

async function executarFerramenta(nome, input, SB_URL, SB_KEY) {
  const { mes, ano } = input;

  if (nome === 'buscar_honorarios') {
    const m = String(mes).padStart(2, '0');
    const a = String(ano);
    const dataInicio = `${a}-${m}-01`;
    const ultimoDia = new Date(Number(a), Number(mes), 0).getDate();
    const dataFim = `${a}-${m}-${String(ultimoDia).padStart(2, '0')}`;
    const params = new URLSearchParams({
      status: 'RECEIVED',
      'paymentDate[ge]': dataInicio,
      'paymentDate[le]': dataFim,
      limit: '100'
    });
    const [pessoal, escritorio] = await Promise.all([
      buscarAsaas(process.env.ASAAS_KEY_PESSOAL, params),
      buscarAsaas(process.env.ASAAS_KEY_ESCRITORIO, params)
    ]);
    return {
      mes, ano,
      pessoal: { total: pessoal.total, quantidade: pessoal.quantidade, pagamentos: pessoal.pagamentos },
      escritorio: { total: escritorio.total, quantidade: escritorio.quantidade, pagamentos: escritorio.pagamentos },
      totalHonorarios: Math.round((pessoal.total + escritorio.total) * 100) / 100
    };
  }

  const SB_HEAD = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };

  if (nome === 'buscar_repasses') {
    const r = await fetch(
      `${SB_URL}/rest/v1/repasses?mes=eq.${mes}&ano=eq.${ano}&order=criado_em.asc`,
      { headers: SB_HEAD }
    );
    const data = r.ok ? await r.json() : [];
    const total = data.reduce((s, i) => s + (i.valor || 0), 0);
    return { mes, ano, total: Math.round(total * 100) / 100, quantidade: data.length, itens: data };
  }

  if (nome === 'buscar_despesas') {
    const r = await fetch(
      `${SB_URL}/rest/v1/despesas?mes=eq.${mes}&ano=eq.${ano}&order=criado_em.asc`,
      { headers: SB_HEAD }
    );
    const data = r.ok ? await r.json() : [];
    const total = data.reduce((s, i) => s + (i.valor || 0), 0);
    return { mes, ano, total: Math.round(total * 100) / 100, quantidade: data.length, itens: data };
  }

  return { erro: 'Ferramenta desconhecida' };
}

async function buscarAsaas(chave, params) {
  if (!chave) return { total: 0, quantidade: 0, pagamentos: [] };
  try {
    const r = await fetch(`https://api.asaas.com/v3/payments?${params}`, {
      headers: { 'access_token': chave, 'Content-Type': 'application/json' }
    });
    if (!r.ok) return { total: 0, quantidade: 0, pagamentos: [] };
    const data = await r.json();
    const pags = data.data || [];
    const total = pags.reduce((s, p) => s + (p.value || 0), 0);
    return {
      total: Math.round(total * 100) / 100,
      quantidade: pags.length,
      pagamentos: pags.map(p => ({
        cliente: p.customerName || p.description || 'Cliente',
        valor: p.value,
        data: p.paymentDate
      }))
    };
  } catch {
    return { total: 0, quantidade: 0, pagamentos: [] };
  }
}
