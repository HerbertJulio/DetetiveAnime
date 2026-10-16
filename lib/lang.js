// Idioma da resposta (pt ou en). Cada pedido roda "dentro" do seu idioma, mesmo com vários pedidos ao mesmo tempo.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

export function reqLang(req) {
  let b;
  try { b = typeof req?.body === "string" ? JSON.parse(req.body || "{}").lang : req?.body?.lang; } catch {}
  return (req?.query?.lang || b) === "en" ? "en" : "pt";
}
export const currentLang = () => store.getStore() || "pt";

// Freio simples contra quem tenta mandar pedidos sem parar (gastando a IA e o AniList):
// cada IP pode fazer até LIMIT pedidos por minuto em cada servidor ligado.
const LIMIT = 90, hits = new Map();
export function tooMany(req, now = Date.now()) {
  const h = req?.headers || {};
  const ip = String(h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0] || "").trim();
  if (!ip) return false;
  const e = hits.get(ip);
  if (!e || now - e.t > 60000) { hits.set(ip, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  return ++e.n > LIMIT;
}

export const withLang = (handler) => (req, res) => {
  if (tooMany(req)) {
    res.setHeader("Retry-After", "60");
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).json({ error: reqLang(req) === "en" ? "Too many requests. Wait a minute and try again." : "Muitos pedidos seguidos. Espere um minutinho e tente de novo." });
  }
  return store.run(reqLang(req), () => handler(req, res));
};
