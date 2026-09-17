import express from "express";
import rateLimit from "express-rate-limit";

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;
const LM_URL = process.env.LM_URL || "http://127.0.0.1:1234/v1/chat/completions";
const LM_KEY = process.env.LM_KEY;
const LM_MODEL = process.env.LM_MODEL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

if (!ACCESS_CODE || !LM_KEY) {
  console.error("❌ Manque ACCESS_CODE ou LM_KEY dans les variables d'environnement.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Access-Code");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "darkgpt-proxy" });
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes, attends une minute." }
});

app.post("/chat", limiter, async (req, res) => {
  const code = req.headers["x-access-code"];
  if (!code || code !== ACCESS_CODE) {
    return res.status(401).json({ error: "Mot de passe invalide." });
  }

  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) {
    return res.status(400).json({ error: "Requête invalide." });
  }
  const totalChars = msgs.reduce((n, m) => n + (m.content?.length || 0), 0);
  if (totalChars > 60_000) {
    return res.status(413).json({ error: "Conversation trop longue." });
  }

  const safeBody = {
    ...req.body,
    model: LM_MODEL || req.body.model,
    stream: true
  };

  try {
    const upstream = await fetch(LM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + LM_KEY
      },
      body: JSON.stringify(safeBody)
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(upstream.status).send(txt);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(502).json({ error: "Erreur proxy : " + err.message });
    else res.end();
  }
});

app.listen(PORT, () => console.log(`✅ Proxy sur port ${PORT}`));
