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

// ── Buscar despesas/saídas do Asaas via financialTransactions ────
// Filtragem em duas camadas para garantir que só saídas entrem:
//   1. Parâmetro transactionType=DEBIT na URL (se o Asaas aceitar)
//   2. Verificação do sinal do value: valor negativo = saída da conta
async function buscarDespesas(chave, dataInicio, dataFim, conta) {
  if (!chave) return [];

  // Tipos de transação do Asaas que representam ENTRADAS (recebimentos)
  // Qualquer transação com esses tipos será excluída mesmo que venha na lista
  const TIPOS_ENTRADA = [
    'PAYMENT_RECEIVED','RECEIVED_FROM_CUSTOMER','CREDIT','PIX_CREDIT',
    'TRANSFER_RECEIVED','REVERSED_TRANSFER','CHARGEBACK_DISPUTE',
    'REFUND_RECEIVED','RECEIVED'
  ];

  try {
    // Buscar sem filtro de type — alguns planos Asaas ignoram esse parâmetro
    const params = new URLSearchParams({
      startDate: dataInicio,
      finishDate: dataFim,
      limit: '100'
    });
    const r = await fetch(`https://api.asaas.com/v3/financialTransactions?${params}`, {
      headers: { access_token: chave, 'Content-Type': 'application/json' }
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('Asaas financialTransactions erro:', r.status, txt);
      return [];
    }
    const data = await r.json();
    const todas = data.data || [];

    // ── FILTRO DUPLO: garante que só saídas passem ──────────────────
    const saidas = todas.filter(t => {
      const valor = Number(t.value || 0);
      const tipo  = (t.type || t.transactionType || '').toUpperCase();

      // Regra 1: valor negativo = saída da conta (mais confiável)
      if (valor < 0) return true;

      // Regra 2: valor zero ou positivo com tipo de entrada = excluir
      if (valor >= 0 && TIPOS_ENTRADA.some(te => tipo.includes(te))) return false;

      // Regra 3: valor positivo sem tipo reconhecido = excluir (segurança)
      if (valor > 0) return false;

      return false;
    });

    return saidas.map(t => ({
      id: t.id,
      data: t.date || t.effectiveDate || dataInicio,
      descricao: t.description || t.type || 'Saída',
      valor: Math.abs(Number(t.value || 0)),
      conta,
      categoria: classificarDespesa(t.description || t.type || '')
    }));

  } catch (e) {
    console.error('buscarDespesas erro:', e.message);
    return [];
  }
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
