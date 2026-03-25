const express = require("express");
const cors = require("cors");
const fs = require("fs");

const usuarios = JSON.parse(fs.readFileSync("./usuarios.json", "utf8"));

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY;

// ================= LOGIN =================
app.post("/login", (req, res) => {
  const { usuario, senha } = req.body;

  const user = usuarios.find((u) => u.usuario === usuario && u.senha === senha);

  if (user) {
    res.json({ sucesso: true, perfil: user.perfil, usuario: user.usuario });
  } else {
    res.status(401).json({ sucesso: false, mensagem: "Usuário ou senha inválidos" });
  }
});

// ================= TOKEN BLING =================
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
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "1.0",
      "enable-jwt": "1"
    },
    body: body.toString()
  });

  const data = await response.json();
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
    data = {};
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

    data = await response.json();
  }

  return { response, data, accessToken: token };
}

// ================= HELPERS =================
function normalize(v) {
  return String(v || "").trim().toLowerCase();
}

function getPossiveisGtins(obj) {
  const campos = [
    obj?.gtin,
    obj?.ean,
    obj?.codigoBarras,
    obj?.gtinEan,
    obj?.gtinTributario
  ];
  return campos.map(normalize).filter(Boolean);
}

// ================= BUSCAR =================
app.get("/buscar", async (req, res) => {
  try {
    const { key, tipo, codigo } = req.query;

    if (!key || key !== API_KEY) {
      return res.status(401).json({ ok: false, erro: "API key inválida" });
    }

    const codigoNormalizado = normalize(codigo);
    const tipoBusca = String(tipo).toUpperCase();

    const urlsBusca =
      tipoBusca === "SKU"
        ? [
            `https://api.bling.com.br/Api/v3/produtos?codigo=${codigo}`,
            `https://api.bling.com.br/Api/v3/produtos?sku=${codigo}`
          ]
        : [
            `https://api.bling.com.br/Api/v3/produtos?gtin=${codigo}`,
            `https://api.bling.com.br/Api/v3/produtos?ean=${codigo}`,
            `https://api.bling.com.br/Api/v3/produtos?codigoBarras=${codigo}`
          ];

    let produtoLista = null;
    let accessTokenAtual = process.env.BLING_ACCESS_TOKEN;

    for (const urlBusca of urlsBusca) {
      const tentativa = await blingRequest(urlBusca, {}, accessTokenAtual);
      accessTokenAtual = tentativa.accessToken;

      if (!tentativa.response.ok) continue;

      const lista = tentativa.data?.data || [];

      const encontrado = lista.find((item) => {
        if (tipoBusca === "SKU") {
          return normalize(item.codigo || item.sku) === codigoNormalizado;
        }

        const gtins = getPossiveisGtins(item);
        return gtins.includes(codigoNormalizado);
      });

      if (encontrado) {
        produtoLista = encontrado;
        break;
      }
    }

    if (!produtoLista) {
      return res.json({ ok: false, erro: "Produto não encontrado" });
    }

    const id = produtoLista.id;

    const detalhe = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos/${id}`,
      {},
      accessTokenAtual
    );

    if (!detalhe.response.ok) {
      return res.json({ ok: false, erro: "Erro ao buscar detalhe" });
    }

    const p = detalhe.data?.data || {};

    let localizacao =
      p?.estoque?.localizacao ||
      p?.localizacao ||
      p?.depositos?.[0]?.localizacao ||
      "";

    return res.json({
      ok: true,
      produto: {
        id: p.id,
        nome: p.nome,
        codigo: p.codigo,
        estoque: p.estoque?.saldoVirtualTotal || 0,
        localizacao: localizacao,
        imagem: p.imagemURL || ""
      }
    });
  } catch (error) {
    return res.json({ ok: false, erro: error.message });
  }
});

// ================= SALVAR =================
app.post("/salvar", async (req, res) => {
  try {
    const { key, codigo, novaLocalizacao } = req.body;

    if (!key || key !== API_KEY) {
      return res.status(401).json({ ok: false });
    }

    const busca = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos?codigo=${codigo}`
    );

    if (!busca.data?.data?.length) {
      return res.json({ ok: false, erro: "Produto não encontrado" });
    }

    const id = busca.data.data[0].id;

    const patch = await blingRequest(
      `https://api.bling.com.br/Api/v3/produtos/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estoque: { localizacao: novaLocalizacao }
        })
      },
      busca.accessToken
    );

    if (!patch.response.ok) {
      return res.json({ ok: false, erro: "Erro ao salvar" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.json({ ok: false, erro: error.message });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Servidor rodando");
});
