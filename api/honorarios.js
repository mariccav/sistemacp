// ── Categorias de despesa por palavras-chave ──────────────────────
const CATEGORIAS_KEYWORDS = {
  'Pessoal e Prestadores': [
    'salário','salario','honorário','honorario','autônomo','autonomo',
    'freelancer','prestador','funcionário','funcionario','remuneração',
    'remuneracao','pro labore','prolabore','adiantamento','férias','ferias',
    '13','décimo','decimo','rescisão','rescisao','humberto','diana',
    'jade','laila','barboza','estagiário','estagiario'
  ],
  'Tributário e Fiscal': [
    'inss','irrf','issqn','iss','irpj','csll','pis','cofins','fgts',
    'guia','tributo','imposto','das','simples','gps','darf','pgfn',
    'receita federal','sefaz','prefeitura','parcelamento','tax'
  ],
  'Tecnologia e Sistemas': [
    'vercel','supabase','claude','anthropic','clicksign','escavador',
    'astrea','software','sistema','assinatura','licença','licenca',
    'hosting','domínio','dominio','api','jusbrasil','google workspace',
    'microsoft','adobe','zoom','notion','slack','aws','hostinger'
  ],
  'Marketing e Comunicação': [
    'tráfego','trafego','anúncio','anuncio','publicidade','instagram',
    'google ads','meta ads','facebook','linkedin','marketing','mídia',
    'midia','impulsionar','campanha','conteúdo','conteudo','social media'
  ],
  'Escritório e Estrutura': [
    'aluguel','condomínio','condominio','água','agua','energia','luz',
    'internet','telefone','material','papelaria','limpeza','seguro',
    'copa','café','cafe','manutenção','manutencao','mobiliário',
    'mobiliario','mundo plaza','sala'
  ],
  'Jurídico e Cartorário': [
    'oab','tribunal','protocolo','cartório','cartorio','certidão',
    'certidao','alvará','alvara','diligência','diligencia','pericial',
    'tj','trf','stj','stf','custas','emolumento','registro','notarial'
  ],
  'Repasses a Parceiros': [
    'repasse','parceiro','comissão','comissao','contty','participação',
    'participacao','divisão','divisao','acordo'
  ]
};

function classificarDespesa(descricao) {
  if (!descricao) return 'Outros';
  const texto = descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  for (const [categoria, palavras] of Object.entries(CATEGORIAS_KEYWORDS)) {
    if (palavras.some(p => texto.includes(
      p.normalize('NFD').replace(/[̀-ͯ]/g,'')
    ))) return categoria;
  }
  return 'Outros';
}

// ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { mes, ano, tipo } = req.query || {};
  if (!mes || !ano) return res.status(400).json({ erro: 'Informe mes e ano.' });

  const m = String(mes).padStart(2, '0');
  const a = String(ano);
  const dataInicio = `${a}-${m}-01`;
  const ultimoDia = new Date(Number(a), Number(mes), 0).getDate();
  const dataFim = `${a}-${m}-${String(ultimoDia).padStart(2, '0')}`;

  try {
    // ── Modo despesas: sincroniza saídas do Asaas → Supabase ────────
    if (tipo === 'despesas') {
      const SB_URL = 'https://svwwmxapmppjkmbazhul.supabase.co';
      const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
      const SB_HEAD = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

      // 1. Buscar transações brutas do Asaas (ambas as contas)
      const [despPessoal, despEscritorio] = await Promise.all([
        buscarDespesas(process.env.ASAAS_KEY_PESSOAL, dataInicio, dataFim, 'Asaas Pessoal'),
        buscarDespesas(process.env.ASAAS_KEY_ESCRITORIO, dataInicio, dataFim, 'Asaas Empresa')
      ]);
      const todasAsaas = [...despPessoal, ...despEscritorio];

      // 2. Verificar quais já existem no Supabase (pelo asaas_id)
      //    Se a coluna asaas_id ainda não existe, pula a sincronização
      try {
        const asaasIds = todasAsaas.map(d => d.id).join(',');
        if (asaasIds) {
          const rExist = await fetch(
            `${SB_URL}/rest/v1/despesas?mes=eq.${mes}&ano=eq.${ano}&asaas_id=in.(${asaasIds})&select=asaas_id`,
            { headers: { ...SB_HEAD, 'Prefer': 'return=representation' } }
          );
          const jaExistem = rExist.ok ? (await rExist.json()).map(d => d.asaas_id) : [];

          // 3. Inserir apenas os novos (não duplicar)
          const novos = todasAsaas.filter(d => !jaExistem.includes(d.id));
          if (novos.length > 0) {
            const payload = novos.map(d => ({
              mes: Number(mes), ano: Number(ano),
              data_pagamento: d.data,
              descricao: d.descricao,
              categoria: d.categoria,
              valor: d.valor,
              conta: d.conta,
              asaas_id: d.id
            }));
            await fetch(`${SB_URL}/rest/v1/despesas`, {
              method: 'POST', headers: SB_HEAD, body: JSON.stringify(payload)
            });
          }
        }
      } catch (e) {
        // Coluna asaas_id ainda não existe — só retorna os dados sem salvar
        console.warn('Sync Asaas→Supabase: coluna asaas_id não encontrada. Execute o SQL de migração.');
      }

      // Retornar os dados já salvos no Supabase (manuais + importados)
      const rTodos = await fetch(
        `${SB_URL}/rest/v1/despesas?mes=eq.${mes}&ano=eq.${ano}&order=data_pagamento.asc`,
        { headers: { ...SB_HEAD, 'Prefer': 'return=representation' } }
      );
      const todos = rTodos.ok ? await rTodos.json() : [];

      return res.status(200).json({
        mes: Number(mes), ano: Number(ano),
        sincronizados: todasAsaas.length,
        despesas: todos          // ← retorna tudo para o frontend usar diretamente
      });
    }

    // ── Modo padrão: honorários recebidos ─────────────────────────
    const [pessoal, escritorio] = await Promise.all([
      buscarPagamentos(process.env.ASAAS_KEY_PESSOAL, dataInicio, dataFim),
      buscarPagamentos(process.env.ASAAS_KEY_ESCRITORIO, dataInicio, dataFim)
    ]);

    return res.status(200).json({
      mes: Number(mes), ano: Number(ano),
      periodo: `${dataInicio} a ${dataFim}`,
      pessoal, escritorio,
      totalHonorarios: pessoal.total + escritorio.total
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
};

// ── Buscar saídas do Asaas via financialTransactions ─────────────
// Confirmado pelo debug: value < 0 = saída, value > 0 = entrada.
// /v3/transfers retorna 403 (sem permissão) — usar apenas financialTransactions.
// Paginação automática para buscar todos os registros do mês.
async function buscarDespesas(chave, dataInicio, dataFim, conta) {
  if (!chave) return [];

  const headers = { access_token: chave, 'Content-Type': 'application/json' };
  const resultados = [];
  let offset = 0;
  const limit = 100;

  try {
    // Paginar até buscar todos os registros do período
    while (true) {
      const r = await fetch(
        `https://api.asaas.com/v3/financialTransactions?startDate=${dataInicio}&finishDate=${dataFim}&limit=${limit}&offset=${offset}`,
        { headers }
      );
      if (!r.ok) {
        console.error('financialTransactions erro:', r.status);
        break;
      }
      const data = await r.json();
      const items = data.data || [];

      for (const t of items) {
        const valor = Number(t.value || 0);
        // value < 0 = dinheiro saindo da conta (confirmado no debug)
        if (valor >= 0) continue;

        resultados.push({
          id: t.id,
          data: t.date || dataInicio,
          descricao: t.description || t.type || 'Saída',
          valor: Math.abs(valor),
          conta,
          categoria: classificarDespesa(t.description || t.type || '')
        });
      }

      // Parar quando não há mais páginas
      if (!data.hasMore) break;
      offset += limit;
    }
  } catch (e) {
    console.error('buscarDespesas erro:', e.message);
  }

  console.log(`Despesas [${conta}]: ${resultados.length} saídas de ${dataInicio} a ${dataFim}`);
  return resultados;
}

// ── Buscar honorários recebidos ───────────────────────────────────
async function buscarPagamentos(chave, dataInicio, dataFim) {
  if (!chave) throw new Error('Chave de API não configurada.');

  const params = new URLSearchParams({
    status: 'RECEIVED',
    'paymentDate[ge]': dataInicio,
    'paymentDate[le]': dataFim,
    limit: '100'
  });
  const response = await fetch(`https://api.asaas.com/v3/payments?${params}`, {
    headers: { access_token: chave, 'Content-Type': 'application/json' }
  });
  if (!response.ok) {
    const texto = await response.text();
    throw new Error(`Asaas retornou erro ${response.status}: ${texto}`);
  }

  const data = await response.json();
  const pagamentos = data.data || [];
  const total = pagamentos.reduce((soma, p) => soma + (p.value || 0), 0);

  const idsUnicos = [...new Set(
    pagamentos.filter(p => !p.customerName && p.customer).map(p => p.customer)
  )];
  const nomeCliente = {};
  await Promise.all(idsUnicos.map(async (id) => {
    try {
      const r = await fetch(`https://api.asaas.com/v3/customers/${id}`, {
        headers: { access_token: chave }
      });
      if (r.ok) { const c = await r.json(); nomeCliente[id] = c.name || null; }
    } catch {}
  }));

  return {
    total: Math.round(total * 100) / 100,
    quantidade: pagamentos.length,
    pagamentos: pagamentos.map(p => ({
      id: p.id,
      cliente: p.customerName || nomeCliente[p.customer] || p.description || 'Cliente',
      valor: p.value,
      dataPagamento: p.paymentDate,
      descricao: p.description || ''
    }))
  };
}
