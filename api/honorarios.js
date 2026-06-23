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

      return res.status(200).json({
        mes: Number(mes), ano: Number(ano),
        sincronizados: todasAsaas.length
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

// ── Buscar saídas do Asaas: transferências + pagamentos ──────────
// Combina dois endpoints para cobrir todos os tipos de saída:
// 1. /v3/transfers   → PIX, TED enviados (transferências)
// 2. /v3/payments    → boletos/cobranças que a conta PAGOU (status REFUNDED
//    ou qualquer pagamento onde a conta é o pagador)
//
// Tipos de saída garantidos pelo endpoint usado — nunca mistura entradas.
async function buscarDespesas(chave, dataInicio, dataFim, conta) {
  if (!chave) return [];

  const headers = { access_token: chave, 'Content-Type': 'application/json' };
  const resultados = [];

  // ── 1. Transferências enviadas (PIX / TED / entre contas) ────────
  try {
    // Asaas aceita startDate/finishDate OU dateCreated[ge/le]
    const [r1, r2] = await Promise.all([
      fetch(`https://api.asaas.com/v3/transfers?startDate=${dataInicio}&finishDate=${dataFim}&limit=100`, { headers }),
      fetch(`https://api.asaas.com/v3/transfers?dateCreated[ge]=${dataInicio}&dateCreated[le]=${dataFim}&limit=100`, { headers })
    ]);

    for (const r of [r1, r2]) {
      if (!r.ok) continue;
      const data = await r.json();
      for (const t of (data.data || [])) {
        // Evitar duplicatas entre as duas chamadas (mesmo id)
        if (resultados.find(x => x.id === t.id)) continue;
        resultados.push({
          id: t.id,
          data: t.transferDate || t.dateCreated || t.date || dataInicio,
          descricao: t.description || t.operationType || 'Transferência',
          valor: Math.abs(Number(t.value || t.netValue || 0)),
          conta,
          categoria: classificarDespesa(t.description || t.operationType || '')
        });
      }
    }
  } catch (e) {
    console.error('transfers erro:', e.message);
  }

  // ── 2. Cobranças pagas pela conta (boletos, pagamentos feitos) ───
  // O Asaas chama de "bills" os pagamentos que você faz a terceiros
  try {
    const rb = await fetch(
      `https://api.asaas.com/v3/financialTransactions?startDate=${dataInicio}&finishDate=${dataFim}&limit=100`,
      { headers }
    );
    if (rb.ok) {
      const db = await rb.json();

      // Tipos que representam SAÍDAS confirmadas no Asaas
      const TIPOS_SAIDA = [
        'TRANSFER','PIX_DEBIT','BILL_PAYMENT','BANK_SLIP_PAYMENT',
        'DEBIT','PAYMENT_SENT','TRANSFER_SENT','TEV','TED'
      ];
      // Tipos que são ENTRADAS — excluir sempre
      const TIPOS_ENTRADA = [
        'PAYMENT_RECEIVED','CREDIT','PIX_CREDIT','TRANSFER_RECEIVED',
        'RECEIVED','CHARGEBACK','REFUND_RECEIVED','RECEIVABLE'
      ];

      for (const t of (db.data || [])) {
        if (resultados.find(x => x.id === t.id)) continue; // já veio em transfers

        const tipo = (t.type || t.transactionType || '').toUpperCase();
        const valor = Number(t.value || 0);

        // Excluir entradas conhecidas
        if (TIPOS_ENTRADA.some(te => tipo.includes(te))) continue;
        // Incluir apenas saídas reconhecidas OU valores negativos
        const ehSaida = TIPOS_SAIDA.some(ts => tipo.includes(ts)) || valor < 0;
        if (!ehSaida) continue;

        resultados.push({
          id: t.id,
          data: t.date || t.effectiveDate || dataInicio,
          descricao: t.description || tipo || 'Pagamento',
          valor: Math.abs(valor),
          conta,
          categoria: classificarDespesa(t.description || tipo || '')
        });
      }
    }
  } catch (e) {
    console.error('financialTransactions erro:', e.message);
  }

  console.log(`Despesas [${conta}]: ${resultados.length} saídas encontradas`);
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
