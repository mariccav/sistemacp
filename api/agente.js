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

  // ─── Ferramentas disponíveis ─────────────────────────────────────────────────

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
    },
    {
      name: "buscar_clientes",
      description: "Busca clientes cadastrados no Asaas pelo nome. Use sempre antes de criar uma cobrança para obter o ID do cliente.",
      input_schema: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome ou parte do nome do cliente" },
          conta: {
            type: "string",
            enum: ["pessoal", "escritorio"],
            description: "Conta Asaas onde buscar. Padrão: pessoal"
          }
        },
        required: ["nome"]
      }
    },
    {
      name: "criar_cobranca",
      description: "Cria uma cobrança (boleto ou PIX) no Asaas. ATENÇÃO: só execute após confirmação explícita de Mariana.",
      input_schema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "ID do cliente no Asaas (obtido via buscar_clientes)" },
          valor: { type: "number", description: "Valor em reais" },
          vencimento: { type: "string", description: "Data de vencimento no formato YYYY-MM-DD" },
          descricao: { type: "string", description: "Descrição da cobrança (ex: Honorários advocatícios — Contrato X)" },
          tipo: {
            type: "string",
            enum: ["BOLETO", "PIX", "UNDEFINED"],
            description: "Tipo de cobrança. BOLETO padrão. PIX se solicitado. UNDEFINED deixa Asaas decidir."
          },
          conta: {
            type: "string",
            enum: ["pessoal", "escritorio"],
            description: "Conta Asaas. Padrão: pessoal"
          }
        },
        required: ["customer_id", "valor", "vencimento", "descricao"]
      }
    },
    {
      name: "listar_cobrancas_pendentes",
      description: "Lista cobranças pendentes ou vencidas no Asaas. Use para verificar inadimplência.",
      input_schema: {
        type: "object",
        properties: {
          conta: {
            type: "string",
            enum: ["pessoal", "escritorio", "ambas"],
            description: "Conta Asaas onde buscar"
          },
          status: {
            type: "string",
            enum: ["PENDING", "OVERDUE", "ALL"],
            description: "PENDING=pendentes ainda no prazo, OVERDUE=vencidas, ALL=ambas"
          }
        },
        required: ["conta", "status"]
      }
    },
    {
      name: "cancelar_cobranca",
      description: "Cancela/remove uma cobrança no Asaas. ATENÇÃO: só execute após confirmação explícita de Mariana.",
      input_schema: {
        type: "object",
        properties: {
          payment_id: { type: "string", description: "ID do pagamento no Asaas (ex: pay_xxxxx)" },
          conta: {
            type: "string",
            enum: ["pessoal", "escritorio"],
            description: "Conta Asaas onde está a cobrança"
          }
        },
        required: ["payment_id", "conta"]
      }
    },
    {
      name: "registrar_repasse",
      description: "Registra um repasse a parceiro no sistema financeiro. Pode executar diretamente sem confirmação.",
      input_schema: {
        type: "object",
        properties: {
          parceiro: { type: "string", description: "Nome do parceiro" },
          valor: { type: "number", description: "Valor em reais" },
          mes: { type: "number", description: "Mês de referência (1-12)" },
          ano: { type: "number", description: "Ano de referência (ex: 2026)" },
          data_pagamento: { type: "string", description: "Data no formato DD/MM (opcional)" },
          conta: { type: "string", description: "Conta de saída (opcional, ex: Asaas Pessoal, Itaú)" }
        },
        required: ["parceiro", "valor", "mes", "ano"]
      }
    },
    {
      name: "registrar_despesa",
      description: "Registra uma despesa do escritório no sistema financeiro. Pode executar diretamente sem confirmação.",
      input_schema: {
        type: "object",
        properties: {
          categoria: {
            type: "string",
            enum: ["Pessoal e Prestadores", "Contas e Utilidades", "Impostos", "Tecnologia e Software", "Marketing", "Outros"],
            description: "Categoria da despesa"
          },
          descricao: { type: "string", description: "Descrição da despesa (ex: Aurum Softmatic)" },
          valor: { type: "number", description: "Valor em reais" },
          mes: { type: "number", description: "Mês de referência (1-12)" },
          ano: { type: "number", description: "Ano de referência (ex: 2026)" },
          data_pagamento: { type: "string", description: "Data no formato DD/MM (opcional)" }
        },
        required: ["categoria", "descricao", "valor", "mes", "ano"]
      }
    },
    {
      name: "excluir_item",
      description: "Exclui um repasse ou despesa do sistema. ATENÇÃO: só execute após confirmação explícita de Mariana.",
      input_schema: {
        type: "object",
        properties: {
          tabela: {
            type: "string",
            enum: ["repasses", "despesas"],
            description: "Qual tabela"
          },
          id: { type: "string", description: "UUID do item a excluir" }
        },
        required: ["tabela", "id"]
      }
    }
  ];

  // ─── System prompt ───────────────────────────────────────────────────────────

  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  const systemPrompt = `Você é o agente financeiro OPERACIONAL da Cavalcante Pinheiro Advocacia, escritório de Direito Tributário fundado por Mariana Pinheiro (OAB/BA nº 49.675), em Salvador/BA.

Você não apenas responde perguntas — você EXECUTA ações no sistema financeiro do escritório.

DATA ATUAL: ${String(mesAtual).padStart(2,'0')}/${anoAtual}. Quando Mariana disser "este mês" ou "agora", use mes=${mesAtual}, ano=${anoAtual}.

CONTA PADRÃO: use sempre a conta PESSOAL do Asaas para criar cobranças e buscar clientes, a menos que Mariana diga explicitamente "escritório" ou "conta empresa".

CAPACIDADES:
- Consultar honorários, repasses e despesas por mês
- Buscar clientes cadastrados no Asaas
- Criar cobranças (boleto/PIX) para clientes
- Listar cobranças pendentes e vencidas
- Cancelar cobranças
- Registrar repasses a parceiros
- Registrar despesas do escritório
- Excluir repasses e despesas

REGRAS DE EXECUÇÃO:

1. AÇÕES QUE EXIGEM CONFIRMAÇÃO (têm efeito real e podem ser difíceis de reverter):
   - Criar cobrança no Asaas → antes de executar, diga exatamente o que vai fazer e aguarde Mariana confirmar com "sim", "pode criar", "confirma" ou similar
   - Cancelar cobrança → mesma regra
   - Excluir repasse ou despesa → mesma regra
   Exemplo de confirmação: "Vou criar um boleto de **R$ 5.000,00** para **Lima Diniz Construções**, vencimento **10/06/2026**, descrição: Honorários advocatícios. Confirma?"

2. AÇÕES DIRETAS (sem necessidade de confirmação):
   - Registrar repasse
   - Registrar despesa
   - Consultar qualquer dado

3. FLUXO PARA CRIAR COBRANÇA:
   a) Se não tiver o ID do cliente, chame buscar_clientes primeiro
   b) Se retornar múltiplos clientes, pergunte qual
   c) Confirme os dados com Mariana antes de criar
   d) Após criar, informe o ID da cobrança e o link se disponível

4. FORMATAÇÃO:
   - Valores como R$ X.XXX,XX
   - Use **negrito** para destacar valores, nomes e totais
   - Datas no formato DD/MM/AAAA para o usuário, YYYY-MM-DD ao chamar ferramentas
   - Seja direta e concisa

5. SE FALTAR INFORMAÇÃO: pergunte só o que realmente precisa antes de prosseguir.`;

  // ─── Loop do agente ──────────────────────────────────────────────────────────

  const mensagens = [
    ...historico.slice(-14),
    { role: "user", content: mensagem }
  ];

  try {
    let resposta = await chamarClaude(CLAUDE_KEY, systemPrompt, mensagens, tools);
    let iteracoes = 0;

    while (resposta.stop_reason === 'tool_use' && iteracoes < 6) {
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
      || "Não consegui processar. Tente novamente.";

    return res.status(200).json({ resposta: texto });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
};

// ─── Chamada Claude ──────────────────────────────────────────────────────────

async function chamarClaude(apiKey, system, messages, tools) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
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
  const chave = (conta) =>
    conta === 'escritorio'
      ? process.env.ASAAS_KEY_ESCRITORIO
      : process.env.ASAAS_KEY_PESSOAL;

  // CONSULTAS ─────────────────────────────────────────────────────────────────

  if (nome === 'buscar_honorarios') {
    const { mes, ano } = input;
    const m = String(mes).padStart(2, '0');
    const a = String(ano);
    const dataInicio = `${a}-${m}-01`;
    const ultimoDia = new Date(Number(a), Number(mes), 0).getDate();
    const dataFim = `${a}-${m}-${String(ultimoDia).padStart(2, '0')}`;
    const params = new URLSearchParams({ status: 'RECEIVED', 'paymentDate[ge]': dataInicio, 'paymentDate[le]': dataFim, limit: '100' });
    const [pessoal, escritorio] = await Promise.all([
      buscarPagamentosAsaas(process.env.ASAAS_KEY_PESSOAL, params),
      buscarPagamentosAsaas(process.env.ASAAS_KEY_ESCRITORIO, params)
    ]);
    return {
      mes, ano,
      pessoal: { total: pessoal.total, quantidade: pessoal.quantidade, pagamentos: pessoal.pagamentos },
      escritorio: { total: escritorio.total, quantidade: escritorio.quantidade, pagamentos: escritorio.pagamentos },
      totalHonorarios: Math.round((pessoal.total + escritorio.total) * 100) / 100
    };
  }

  if (nome === 'buscar_repasses') {
    const { mes, ano } = input;
    const SB_HEAD = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
    const r = await fetch(`${SB_URL}/rest/v1/repasses?mes=eq.${mes}&ano=eq.${ano}&order=criado_em.asc`, { headers: SB_HEAD });
    const data = r.ok ? await r.json() : [];
    const total = data.reduce((s, i) => s + (i.valor || 0), 0);
    return { mes, ano, total: Math.round(total * 100) / 100, quantidade: data.length, itens: data };
  }

  if (nome === 'buscar_despesas') {
    const { mes, ano } = input;
    const SB_HEAD = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
    const r = await fetch(`${SB_URL}/rest/v1/despesas?mes=eq.${mes}&ano=eq.${ano}&order=criado_em.asc`, { headers: SB_HEAD });
    const data = r.ok ? await r.json() : [];
    const total = data.reduce((s, i) => s + (i.valor || 0), 0);
    return { mes, ano, total: Math.round(total * 100) / 100, quantidade: data.length, itens: data };
  }

  // CLIENTES ──────────────────────────────────────────────────────────────────

  if (nome === 'buscar_clientes') {
    const { nome: nomeBusca, conta = 'pessoal' } = input;
    const k = chave(conta);
    if (!k) return { erro: 'Chave não configurada' };
    const params = new URLSearchParams({ name: nomeBusca, limit: '10' });
    const r = await fetch(`https://api.asaas.com/v3/customers?${params}`, {
      headers: { 'access_token': k, 'Content-Type': 'application/json' }
    });
    if (!r.ok) {
      const t = await r.text();
      return { erro: `Asaas ${r.status}: ${t}` };
    }
    const data = await r.json();
    const clientes = (data.data || []).map(c => ({
      id: c.id,
      nome: c.name,
      cpfCnpj: c.cpfCnpj || '',
      email: c.email || '',
      telefone: c.mobilePhone || c.phone || ''
    }));
    return { conta, totalEncontrado: clientes.length, clientes };
  }

  // CRIAR COBRANÇA ────────────────────────────────────────────────────────────

  if (nome === 'criar_cobranca') {
    const { customer_id, valor, vencimento, descricao, tipo = 'BOLETO', conta = 'pessoal' } = input;
    const k = chave(conta);
    if (!k) return { erro: 'Chave não configurada' };
    const payload = {
      customer: customer_id,
      billingType: tipo,
      value: valor,
      dueDate: vencimento,
      description: descricao
    };
    const r = await fetch('https://api.asaas.com/v3/payments', {
      method: 'POST',
      headers: { 'access_token': k, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const t = await r.text();
      return { erro: `Asaas ${r.status}: ${t}` };
    }
    const data = await r.json();
    return {
      sucesso: true,
      id: data.id,
      status: data.status,
      valor: data.value,
      vencimento: data.dueDate,
      invoiceUrl: data.invoiceUrl || null,
      bankSlipUrl: data.bankSlipUrl || null,
      pixQrCodeUrl: data.pixQrCodeUrl || null,
      conta
    };
  }

  // LISTAR COBRANÇAS PENDENTES ────────────────────────────────────────────────

  if (nome === 'listar_cobrancas_pendentes') {
    const { conta = 'pessoal', status = 'ALL' } = input;

    const buscarStatus = async (k, st) => {
      const params = new URLSearchParams({ status: st, limit: '50' });
      const r = await fetch(`https://api.asaas.com/v3/payments?${params}`, {
        headers: { 'access_token': k, 'Content-Type': 'application/json' }
      });
      if (!r.ok) return [];
      const data = await r.json();
      return (data.data || []).map(p => ({
        id: p.id,
        cliente: p.customerName || p.description || 'Cliente',
        valor: p.value,
        vencimento: p.dueDate,
        status: p.status,
        descricao: p.description || ''
      }));
    };

    const resultados = [];
    const contas = conta === 'ambas'
      ? [{ label: 'Pessoal', k: process.env.ASAAS_KEY_PESSOAL }, { label: 'Escritório', k: process.env.ASAAS_KEY_ESCRITORIO }]
      : [{ label: conta === 'escritorio' ? 'Escritório' : 'Pessoal', k: chave(conta) }];

    for (const c of contas) {
      if (!c.k) continue;
      const statusList = status === 'ALL' ? ['PENDING', 'OVERDUE'] : [status];
      for (const st of statusList) {
        const items = await buscarStatus(c.k, st);
        items.forEach(i => resultados.push({ ...i, conta: c.label }));
      }
    }

    const totalValor = resultados.reduce((s, p) => s + (p.valor || 0), 0);
    return { quantidade: resultados.length, totalValor: Math.round(totalValor * 100) / 100, cobrancas: resultados };
  }

  // CANCELAR COBRANÇA ─────────────────────────────────────────────────────────

  if (nome === 'cancelar_cobranca') {
    const { payment_id, conta = 'pessoal' } = input;
    const k = chave(conta);
    if (!k) return { erro: 'Chave não configurada' };
    const r = await fetch(`https://api.asaas.com/v3/payments/${payment_id}`, {
      method: 'DELETE',
      headers: { 'access_token': k, 'Content-Type': 'application/json' }
    });
    if (!r.ok) {
      const t = await r.text();
      return { erro: `Asaas ${r.status}: ${t}` };
    }
    return { sucesso: true, payment_id, mensagem: 'Cobrança cancelada com sucesso.' };
  }

  // REGISTRAR REPASSE ─────────────────────────────────────────────────────────

  if (nome === 'registrar_repasse') {
    const { parceiro, valor, mes, ano, data_pagamento = '', conta = '' } = input;
    const SB_HEAD = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    const payload = { mes, ano, parceiro, valor, data_pagamento, conta };
    const r = await fetch(`${SB_URL}/rest/v1/repasses`, {
      method: 'POST',
      headers: SB_HEAD,
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const t = await r.text();
      return { erro: `Supabase ${r.status}: ${t}` };
    }
    const data = await r.json();
    const item = Array.isArray(data) ? data[0] : data;
    return { sucesso: true, id: item?.id, parceiro, valor, mes, ano, mensagem: `Repasse de R$ ${valor.toFixed(2).replace('.',',')} para ${parceiro} registrado.` };
  }

  // REGISTRAR DESPESA ─────────────────────────────────────────────────────────

  if (nome === 'registrar_despesa') {
    const { categoria, descricao, valor, mes, ano, data_pagamento = '' } = input;
    const SB_HEAD = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    const payload = { mes, ano, categoria, descricao, valor, data_pagamento };
    const r = await fetch(`${SB_URL}/rest/v1/despesas`, {
      method: 'POST',
      headers: SB_HEAD,
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const t = await r.text();
      return { erro: `Supabase ${r.status}: ${t}` };
    }
    const data = await r.json();
    const item = Array.isArray(data) ? data[0] : data;
    return { sucesso: true, id: item?.id, categoria, descricao, valor, mes, ano, mensagem: `Despesa "${descricao}" de R$ ${valor.toFixed(2).replace('.',',')} registrada.` };
  }

  // EXCLUIR ITEM ──────────────────────────────────────────────────────────────

  if (nome === 'excluir_item') {
    const { tabela, id } = input;
    const SB_HEAD = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
    const r = await fetch(`${SB_URL}/rest/v1/${tabela}?id=eq.${id}`, {
      method: 'DELETE',
      headers: SB_HEAD
    });
    if (!r.ok) {
      const t = await r.text();
      return { erro: `Supabase ${r.status}: ${t}` };
    }
    return { sucesso: true, tabela, id, mensagem: 'Item excluído com sucesso.' };
  }

  return { erro: `Ferramenta desconhecida: ${nome}` };
}

// ─── Helper Asaas pagamentos ─────────────────────────────────────────────────

async function buscarPagamentosAsaas(chave, params) {
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
