// Coisas usadas por mais de uma rota do servidor.
export const PLATAFORMAS = ["Crunchyroll", "Netflix", "Prime Video", "Disney+", "Max", "Globoplay", "Pluto TV", "HIDIVE"];
export const EFEITOS = ["fogo", "raios", "agua", "gelo", "folhas", "petalas", "estrelas", "energia", "cortes", "vento"];

export function readBody(req) {
  if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch { return {}; } }
  return req.body || {};
}

export const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const hexOr = (c, f) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : f);

// Envolve a rota: só aceita o método certo e transforma qualquer erro em JSON legível.
export function route(method, fn) {
  return async (req, res) => {
    if (req.method !== method) { res.setHeader("Allow", method); return res.status(405).json({ error: `Use ${method}.` }); }
    try { return await fn(req, res); }
    catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.publicMessage || "Algo deu errado no servidor. Tente de novo." });
    }
  };
}

export function needAi() {
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error("sem chave"), { publicMessage: "A IA ainda não está configurada no servidor (falta a GEMINI_API_KEY ou a ANTHROPIC_API_KEY)." });
  }
}
