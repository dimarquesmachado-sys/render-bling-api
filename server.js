const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

async function renovarAccessToken() {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const refreshToken = process.env.BLING_REFRESH_TOKEN;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams();
  body.append("grant_type", "refresh_token");
  body.append("refresh_token", refreshToken);

  const response = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "1.0",
      "enable-jwt": "1"
    },
    body: body.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    console.log("Erro ao renovar token:", data);
    throw new Error("Erro ao renovar token");
  }

  console.log("NOVO ACCESS TOKEN:", data.access_token);
  console.log("NOVO REFRESH TOKEN:", data.refresh_token);

  return data;
}

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY; // chave da sua extensão
const BLING_ACCESS_TOKEN = process.env.BLING_ACCESS_TOKEN; // token do Bling

app.get("/", (req, res) => {
  res.send("API Bling rodando!");
});

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

    let url = "";

    if (tipo === "SKU") {
      url = `https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(codigo)}`;
    } else if (tipo === "EAN") {
      url = `https://api.bling.com.br/Api/v3/produtos?gtin=${encodeURIComponent(codigo)}`;
    } else {
      return res.status(400).json({
        ok: false,
        erro: "Tipo inválido. Use SKU ou EAN."
      });
    }

    let accessToken = process.env.BLING_ACCESS_TOKEN;

let response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  }
});

let data = await response.json();

// Se token expirou, renova automaticamente
if (!response.ok && data?.error?.type === "invalid_token") {
  const novosTokens = await renovarAccessToken();

  accessToken = novosTokens.access_token;

  response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  data = await response.json();
}

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        erro: data?.error?.description || data?.message || "Erro ao consultar o Bling",
        retornoBling: data
      });
    }

    if (!data.data || data.data.length === 0) {
      return res.json({
        ok: false,
        erro: "Produto não encontrado"
      });
    }

    const produto = data.data[0];

    res.json({
  ok: true,
  produto: {
    nome: produto.nome || produto.descricao || "",
    codigo: produto.codigo || "",
    localizacao: produto.localizacao || "",
    estoque: produto.estoque?.saldoVirtualTotal || 0,
    imagem: produto.imagemURL || ""
  }
});

  } catch (error) {
    res.status(500).json({
      ok: false,
      erro: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
