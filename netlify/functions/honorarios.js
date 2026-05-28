exports.handler = async (event) => {
  const { mes, ano } = event.queryStringParameters || {};

  if (!mes || !ano) {
    return {
      statusCode: 400,
      body: JSON.stringify({ erro: "Informe mes e ano." })
    };
  }

  const m = String(mes).padStart(2, "0");
  const a = String(ano);
  const dataInicio = `${a}-${m}-01`;
  const ultimoDia = new Date(Number(a), Number(mes), 0).getDate();
  const dataFim = `${a}-${m}-${String(ultimoDia).padStart(2, "0")}`;

  try {
    const [pessoal, escritorio] = await Promise.all([
      buscarPagamentos(process.env.ASAAS_KEY_PESSOAL, dataInicio, dataFim),
      buscarPagamentos(process.env.ASAAS_KEY_ESCRITORIO, dataInicio, dataFim)
    ]);

    const totalHonorarios = pessoal.total + escritorio.total;

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mes: Number(mes),
        ano: Number(ano),
        periodo: `${dataInicio} a ${dataFim}`,
        pessoal,
        escritorio,
        totalHonorarios
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ erro: err.message })
    };
  }
};

async function buscarPagamentos(chave, dataInicio, dataFim) {
  if (!chave) throw new Error("Chave de API não configurada.");

  const url = `https://api.asaas.com/api/v3/payments?status=RECEIVED&paymentDate[ge]=${dataInicio}&paymentDate[le]=${dataFim}&limit=100`;

  const response = await fetch(url, {
    headers: {
      "access_token": chave,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const texto = await response.text();
    throw new Error(`Asaas retornou erro ${response.status}: ${texto}`);
  }

  const data = await response.json();
  const pagamentos = data.data || [];
  const total = pagamentos.reduce((soma, p) => soma + (p.value || 0), 0);

  return {
    total: Math.round(total * 100) / 100,
    quantidade: pagamentos.length,
    pagamentos: pagamentos.map(p => ({
      id: p.id,
      cliente: p.customerName || p.description || "Cliente",
      valor: p.value,
      dataPagamento: p.paymentDate,
      descricao: p.description || ""
    }))
  };
}
