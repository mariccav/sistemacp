// Endpoint chamado automaticamente pelo cron toda segunda-feira às 8h
// ou manualmente pelo botão "Gerar Pauta da Semana" no dashboard
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) return res.status(500).json({ erro: "CLAUDE_API_KEY não configurada." });

  const hoje = new Date();
  const diasSemana = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

  // Calcular a semana atual (segunda a sexta)
  const diaSemana = hoje.getDay();
  const difSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const segunda = new Date(hoje); segunda.setDate(hoje.getDate() + difSegunda);
  const sexta   = new Date(segunda); sexta.setDate(segunda.getDate() + 4);

  const fmtDia = d => `${d.getDate()} de ${meses[d.getMonth()]}`;
  const semanaLabel = `${fmtDia(segunda)} a ${fmtDia(sexta)} de ${sexta.getFullYear()}`;

  // Dias com datas
  const dias = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(segunda);
    d.setDate(segunda.getDate() + i);
    dias.push({ nome: ['segunda','terça','quarta','quinta','sexta'][i], data: d.getDate(), mes: meses[d.getMonth()] });
  }

  const prompt = `Gere a pauta completa de conteúdo para o Instagram do escritório Cavalcante Pinheiro Advocacia para a semana de ${semanaLabel}.

EQUIPE:
- Mariana Pinheiro (CEO): grava Reels segunda-feira. Temas: transação tributária, ITIV, SISBAJUD, devedor contumaz.
- Diana Jordan (Coord. Jurídica): carrosséis e revisão. Grava vídeo uma quarta por mês.
- Jade Lima: publica tudo, grava uma quarta por mês.
- Laila Costa: pesquisa e grava uma quarta por mês.
- Mariana Barboza (Comercial): grava uma quarta por mês, foco em conversão.

ESTA SEMANA inclui os seguintes dias: ${dias.map(d=>`${d.nome} (dia ${d.data}/${d.mes})`).join(', ')}.

PRODUTOS: Transação Tributária, Holding, Equiparação Hospitalar, Isenção IR, ITIV, Recuperação de Créditos, Devedor Contumaz, Simples Nacional, Planejamento Tributário, TFF, Gorjetas, SISBAJUD.

FORMATO DA RESPOSTA:
Para cada dia da semana, forneça:
1. STORIES (4-6 por dia): tipo (vídeo/foto/enquete/caixinha), quem posta, roteiro detalhado com texto exato a dizer/escrever
2. POST DO FEED (se houver): tipo (Reels ou Carrossel), tema, quem grava/elabora, roteiro completo com gancho + desenvolvimento + CTA
3. Legenda completa para o post (com hashtags)

Escolha os temas da semana com base no que está mais quente em direito tributário no Brasil em 2026 (reforma tributária IBS/CBS, transação tributária, decisões recentes do STF/STJ).

Formate a resposta com emojis e separações claras por dia para facilitar a leitura pela equipe.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!r.ok) { const t = await r.text(); throw new Error(`Claude ${r.status}: ${t}`); }
    const data = await r.json();
    const pauta = data.content?.[0]?.text || 'Não foi possível gerar a pauta.';

    return res.status(200).json({
      sucesso: true,
      semana: semanaLabel,
      geradoEm: hoje.toISOString(),
      pauta
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
};
