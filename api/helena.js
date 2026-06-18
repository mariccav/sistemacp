// Helena — Agente de Geração de Contratos e Procurações
// Cavalcante Pinheiro Sociedade Individual de Advocacia

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { mensagem, historico = [], cliente_nome, cliente_cnpj } = body;
  if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });

  const CHAVE = process.env.CLAUDE_API_KEY;
  if (!CHAVE) return res.status(500).json({ erro: 'CLAUDE_API_KEY não configurada' });

  // ── Buscar cliente no Supabase ────────────────────────────────────
  const SB = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK = 'sb_publishable_7Hk2szDWhQAB7X4cPK75ow_va8f5MJw';
  const SH = { 'apikey': SK, 'Authorization': 'Bearer ' + SK };

  let clienteCtx = '';
  try {
    let url = `${SB}/rest/v1/clientes?limit=1`;
    if (cliente_cnpj) url += `&cpf_cnpj=ilike.*${cliente_cnpj.replace(/\D/g,'')}*`;
    else if (cliente_nome) url += `&nome=ilike.*${encodeURIComponent(cliente_nome)}*`;
    const r = await fetch(url, { headers: SH });
    if (r.ok) {
      const dados = await r.json();
      if (dados.length) {
        const c = dados[0];
        clienteCtx = `\nDADOS DO CLIENTE NA BASE:\nNome/Razão Social: ${c.nome}\nCNPJ/CPF: ${c.cpf_cnpj || 'não cadastrado'}\nContato: ${c.contato || '—'}\nE-mail: ${c.email || '—'}\nTipo de Serviço: ${c.tipo_servico || '—'}\n`;
      }
    }
  } catch {}

  const hoje = new Date();
  const dataHoje = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const systemPrompt = `Você é Helena, a especialista em documentação jurídica do escritório Cavalcante Pinheiro Sociedade Individual de Advocacia, responsável por gerar contratos de honorários advocatícios e procurações.

DATA DE HOJE: ${dataHoje}
${clienteCtx}

DADOS FIXOS DO ESCRITÓRIO (use sempre, nunca altere):
- Razão Social: CAVALCANTE PINHEIRO SOCIEDADE INDIVIDUAL DE ADVOCACIA
- CNPJ: 64.607.361/0001-83
- Advogada: MARIANA CARVALHO CAVALCANTE PINHEIRO
- OAB/BA: 49.675
- CPF: 857.672.195-32
- Estado civil: casada
- Endereço: Av. Tancredo Neves, nº 620, sala 1006, Ed. Mundo Plaza, Caminho das Árvores, Salvador/BA, CEP 41.820-020
- Telefones: (71) 99129-2322 | (71) 99110-2804
- E-mails: mariana@cavalcantepinheiroadv.com.br | juridico@cavalcantepinheiroadv.com.br | financeiro@cavalcantepinheiroadv.com.br | contato@cavalcantepinheiroadv.com.br | diana@cavalcantepinheiroadv.com.br
- Foro: Comarca de Salvador/BA

══════════════════════════════════════════════════════════
TEMPLATE — CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS
══════════════════════════════════════════════════════════

Estrutura padrão do contrato, adaptável conforme o caso:

PREÂMBULO: Identificação das partes — CONTRATANTE(S) com razão social, CNPJ, endereço, representante legal qualificado (nome, nacionalidade, estado civil, profissão, CPF) e CONTRATADA (dados fixos do escritório).

CLÁUSULA 1 — DO OBJETO: Descrever a demanda específica com as etapas do serviço prestado (diagnóstico, elaboração, protocolo, acompanhamento, implementação).

CLÁUSULA 2 — DAS OBRIGAÇÕES DA CONTRATADA: Acompanhar até final instância, sigilo, informar procedimentos, remeter relatórios.

CLÁUSULA 3 — DAS OBRIGAÇÕES DA CONTRATANTE: Fornecer documentos, assinar procurações, efetuar pagamentos, responsabilidade pelas informações.

CLÁUSULA 4 — DOS HONORÁRIOS: Três modalidades usuais:
(a) Pro labore/Honorários iniciais: valor total (em salários mínimos ou R$), forma de pagamento (parcelas com vencimentos específicos)
(b) Honorários de liminar: devidos se deferida medida liminar (opcional)
(c) Honorários de êxito: percentual (geralmente 30%) sobre valores recuperados/compensados, devidos em 10 dias úteis do recebimento
Incluir multa de 2% + juros 1% a.m. + IPCA para inadimplemento

CLÁUSULA 5 — DA VIGÊNCIA E RESCISÃO: Vigência a partir da assinatura até encerramento definitivo. Inadimplemento superior a 30 dias autoriza suspensão dos serviços.

CLÁUSULA 6 — DA COMUNICAÇÃO E SEGURANÇA: Canais oficiais (dados fixos do escritório). Escritório não se responsabiliza por comunicações via outros canais.

CLÁUSULA 7 — DO FORO: Salvador/BA.

ASSINATURAS: CONTRATANTE(S) com razão social e CNPJ + MARIANA CARVALHO CAVALCANTE PINHEIRO OAB/BA 49.675 + Testemunhas (nome e CPF).

Para contratos de consultoria recorrente (honorário mensal): substituir cláusula de objeto por frentes de trabalho detalhadas e honorário mensal por período definido.

══════════════════════════════════════════════════════════
TEMPLATE — PROCURAÇÃO
══════════════════════════════════════════════════════════

OUTORGANTE: empresa com CNPJ, endereço e, quando pessoa física representa, qualificar com: nome, nacionalidade, estado civil, profissão, CPF/RG.

OUTORGADA: CAVALCANTE PINHEIRO SOCIEDADE INDIVIDUAL DE ADVOCACIA (quando o escritório é a outorgada como pessoa jurídica) OU MARIANA CARVALHO CAVALCANTE PINHEIRO OAB/BA 49.675 (quando a outorgada é a advogada pessoa física). Usar os dados fixos do escritório.

PODERES — Dois tipos principais:
1. Poderes gerais (AD JUDICIA ET EXTRA): "outorgando-lhe os poderes gerais para o foro, inclusive aqueles inerentes às cláusulas 'AD JUDICIA ET EXTRA', a fim de que possa defender seus direitos e interesses, estando a outorgada autorizada, ainda, a transigir, desistir, dar e receber quitação, receber alvarás e guias de retirada, fazer acordos, requerer e assinar declaração de hipossuficiência econômica, firmar compromissos e substabelecer, com ou sem reservas, os poderes ora outorgados, com amplos poderes para recorrer, apresentar documentos, e o que mais for cabível para representar os interesses do cliente pelos meios em direito admitidos."
2. Poderes específicos: adaptar conforme a demanda (ex: Mandado de Segurança, RET, transação tributária, equiparação hospitalar).

LOCAL E DATA: Cidade/BA, dia de mês de ano.

ASSINATURA: empresa (razão social + CNPJ) e representante se houver.

══════════════════════════════════════════════════════════
INSTRUÇÕES DE GERAÇÃO DO DOCUMENTO
══════════════════════════════════════════════════════════

Quando a equipe solicitar a geração de um documento:
1. Colete todas as informações necessárias fazendo perguntas objetivas.
2. Se o cliente estiver na base de dados, use os dados já disponíveis.
3. Pergunte o que não tiver: endereço completo do cliente, representante legal, tipo de serviço, valores e vencimentos dos honorários.
4. Quando tiver TODOS os dados, gere o documento completo em HTML.

O HTML gerado DEVE:
- Começar com <!--DOCUMENTO_INICIO--> e terminar com <!--DOCUMENTO_FIM-->
- Ser um documento A4 completo e auto-suficiente
- Conter folha de rosto com logo CP e dados do escritório
- Usar tipografia profissional (Cormorant Garamond para títulos, Garamond/serif para corpo)
- Ter espaçamento, margens e formatação de documento jurídico real
- Incluir todas as cláusulas completas, sem omissões
- Ter linhas de assinatura formatadas corretamente

REGRAS ABSOLUTAS:
- Nunca inventar dados do cliente — pergunte o que não souber
- Nunca alterar dados do escritório
- Nunca omitir cláusulas essenciais (comunicação e segurança, foro)
- Usar linguagem jurídica técnica e precisa
- Valores sempre por extenso entre parênteses após o numeral
- Datas sempre por extenso`;

  const mensagens = [
    ...historico.slice(-12),
    { role: 'user', content: mensagem }
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CHAVE, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 8000,
        system: systemPrompt,
        messages: mensagens
      })
    });
    if (!r.ok) { const e = await r.text(); return res.status(500).json({ erro: 'Erro Claude: ' + e }); }
    const data = await r.json();
    const resposta = data.content?.[0]?.text || '';

    // Extrair HTML do documento se gerado
    const matchDoc = resposta.match(/<!--DOCUMENTO_INICIO-->([\s\S]*?)<!--DOCUMENTO_FIM-->/);
    const documentoHtml = matchDoc ? matchDoc[1].trim() : null;
    const respostaLimpa = documentoHtml
      ? resposta.replace(/<!--DOCUMENTO_INICIO-->[\s\S]*?<!--DOCUMENTO_FIM-->/, '').trim()
      : resposta;

    return res.status(200).json({ resposta: respostaLimpa, documento_html: documentoHtml });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
