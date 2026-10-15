// Idioma da resposta (pt ou en). Cada pedido roda "dentro" do seu idioma, mesmo com vários pedidos ao mesmo tempo.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

export function reqLang(req) {
  let b;
  try { b = typeof req?.body === "string" ? JSON.parse(req.body || "{}").lang : req?.body?.lang; } catch {}
  return (req?.query?.lang || b) === "en" ? "en" : "pt";
}
export const currentLang = () => store.getStore() || "pt";
export const withLang = (handler) => (req, res) => store.run(reqLang(req), () => handler(req, res));
