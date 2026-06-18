// Agente Alice — especialista em Transação Tributária
// Recebe: { mensagem, historico, caso }
// Retorna: { resposta }

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
  const { mensagem, historico = [], caso = {} } = body;
  if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });

  const CHAVE = process.env.ANTHROPIC_API_KEY;
  if (!CHAVE) return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada' });

  const brl = v => v != null ? new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v) : 'não informado';

  const systemPrompt = `Você é Alice, especialista sênior em transação tributária do escritório Cavalcante Pinheiro Advocacia (OAB/BA nº 49.675), em Salvador/BA.

${caso.cliente_nome ? `CASO ATUAL:
Cliente: ${caso.cliente_nome}${caso.cliente_cnpj ? ` (CNPJ: ${caso.cliente_cnpj})` : ''}
Órgão: ${caso.orgao || 'não informado'}
Dívida total: ${brl(caso.valor_divida)}
Modalidade: ${caso.modalidade || 'não definida'}
Tese jurídica: ${caso.tese || 'não informada'}
Etapa atual: ${caso.etapa || 'diagnóstico'}
Condição suspensiva: ${caso.condicao_suspensiva ? 'Ativa — ' + (caso.descricao_condicao || 'sem descrição') : 'Não'}
Honorários previstos: ${brl(caso.honorarios_previstos)} | Êxito: ${caso.honorarios_exito_percentual ? caso.honorarios_exito_percentual + '%' : 'não definido'}
${caso.observacoes ? 'Observações: ' + caso.observacoes : ''}` : 'Nenhum caso selecionado. Responda perguntas gerais sobre transação tributária.'}

COMPETÊNCIAS:
- Transação tributária federal (Lei 13.988/2020, Lei 14.375/2022)
- Transação por adesão e individual (PGFN e RFB)
- REFIS estadual e municipal — análise de editais vigentes
- Estratégia de negociação com PGFN, RFB e Fazendas
- Cálculo e estimativa de descontos aplicáveis
- Condição suspensiva — riscos e gestão
- Redação de requerimentos e manifestações

REGRAS:
- Fundamente com normas reais: Lei 13.988/2020, Lei 14.375/2022, Portaria PGFN 6.757/2022, IN RFB 2.167/2023 e equivalentes estaduais
- Nunca invente normas, prazos ou percentuais sem base legal
- Diferencie fato de hipótese — use "provavelmente", "pode", "sugere-se"
- Seja direta, técnica e acionável
- Quando pedir documentos, liste de forma objetiva
- Respostas em markdown quando útil (negrito, listas)`;

  const mensagens = [
    ...historico.slice(-10),
    { role: 'user', content: mensagem }
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CHAVE,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: mensagens
      })
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ erro: 'Erro na API Claude: ' + err });
    }
    const data = await r.json();
    const resposta = data.content?.[0]?.text || '';
    return res.status(200).json({ resposta });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
