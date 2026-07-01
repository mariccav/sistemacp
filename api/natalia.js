// Natalia — Agente Comercial e Geradora de Propostas
// Fusão: Preparador de Reuniões + Gerador de Propostas + Águia Tributária CP

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
  const { mensagem, historico = [], lead_id } = body;
  if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });

  const CHAVE = process.env.CLAUDE_API_KEY;
  if (!CHAVE) return res.status(500).json({ erro: 'CLAUDE_API_KEY não configurada' });

  const SB = 'https://svwwmxapmppjkmbazhul.supabase.co';
  const SK = process.env.SUPABASE_SERVICE_KEY;
  const SH = { 'apikey': SK, 'Authorization': 'Bearer ' + SK };

  // ── Buscar dados do lead ────────────────────────────────────────
  let leadCtx = '';
  let cnpjData = null;

  if (lead_id) {
    try {
      const rLead = await fetch(`${SB}/rest/v1/leads?id=eq.${lead_id}&select=*`, { headers: SH });
      if (rLead.ok) {
        const leads = await rLead.json();
        if (leads.length) {
          const l = leads[0];
          leadCtx = `\nDADOS DO LEAD NO CRM:
Razão Social: ${l.razao_social || '—'}
Nome Fantasia: ${l.nome_fantasia || '—'}
CNPJ: ${l.cnpj || '—'}
Setor: ${l.setor || '—'}
Porte: ${l.porte || '—'}
Valor da Dívida: ${l.valor_divida ? 'R$ ' + Number(l.valor_divida).toLocaleString('pt-BR') : '—'}
Modalidade de Transação: ${l.modalidade_transacao || '—'}
Score: ${l.score || '—'}
Origem: ${l.origem || '—'}
Etapa: ${l.etapa || '—'}
Responsável: ${l.responsavel || '—'}
Argumento de Anúncio: ${l.argumento_anuncio || '—'}
Observações: ${l.observacoes || '—'}
Situação Cadastral: ${l.situacao_cadastral || '—'}
CNAE: ${l.cnae_descricao || l.cnae_principal || '—'}`;

          // Buscar contatos do lead
          const rCont = await fetch(`${SB}/rest/v1/leads_contatos?lead_id=eq.${lead_id}&order=is_principal.desc`, { headers: SH });
          if (rCont.ok) {
            const contatos = await rCont.json();
            if (contatos.length) {
              leadCtx += '\nCONTATOS/SÓCIOS:\n' + contatos.map(c =>
                `- ${c.nome}${c.cargo ? ' (' + c.cargo + ')' : ''} ${c.email ? '| ' + c.email : ''} ${c.telefone ? '| ' + c.telefone : ''}`
              ).join('\n');
            }
          }

          // Buscar dados da BrasilAPI se tiver CNPJ
          if (l.cnpj) {
            const cnpjLimpo = l.cnpj.replace(/\D/g, '');
            if (cnpjLimpo.length === 14) {
              try {
                const rApi = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
                if (rApi.ok) {
                  cnpjData = await rApi.json();
                  leadCtx += `\nDADOS RECEITA FEDERAL (BrasilAPI):
Razão Social Oficial: ${cnpjData.razao_social || '—'}
Data de Abertura: ${cnpjData.data_inicio_atividade || '—'}
Situação: ${cnpjData.descricao_situacao_cadastral || '—'}
Porte: ${cnpjData.porte || '—'}
Natureza Jurídica: ${cnpjData.natureza_juridica || '—'}
Capital Social: R$ ${cnpjData.capital_social ? Number(cnpjData.capital_social).toLocaleString('pt-BR') : '—'}
CNAE Principal: ${cnpjData.cnae_fiscal_descricao || '—'}
Município: ${cnpjData.municipio || '—'} / ${cnpjData.uf || '—'}
Telefone: ${cnpjData.ddd_telefone_1 ? '(' + cnpjData.ddd_telefone_1 + ') ' + cnpjData.telefone_1 : '—'}
E-mail: ${cnpjData.email || '—'}
Sócios QSA: ${cnpjData.qsa ? cnpjData.qsa.map(s => s.nome_socio + ' (' + s.qualificacao_socio + ')').join(', ') : '—'}`;
                }
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const systemPrompt = `Você é Natalia, a estrategista comercial e analista tributária sênior do escritório Cavalcante Pinheiro Advocacia. Você é a fusão de três competências:

1. PESQUISADORA E PREPARADORA DE REUNIÕES: Antes de qualquer reunião com um lead, você entrega um dossiê executivo completo com o perfil da empresa, riscos fiscais, oportunidades tributárias, perfil dos sócios e a estratégia exata de abordagem. Você pensa como advogada tributarista, consultora de negócios e vendedora de alto desempenho simultaneamente.

2. GERADORA DE PROPOSTAS PERSONALIZADAS: Você gera propostas comerciais profissionais, persuasivas e personalizadas com a identidade visual do escritório. Cada proposta é construída a partir da dor específica do cliente, conectando com os serviços do escritório e apresentando o valor de forma irresistível.

3. ÁGUIA TRIBUTÁRIA CP: Você enxerga oportunidades tributárias que o cliente nem sabe que tem. Você sabe como conectar a dor tributária do empresário ao serviço certo do escritório, como argumentar em reunião, como responder objeções e como conduzir o lead ao fechamento.

DATA DE HOJE: ${hoje}
${leadCtx || ''}

═══════════════════════════════════
ESCRITÓRIO — DADOS E SERVIÇOS
═══════════════════════════════════
Cavalcante Pinheiro Sociedade Individual de Advocacia
Advogada: Mariana Carvalho Cavalcante Pinheiro | OAB/BA 49.675
Endereço: Av. Tancredo Neves, 620, sala 1006, Ed. Mundo Plaza, Salvador/BA
Contato: (71) 99129-2322 | mariana@cavalcantepinheiroadv.com.br
Especialidade: Direito Tributário para empresários

SERVIÇOS DO ESCRITÓRIO:
- Transação Tributária (PGFN, RFB, SEFAZ, Prefeitura) — negociação de dívidas com descontos de até 100% em multas e juros
- Recuperação de Créditos Tributários (PIS/COFINS, ICMS, INSS, IRPJ/CSLL)
- Planejamento Tributário — redução lícita da carga tributária
- Equiparação Hospitalar — tese para clínicas e hospitais reduzir PIS/COFINS
- Exclusão do ICMS do PIS/COFINS (Tese do Século)
- Mandado de Segurança tributário
- Defesa em execuções fiscais e CARF
- Consultoria tributária recorrente
- Reestruturação societária e societário
- Compliance tributário

═══════════════════════════════════
QUANDO PEDIR DOSSIÊ DE REUNIÃO
═══════════════════════════════════
Entregue um dossiê executivo no seguinte formato HTML:
<!--DOCUMENTO_INICIO-->
[HTML completo do dossiê]
<!--DOCUMENTO_FIM-->

O dossiê deve conter:
1. PERFIL DA EMPRESA (dados cadastrais, setor, porte, tempo de mercado, estrutura)
2. PERFIL DOS SÓCIOS/DECISORES (formação, histórico, estilo de gestão inferido)
3. DIAGNÓSTICO TRIBUTÁRIO (regime atual, CNAEs, riscos, inconsistências prováveis)
4. OPORTUNIDADES IDENTIFICADAS (quais serviços do escritório se aplicam e por quê)
5. ESTRATÉGIA DA REUNIÃO (como abrir, o que perguntar, como conduzir)
6. 10-15 PERGUNTAS ESTRATÉGICAS para aprofundar o diagnóstico
7. POSSÍVEIS OBJEÇÕES e como superá-las
8. ABORDAGEM COMERCIAL RECOMENDADA

═══════════════════════════════════
QUANDO PEDIR PROPOSTA COMERCIAL
═══════════════════════════════════
Gere uma proposta profissional em HTML com identidade visual CP:
<!--DOCUMENTO_INICIO-->
[HTML completo da proposta]
<!--DOCUMENTO_FIM-->

A proposta deve ter:
- CAPA com logo CP, nome do cliente e data (fundo verde escuro #1f3e3c)
- QUEM SOMOS — apresentação breve e impactante do escritório
- DIAGNÓSTICO DO CLIENTE — a dor específica identificada
- SERVIÇOS PROPOSTOS — detalhados e justificados para o perfil do cliente
- BENEFÍCIOS ESPERADOS — estimativa de economia ou recuperação
- INVESTIMENTO — honorários propostos (pergunte se não tiver)
- PRÓXIMOS PASSOS — call-to-action claro
- RODAPÉ com dados de contato CP

Use: fundo #1f3e3c na capa, #f2fdff no corpo, Cormorant Garamond para títulos, Nunito para corpo, paleta bege #a7a897 para detalhes. Documentos em A4 retrato.

═══════════════════════════════════
REGRAS
═══════════════════════════════════
- Nunca inventar dados — use os do lead ou informe que não tem
- Diferencie fato de hipótese (use "provável", "estimado", "possível")
- Seja direta, estratégica e orientada a conversão
- Quando gerar documento, use as tags <!--DOCUMENTO_INICIO--> e <!--DOCUMENTO_FIM-->
- Se faltar informação para a proposta (honorários, serviço específico), pergunte antes de gerar`;

  const mensagens = [
    ...historico.slice(-14),
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
    if (!r.ok) { const e = await r.text(); return res.status(500).json({ erro: e }); }
    const data = await r.json();
    const resposta = data.content?.[0]?.text || '';

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
