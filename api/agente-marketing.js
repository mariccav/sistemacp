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

  // ─── Tools ─────────────────────────────────────────────────────────────────

  const tools = [
    {
      name: "buscar_noticias_tributarias",
      description: "Busca notícias e decisões recentes sobre direito tributário no Brasil: STF, STJ, Receita Federal, reforma tributária, PGFN. Use para identificar temas quentes da semana.",
      input_schema: {
        type: "object",
        properties: {
          tema: { type: "string", description: "Tema específico a pesquisar (ex: 'transação tributária 2026', 'IBS CBS reforma')" },
          tipo: { type: "string", enum: ["stf", "stj", "receita", "reforma", "geral"], description: "Tipo de fonte a priorizar" }
        },
        required: ["tema"]
      }
    },
    {
      name: "analisar_concorrente",
      description: "Analisa a estratégia de conteúdo de um perfil concorrente no Instagram tributário.",
      input_schema: {
        type: "object",
        properties: {
          perfil: {
            type: "string",
            enum: ["fernanda_nogueira", "talitaritz", "nogueirareisadvogados"],
            description: "Perfil a analisar"
          },
          foco: { type: "string", description: "Aspecto a analisar: temas recentes, formato de stories, CTAs, frequência, etc." }
        },
        required: ["perfil"]
      }
    },
    {
      name: "gerar_roteiro_video",
      description: "Gera um roteiro completo de Reels para um tema específico, adaptado à pessoa que vai gravar.",
      input_schema: {
        type: "object",
        properties: {
          tema: { type: "string", description: "Tema do vídeo (ex: 'Transação tributária', 'ITIV', 'Devedor contumaz')" },
          apresentador: {
            type: "string",
            enum: ["Mariana Pinheiro", "Diana Jordan", "Jade Lima", "Laila Costa", "Mariana Barboza"],
            description: "Quem vai gravar"
          },
          duracao: { type: "string", enum: ["30s", "60s", "90s"], description: "Duração do vídeo" },
          objetivo: { type: "string", enum: ["autoridade", "educacao", "conversao", "viral"], description: "Objetivo principal do vídeo" }
        },
        required: ["tema", "apresentador"]
      }
    },
    {
      name: "gerar_pauta_semanal",
      description: "Gera a pauta completa de conteúdo para uma semana inteira: stories diários, 2 Reels, 1 carrossel, com roteiros detalhados.",
      input_schema: {
        type: "object",
        properties: {
          semana: { type: "string", description: "Semana de referência (ex: '23 a 27 de junho de 2026')" },
          tema_principal: { type: "string", description: "Tema âncora da semana (ex: 'Transação tributária')" },
          tema_secundario: { type: "string", description: "Tema secundário da semana" },
          novidade_semana: { type: "string", description: "Novidade tributária específica que aconteceu na semana (opcional)" }
        },
        required: ["semana", "tema_principal"]
      }
    },
    {
      name: "gerar_legenda_instagram",
      description: "Gera uma legenda completa para Instagram (post, reels ou carrossel) com hashtags e CTA.",
      input_schema: {
        type: "object",
        properties: {
          tema: { type: "string", description: "Tema do post" },
          tipo: { type: "string", enum: ["reels", "carrossel", "foto"], description: "Tipo de post" },
          tom: { type: "string", enum: ["educativo", "urgente", "humanizado", "comercial"], description: "Tom desejado" },
          produto_cta: { type: "string", description: "Produto ou serviço para chamar na CTA (opcional)" }
        },
        required: ["tema", "tipo"]
      }
    },
    {
      name: "gerar_stories_semana",
      description: "Gera o roteiro detalhado de stories para cada dia da semana, com texto de legenda, tipo de mídia (vídeo/foto/enquete) e quem posta.",
      input_schema: {
        type: "object",
        properties: {
          tema_semana: { type: "string", description: "Tema principal da semana" },
          dias: { type: "number", description: "Quantidade de dias a gerar (padrão 5)" }
        },
        required: ["tema_semana"]
      }
    },
    {
      name: "salvar_posts_calendario",
      description: "Registra posts sugeridos no calendário de redes sociais. Use SEMPRE que sugerir uma pauta ou posts específicos com datas definidas. Cada post deve ter data, formato, responsável e tema. Permite que a usuária salve as sugestões com um clique.",
      input_schema: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            description: "Lista de posts a salvar no calendário",
            items: {
              type: "object",
              properties: {
                data_publicacao: { type: "string", description: "Data no formato YYYY-MM-DD" },
                formato: { type: "string", enum: ["reels", "carrossel", "story"], description: "Formato do post" },
                responsavel: { type: "string", description: "Nome da responsável pelo post" },
                tema: { type: "string", description: "Tema ou título do post" },
                prazo_gravacao: { type: "string", description: "Data limite para gravar/finalizar (YYYY-MM-DD), se aplicável" },
                observacoes: { type: "string", description: "Notas adicionais, roteiro resumido, etc." }
              },
              required: ["data_publicacao", "formato", "responsavel", "tema"]
            }
          }
        },
        required: ["posts"]
      }
    }
  ];

  // ─── System prompt ─────────────────────────────────────────────────────────

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const system = `Você é o Agente de Marketing Digital da Cavalcante Pinheiro Advocacia — escritório de Direito Tributário fundado por Mariana Pinheiro (OAB/BA nº 49.675), em Salvador/BA.

DATA HOJE: ${hoje}

SUA MISSÃO: Gerar conteúdo estratégico e pronto para o Instagram, seguindo rigorosamente as regras definidas pelo escritório. Qualquer sugestão de pauta ou calendário DEVE respeitar estas regras sem exceção.

━━━━━━━━━━━ EQUIPE E PAPÉIS ━━━━━━━━━━━
• Mariana Pinheiro (CEO/Fundadora): grava Reels toda SEGUNDA-FEIRA para o post daquela semana. Aprova todos os posts antes da publicação. Seu tempo é limitado — demandas de conteúdo para ela devem ser simples, rápidas e de alto impacto.
• Diana (Coord. Jurídica): elabora e faz o design de TODOS os carrosséis. Grava vídeo uma quarta-feira por mês (no rodízio). Faz revisão jurídica.
• Jade (Gestão de Mídia): gerencia toda publicação e edição. Grava vídeo uma quarta-feira por mês (no rodízio).
• Laila Costa: grava vídeo uma quarta-feira por mês (no rodízio). Auxilia na pesquisa de temas.
• Mariana Barboza (Comercial): grava vídeo uma quarta-feira por mês (no rodízio). Foco em abordagem comercial.

━━━━━━━━━━━ ESTRUTURA FIXA DE POSTAGENS ━━━━━━━━━━━
SEGUNDA-FEIRA → Reels (SEMPRE Mariana Pinheiro — sem exceção)
QUARTA-FEIRA → Carrossel (SEMPRE Diana — elaboração e design)
SEGUNDA, TERÇA e QUINTA → Story (responsável rotaciona semanalmente)

PROIBIDO: Não existe "rodízio de sextas". Nunca use essa expressão. Sexta-feira não é dia fixo de postagem.

Vídeos das demais colaboradoras (Laila, Jade, M.Barboza, Diana) são postados conforme planejamento mensal, sem dia fixo de semana — o dia de gravação na quarta não precisa coincidir com o dia de postagem.

━━━━━━━━━━━ RODÍZIO DE GRAVAÇÃO (quartas-feiras) ━━━━━━━━━━━
Cada uma grava UMA quarta por mês, em rodízio fixo nesta ordem:
Mariana Barboza → Laila Costa → Jade → Diana

━━━━━━━━━━━ RODÍZIO DE STORIES (semanal) ━━━━━━━━━━━
Os 3 stories da semana (segunda, terça, quinta) têm uma responsável única que rotaciona semanalmente entre:
Laila Costa → Diana → Mariana Barboza → Jade → (recomeça)

━━━━━━━━━━━ REGRA DO FEED ━━━━━━━━━━━
NUNCA deixar 3 vídeos seguidos no feed sem um carrossel ou conteúdo visual diferente entre eles.

━━━━━━━━━━━ FERIADOS ━━━━━━━━━━━
• Conteúdo NUNCA é cancelado — apenas reorganizado para outra data.
• Se a quarta-feira for feriado, o carrossel pode ser postado na sexta daquela semana (exceção única para não deixar 3 vídeos seguidos).
• Vídeos afetados por feriado: empurrar para próxima data disponível compatível.

━━━━━━━━━━━ CHECKLIST DE PRODUÇÃO ━━━━━━━━━━━
Antes de qualquer post ser publicado, verificar:
1. Roteiro elaborado
2. Foto de capa do Reels tirada
3. Legenda completa escrita
4. Conteúdo enviado para Jade (AirDrop)

━━━━━━━━━━━ BANCO DE TEMAS ━━━━━━━━━━━
Transação tributária, Holding, Equiparação hospitalar, Isenção IR, ITIV, Recuperação de créditos, Devedor contumaz, Simples nacional, Planejamento tributário, TFF, Gorjetas

━━━━━━━━━━━ PRODUTOS DO ESCRITÓRIO ━━━━━━━━━━━
• Transação Tributária (produto âncora 2026 — prioridade máxima)
• Holding Patrimonial
• Equiparação Hospitalar
• Isenção IR (portadores de doenças graves)
• ITIV (imposto sobre transmissão de imóveis em Salvador/BA)
• Recuperação de Créditos Tributários
• Devedor Contumaz
• Simples Nacional
• Planejamento Tributário
• TFF (Taxa de Fiscalização e Funcionamento)
• Gorjetas (tributação)

━━━━━━━━━━━ PERFIS DE REFERÊNCIA ━━━━━━━━━━━
• @fernanda_nogueira — 75k seg. Tributária + Equiparação. Carrosséis educativos longos, linguagem do empresário, prova social frequente.
• @talitaritz — 87k seg. Recuperação tributária. Números de impacto, stories interativos, Tax Day.
• @nogueirareisadvogados — escritório, voz institucional com humanização da equipe.

━━━━━━━━━━━ COMO AGIR ━━━━━━━━━━━
• Ao gerar pauta semanal ou mensal: use a ferramenta salvar_posts_calendario com TODOS os posts sugeridos antes de escrever o texto de resposta. Isso permite que a usuária salve tudo com um clique.
• Ao sugerir posts individuais com data definida: use salvar_posts_calendario.
• Ao sugerir carrossel: sempre atribuir à Diana.
• Ao sugerir Reels de segunda: sempre atribuir à Mariana Pinheiro.
• Ao sugerir stories: indicar a responsável da semana conforme o rodízio.
• Roteiros: gere COMPLETO com timing, texto, dica de gravação e legenda.
• Legendas: gancho forte + conteúdo + hashtags (15-20) + CTA específico.
• Linguagem: clara, direta, sem juridiquês. Fale para o empresário.
• Sempre conecte o conteúdo a um produto real do escritório.`;

  // ─── Execução das ferramentas ─────────────────────────────────────────────

  async function executarFerramenta(nome, input) {
    const SERPER_KEY = process.env.SERPER_API_KEY;

    if (nome === 'buscar_noticias_tributarias') {
      const { tema, tipo = 'geral' } = input;
      if (!SERPER_KEY) {
        // Sem Serper, Claude usa seu conhecimento
        return {
          fonte: 'conhecimento_interno',
          aviso: 'Sem SERPER_API_KEY configurada. Usando conhecimento interno do modelo.',
          consulta: tema
        };
      }
      try {
        const q = `${tema} direito tributário Brasil 2026 ${tipo !== 'geral' ? tipo.toUpperCase() : ''}`.trim();
        const r = await fetch('https://google.serper.dev/news', {
          method: 'POST',
          headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, gl: 'br', hl: 'pt', num: 5 })
        });
        const data = await r.json();
        return {
          resultados: (data.news || []).map(n => ({
            titulo: n.title,
            fonte: n.source,
            data: n.date,
            resumo: n.snippet,
            link: n.link
          }))
        };
      } catch (err) {
        return { erro: err.message };
      }
    }

    if (nome === 'analisar_concorrente') {
      const { perfil, foco = 'estratégia geral' } = input;
      const perfis = {
        fernanda_nogueira: {
          nome: 'Fernanda Nogueira',
          seguidores: '75k',
          nicho: 'Tributário + Educação + Saúde (equiparação)',
          pontos_fortes: ['Linguagem extremamente acessível', 'Carrosséis com 10+ slides educativos', 'Prova social frequente', 'Tese de equiparação hospitalar como produto âncora', 'Stories de bastidores reais'],
          frequencia: '5-7 stories/dia + 4-5 posts/semana',
          formatos_top: ['Carrossel "X coisas que você não sabia sobre [tributo]"', 'Reels "Em quanto tempo recupero X?"', 'Stories com caixinha de perguntas toda semana'],
          cta_padrao: 'Diagnóstico gratuito via DM ou link na bio',
          oportunidades_cp: 'Imitar a frequência de carrosséis educativos + adotar caixinha de perguntas semanal'
        },
        talitaritz: {
          nome: 'Talita Ritz',
          seguidores: '87k',
          nicho: 'Recuperação tributária + Mentoria para advogados',
          pontos_fortes: ['Números de impacto ("R$950M recuperados")', 'Conteúdo para advogados e para empresários', 'Tax Day (evento próprio)', 'Stories de resultados frequentes', 'Reels de "qual tipo de advogado você é?" (alta viralização)'],
          frequencia: '6-8 stories/dia + 3-4 posts/semana',
          formatos_top: ['Reels de quiz/identidade ("Qual advogado você é?")', 'Carrossel "STF decidiu X — o que isso significa para você?"', 'Stories de bastidores de evento'],
          cta_padrao: 'Mentoria individual ou coletiva, Tax Day',
          oportunidades_cp: 'Criar conteúdo de atualização STF/STJ no mesmo dia da decisão + humanizar com bastidores reais da Mariana'
        },
        nogueirareisadvogados: {
          nome: 'Nogueira Reis Advogados',
          seguidores: 'Escritório médio porte',
          nicho: 'Escritório tributário institucional',
          pontos_fortes: ['Voz de equipe (não só uma pessoa)', 'Posts sobre jurisprudência', 'Humanização da equipe nos stories'],
          frequencia: '3-5 stories/dia + 2-3 posts/semana',
          formatos_top: ['Apresentação de cada membro da equipe', 'Posts de "Saiu a decisão do STF sobre X"', 'Stories de aniversário de colaboradores'],
          cta_padrao: 'Consulta especializada',
          oportunidades_cp: 'Já fazem o que o CP fará — vantagem do CP é ter a Mariana como figura pública reconhecida na área'
        }
      };
      return perfis[perfil] || { erro: 'Perfil não encontrado' };
    }

    // Ferramentas que Claude executa sem chamada externa — retornam contexto para o modelo gerar
    if (nome === 'gerar_roteiro_video') {
      return { instrucao: 'Use o contexto abaixo para gerar um roteiro completo e detalhado.', input };
    }
    if (nome === 'gerar_pauta_semanal') {
      return { instrucao: 'Gere a pauta semanal completa com base no contexto fornecido.', input };
    }
    if (nome === 'gerar_legenda_instagram') {
      return { instrucao: 'Gere a legenda completa com gancho, desenvolvimento, hashtags e CTA.', input };
    }
    if (nome === 'gerar_stories_semana') {
      return { instrucao: 'Gere o roteiro de stories dia a dia com quem posta, o quê e como.', input };
    }

    if (nome === 'salvar_posts_calendario') {
      // Retorna os posts estruturados — o frontend exibe botão "Salvar no calendário"
      return {
        status: 'pronto_para_salvar',
        posts: input.posts,
        mensagem: `${input.posts.length} post(s) prontos para salvar no calendário.`
      };
    }

    return { erro: `Ferramenta desconhecida: ${nome}` };
  }

  // ─── Loop do agente ────────────────────────────────────────────────────────

  const mensagens = [
    ...historico.slice(-16),
    { role: 'user', content: mensagem }
  ];

  try {
    let resposta = await chamarClaude(CLAUDE_KEY, system, mensagens, tools);
    let iter = 0;

    while (resposta.stop_reason === 'tool_use' && iter < 5) {
      iter++;
      const tus = resposta.content.filter(b => b.type === 'tool_use');
      const results = [];
      for (const tu of tus) {
        const r = await executarFerramenta(tu.name, tu.input);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r) });
      }
      mensagens.push({ role: 'assistant', content: resposta.content });
      mensagens.push({ role: 'user', content: results });
      resposta = await chamarClaude(CLAUDE_KEY, system, mensagens, tools);
    }

    const texto = resposta.content.find(b => b.type === 'text')?.text || 'Não consegui processar. Tente novamente.';

    // Coletar posts sugeridos de todas as chamadas à ferramenta salvar_posts_calendario
    const postsSugeridos = [];
    for (const msg of mensagens) {
      if (Array.isArray(msg.content)) {
        for (const bloco of msg.content) {
          if (bloco.type === 'tool_result') {
            try {
              const resultado = JSON.parse(bloco.content);
              if (resultado.status === 'pronto_para_salvar' && Array.isArray(resultado.posts)) {
                postsSugeridos.push(...resultado.posts);
              }
            } catch {}
          }
        }
      }
    }

    return res.status(200).json({ resposta: texto, posts_sugeridos: postsSugeridos });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
};

async function chamarClaude(apiKey, system, messages, tools) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system,
      messages,
      tools
    })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Claude ${r.status}: ${t}`); }
  return r.json();
}
