const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();

app.use(cors());

const PORT = process.env.PORT || 10000;
const BLING_API_KEY = process.env.BLING_API_KEY;

app.get("/", (req, res) => {
  res.send("API Bling rodando!");
});

app.get("/buscar", async (req, res) => {
  try {
    const { key, tipo, codigo } = req.query;

    if (key !== BLING_API_KEY) {
      return res.status(403).json({ error: "API key inválida" });
    }

    let url = "";

    if (tipo === "SKU") {
      url = `https://api.bling.com.br/Api/v3/produtos?codigo=${codigo}`;
    } else if (tipo === "EAN") {
      url = `https://api.bling.com.br/Api/v3/produtos?gtin=${codigo}`;
    } else {
      return res.status(400).json({ error: "Tipo inválido" });
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BLING_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!data || !data.data || data.data.length === 0) {
      return res.json({ error: "Produto não encontrado" });
    }

    const produto = data.data[0];

    res.json({
      descricao: produto.descricao,
      codigo: produto.codigo,
      localizacao: produto.localizacao || "",
      saldo: produto.estoque?.saldoVirtualTotal || 0,
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
