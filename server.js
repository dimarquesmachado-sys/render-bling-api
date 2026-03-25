const express = require("express");
const cors = require("cors");

if (typeof fetch !== "function") {
  throw new Error("Fetch não está disponível neste Node. Use Node 18+ no Render.");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY;
const BLING_ACCESS_TOKEN = process.env.BLING_ACCESS_TOKEN;

// =========================
// TOKEN
// =========================
async function renovarAccessToken() {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const refreshToken = process.env.BLING_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Faltam BLING_CLIENT_ID, BLING_CLIENT_SECRET ou BLING_REFRESH_TOKEN no Render.");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams();
  body.append("grant_type", "refresh_token");
  body.append("refresh_token", refreshToken);

  const response = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "1.0",
      "enable-jwt": "1"
    },
    body: body.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    console.log("Erro ao renovar token:", data);
    throw new Error(`Erro ao renovar token: ${JSON.stringify(data)}`);
  }

  console.log("NOVO ACCESS TOKEN GERADO");
  console.log("NOVO REFRESH TOKEN GERADO");
  return data;
}

async function blingRequest(url, options = {}, accessToken = process.env.BLING_ACCESS_TOKEN) {
  let token = accessToken;

  let response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = { raw: "Resposta não JSON do Bling" };
  }

  if (!response.ok && data?.error?.type === "invalid_token") {
    const novosTokens = await renovarAccessToken();
    token = novosTokens.access_token;

    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.headers || {})
      }
    });

    try {
      data = await response.json();
    } catch {
      data = { raw: "Resposta não JSON do Bling" };
    }
  }

  return { response, data, accessToken: token };
}

// =========================
// HELPERS
// =========================
function sanitizeProdutoParaPut(produto, novaLocalizacao) {
  // Copia tudo que veio do detalhe
  const body = JSON.parse(JSON.stringify(produto || {}));

  // Remove campos normalmente somente leitura / calculados
  delete body.id;
  delete body.estoque;
  delete body.saldoEstoque;
  delete body.dataCriacao;
  delete body.dataAlteracao;
  delete body.estrutura;
  delete body.fornecedores;
  delete body.depositos;
  delete body.estoques;
  delete body.saldoVirtualTotal;
  delete body.saldoFisicoTotal;
  delete body.imagemURL; // campo de leitura; imagens devem ir nas estruturas corretas do cadastro
  delete body.variacoes;
  delete body.multilojas;

  // Atualiza só a localização
  body.localizacao = novaLocalizacao;

  return body;
}

function mapearProdutoParaPainel(produtoLista, produtoDetalhe) {
  const p = produtoDetalhe || {};
  const l = produtoLista || {};

  // -------------------------
  // IMAGEM
  // -------------------------
  let imagem = "";

  if (p.imagemURL) imagem = p.imagemURL;
  else if (l.imagemURL) imagem = l.imagemURL;
  else if (Array.isArray(p.imagensExternas) && p.imagensExternas.length > 0) {
    imagem = p.imagensExternas[0]?.link || p.imagensExternas[0]?.url || "";
  } else if (Array.isArray(l.imagensExternas) && l.imagensExternas.length > 0) {
    imagem = l.imagensExternas[0]?.link || l.imagensExternas[0]?.url || "";
  } else if (Array.isArray(p.imagens) && p.imagens.length > 0) {
    imagem = p.imagens[0]?.link || p.imagens[0]?.url || "";
  } else if (Array.isArray(l.imagens) && l.imagens.length > 0) {
    imagem = l.imagens[0]?.link || l.imagens[0]?.url || "";
  }

  // -------------------------
  // LOCALIZAÇÃO
  // -------------------------
  let localizacao = p.localizacao || l.localizacao || "";

  // fallback para campo customizado "Endereço"
  if (!localizacao && Array.isArray(p.camposCustomizados)) {
    const campoEndereco = p.camposCustomizados.find(c =>
      (c.item || "").toLowerCase().trim() === "endereço" ||
      (c.item || "").toLowerCase().trim() === "endereco"
    );

    if (campoEndereco && campoEndereco.valor) {
      localizacao = campoEndereco.valor;
    }
  }

  return {
    id: p.id || l.id || null,
    nome: p.nome || p.descricao || l.nome || l.descricao || "",
    codigo: p.codigo || l.codigo || "",
    localizacao,
    estoque: p.estoque?.saldoVirtualTotal || l.estoque?.saldoVirtualTotal || 0,
    imagem
  };
}

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.send("API Bling rodando!");
});

// =========================
// BUSCAR PRODUTO
// =========================
app.get("/buscar", async (req, res) => {
  try {
    const { key, tipo, codigo } = req.query;

    if (!key || key !== API_KEY) {
      return res.status(401).json({
        ok: false,
        erro: "Acesso negado. API key inválida."
      });
    }

    if (!tipo || !codigo) {
      return res.status(400).json({
        ok: false,
        erro: "Parâmetros tipo e codigo são obrigatórios."
      });
    }

    let urlBusca = "";

    if (tipo === "SKU") {
      urlBusca = `https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(codigo)}`;
    } else if (tipo === "EAN") {
      urlBusca = `https://api.bling.com.br/Api/v3/produtos?gtin=${encodeURIComponent(codigo)}`;
    } else {
      return res.status(400).json({
        ok: false,
        erro: "Tipo inválido. Use SKU ou EAN."
      });
    }

    const busca = await blingRequest(urlBusca);

    if (!busca.response.ok) {
      return res.status(busca.response.status).json({
        ok: false,
        erro: busca.data?.error?.description || busca.data?.message || "Erro ao consultar o Bling",
        retornoBling: busca.data
      });
    }

    if (!busca.data?.data || busca.data.data.length === 0) {
      return res.json({
        ok: false,
        erro: "Produto não encontrado"
      });
    }

    const produtoLista = busca.data.data[0];
    const id = produtoLista.id;

    const detalhe = await blingRequest(`https://api.bling.com.br/Api/v3/produtos/${id}`, {}, busca.accessToken);

    if (!detalhe.response.ok) {
      return res.status(detalhe.response.status).json({
        ok: false,
        erro: detalhe.data?.error?.description || detalhe.data?.message || "Erro ao consultar detalhe do produto",
        retornoBling: detalhe.data
      });
    }

    const produtoDetalhe = detalhe.data?.data || {};
    const produto = mapearProdutoParaPainel(produtoLista, produtoDetalhe);

    return res.json({
  ok: true,
  produto,
  debug: {
    produtoLista,
    produtoDetalhe
  }
});

  } catch (error) {
    console.error("Erro /buscar:", error);
    return res.status(500).json({
      ok: false,
      erro: error.message
    });
  }
});

// =========================
// SALVAR NOVA LOCALIZAÇÃO
// =========================
app.post("/salvar", async (req, res) => {
  try {
    const { key, codigo, novaLocalizacao } = req.body || {};

    if (!key || key !== API_KEY) {
      return res.status(401).json({
        ok: false,
        erro: "Acesso negado. API key inválida."
      });
    }

    if (!codigo || !novaLocalizacao) {
      return res.status(400).json({
        ok: false,
        erro: "Código e nova localização são obrigatórios."
      });
    }

    // 1) Busca produto por código
    const busca = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(codigo)}`
    );

    if (!busca.response.ok || !busca.data?.data?.length) {
      return res.status(404).json({
        ok: false,
        erro: "Produto não encontrado.",
        retornoBling: busca.data
      });
    }

    const id = busca.data.data[0].id;

    // 2) Busca detalhe completo
    const detalhe = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos/${id}`,
      {},
      busca.accessToken
    );

    if (!detalhe.response.ok || !detalhe.data?.data) {
      return res.status(404).json({
        ok: false,
        erro: "Erro ao buscar detalhe completo do produto.",
        retornoBling: detalhe.data
      });
    }

    const produtoCompleto = detalhe.data.data;

    // 3) Preserva o máximo possível e altera só localizacao
    const body = sanitizeProdutoParaPut(produtoCompleto, novaLocalizacao);

    // 4) PUT
    const putResp = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos/${id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      detalhe.accessToken
    );

    if (!putResp.response.ok) {
      return res.status(putResp.response.status).json({
        ok: false,
        erro: "Erro ao salvar localização no Bling.",
        retornoBling: putResp.data,
        bodyEnviado: body
      });
    }

    // 5) Lê de novo para confirmar
    const confirmacao = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos/${id}`,
      {},
      putResp.accessToken
    );

    const produtoFinal = mapearProdutoParaPainel(busca.data.data[0], confirmacao.data?.data || produtoCompleto);

    return res.json({
      ok: true,
      mensagem: "Localização salva com sucesso.",
      produto: produtoFinal
    });

  } catch (error) {
    console.error("Erro /salvar:", error);
    return res.status(500).json({
      ok: false,
      erro: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
