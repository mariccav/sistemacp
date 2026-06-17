module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const token  = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!token || !userId) {
    return res.status(200).json({
      configurado: false,
      instrucoes: [
        "1. Acesse developers.facebook.com e crie um App (tipo: Business)",
        "2. Adicione o produto 'Instagram Graph API'",
        "3. Conecte sua conta Instagram Business à Página do Facebook",
        "4. Gere um User Access Token com permissões: instagram_basic, instagram_manage_insights, pages_show_list",
        "5. Troque por um Long-Lived Token (válido 60 dias)",
        "6. No Vercel, vá em Settings > Environment Variables e adicione:",
        "   INSTAGRAM_ACCESS_TOKEN = <seu token>",
        "   INSTAGRAM_USER_ID = <id numérico da conta Instagram>",
        "7. Para encontrar o User ID: GET https://graph.facebook.com/v18.0/me/accounts?access_token=SEU_TOKEN"
      ]
    });
  }

  try {
    // Dados básicos do perfil
    const profileR = await fetch(
      `https://graph.facebook.com/v18.0/${userId}?fields=followers_count,media_count,name,biography,website&access_token=${token}`
    );
    const profile = await profileR.json();

    if (profile.error) {
      return res.status(200).json({ configurado: false, erro: profile.error.message });
    }

    // Mídias recentes
    const mediaR = await fetch(
      `https://graph.facebook.com/v18.0/${userId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=12&access_token=${token}`
    );
    const mediaData = await mediaR.json();
    const posts = mediaData.data || [];

    // Engajamento médio
    let engMedio = 0;
    if (posts.length > 0) {
      const totalEng = posts.reduce((s, p) => s + (p.like_count || 0) + (p.comments_count || 0), 0);
      engMedio = Math.round(totalEng / posts.length);
    }

    // Taxa de engajamento (engajamento / seguidores * 100)
    const taxaEng = profile.followers_count > 0
      ? ((engMedio / profile.followers_count) * 100).toFixed(2)
      : '0.00';

    // Insights (requer instagram_manage_insights)
    let insights = { alcance: null, impressoes: null, visitas: null };
    try {
      const insR = await fetch(
        `https://graph.facebook.com/v18.0/${userId}/insights?metric=reach,impressions,profile_views&period=week&access_token=${token}`
      );
      const insData = await insR.json();
      if (!insData.error && insData.data) {
        insData.data.forEach(m => {
          if (m.name === 'reach')         insights.alcance    = m.values?.[1]?.value;
          if (m.name === 'impressions')   insights.impressoes = m.values?.[1]?.value;
          if (m.name === 'profile_views') insights.visitas    = m.values?.[1]?.value;
        });
      }
    } catch {}

    // Contagem por tipo de mídia
    const tipoCount = posts.reduce((acc, p) => {
      acc[p.media_type] = (acc[p.media_type] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      configurado: true,
      seguidores:   profile.followers_count,
      totalPosts:   profile.media_count,
      nome:         profile.name,
      engMedioPost: engMedio,
      taxaEngajamento: taxaEng + '%',
      insights,
      reels:      tipoCount['VIDEO'] || 0,
      carrosseis: tipoCount['CAROUSEL_ALBUM'] || 0,
      imagens:    tipoCount['IMAGE'] || 0,
      postagens:  posts.map(p => ({
        id:         p.id,
        tipo:       p.media_type,
        legenda:    (p.caption || '').substring(0, 120),
        curtidas:   p.like_count || 0,
        comentarios:p.comments_count || 0,
        data:       p.timestamp?.substring(0, 10)
      }))
    });

  } catch (err) {
    return res.status(500).json({ configurado: false, erro: err.message });
  }
};
