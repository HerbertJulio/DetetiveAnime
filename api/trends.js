import { charactersByIds, trendingCharacters, liteCard } from "../lib/anilist.js";
import { trendsEnabled, recordView, topIds, weekKey } from "../lib/trends.js";
import { readBody } from "../lib/common.js";

// GET: os mais procurados da semana aqui no site + os personagens dos animes em alta no mundo.
// POST {id}: conta uma visita a um personagem.
export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const id = Number(readBody(req).id);
      if (!Number.isInteger(id) || id <= 0 || id > 1e8) return res.status(400).json({ error: "Personagem inválido." });
      res.setHeader("Cache-Control", "no-store");
      if (!trendsEnabled()) return res.status(200).json({ ok: false });
      await recordView(id);
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "GET") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Use GET ou POST." }); }

    const [local, mundo] = await Promise.all([
      (async () => {
        if (!trendsEnabled()) return null;
        try {
          const top = await topIds(10);
          if (!top.length) return [];
          const chars = await charactersByIds(top.map((t) => t.id));
          const byId = new Map(chars.map((c) => [c.id, c]));
          return top.filter((t) => byId.has(t.id)).map((t) => liteCard(byId.get(t.id), { count: t.count }));
        } catch (e) { console.error("Tendências:", e.message); return null; }
      })(),
      trendingCharacters().then((l) => l.map(({ c, anime, animeId }) => ({ ...liteCard(c), anime, animeId }))).catch(() => []),
    ]);

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=600");
    return res.status(200).json({ semana: weekKey(), local, mundo });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Não consegui carregar as tendências agora." });
  }
}
