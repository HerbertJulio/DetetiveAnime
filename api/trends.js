import { safeChar, charactersByIds, trendingCharacters, liteCard, searchMany, normalize, titleMatches } from "../lib/anilist.js";
import { trendsEnabled, visitor, recordView, topIds, weekKey, saveRanking, communityRanking } from "../lib/trends.js";
import { readBody } from "../lib/common.js";

// GET: os mais procurados da semana aqui no site + os personagens dos animes em alta no mundo.
// POST {id}: conta uma visita a um personagem.
import { withLang } from "../lib/lang.js";

export default withLang(handler);
async function handler(req, res) {
  try {
    if (req.method === "POST" && readBody(req).tipo === "ranking") return await postRanking(req, res);
    if (req.method === "POST") {
      const id = Number(readBody(req).id);
      if (!Number.isInteger(id) || id <= 0 || id > 1e8) return res.status(400).json({ error: "Personagem inválido." });
      res.setHeader("Cache-Control", "no-store");
      if (!trendsEnabled()) return res.status(200).json({ ok: false });
      await recordView(id, visitor(req));
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "GET") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Use GET ou POST." }); }

    const [local, mundo, comunidade] = await Promise.all([
      (async () => {
        if (!trendsEnabled()) return null;
        try {
          const top = await topIds(10);
          if (!top.length) return [];
          const chars = await charactersByIds(top.map((t) => t.id));
          const byId = new Map(chars.map((c) => [c.id, c]));
          return top.filter((t) => byId.has(t.id) && safeChar(byId.get(t.id))).map((t) => liteCard(byId.get(t.id), { count: t.count }));
        } catch (e) { console.error("Tendências:", e.message); return null; }
      })(),
      trendingCharacters().then((l) => l.map(({ c, anime, animeId }) => ({ ...liteCard(c), anime, animeId }))).catch(() => []),
      (async () => {
        if (!trendsEnabled()) return null;
        try {
          const { total, top } = await communityRanking(10);
          if (!top.length) return { total, top: [] };
          const chars = await charactersByIds(top.map((t) => t.id));
          const byId = new Map(chars.map((c) => [c.id, c]));
          return { total, top: top.filter((t) => byId.has(t.id) && safeChar(byId.get(t.id))).map((t) => liteCard(byId.get(t.id), { pontos: t.pontos, listas: t.listas })) };
        } catch (e) { console.error("Ranking da comunidade:", e.message); return null; }
      })(),
    ]);

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=600");
    return res.status(200).json({ semana: weekKey(), local, mundo, comunidade });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Não consegui carregar as tendências agora." });
  }
}

// Recebe o top 10 de um navegador (nomes digitados pela pessoa) e acha cada personagem no AniList.
export function pickCharacter(list, name, anime) {
  const n = normalize(name);
  const safe = list.filter(safeChar);
  const named = safe.filter((c) => [c.name?.full, ...(c.name?.alternative || [])].some((x) => {
    const t = normalize(x);
    return t && (t.includes(n) || n.split(" ").every((w) => t.split(" ").some((p) => p.startsWith(w))));
  }));
  const pool = named.length ? named : safe;
  return (anime && pool.find((c) => (c.media?.nodes || []).some((m) => !m.isAdult && titleMatches(m, anime))))
    || [...pool].sort((a, b) => (b.favourites || 0) - (a.favourites || 0))[0] || null;
}

async function postRanking(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const b = readBody(req);
  // Um ranking por pessoa (pelo hash do IP), pra ninguém encher o ranking com várias listas.
  const client = visitor(req);
  const nomes = (Array.isArray(b.nomes) ? b.nomes : []).slice(0, 10).map((x) => ({ name: String(x?.name || "").trim().slice(0, 40), anime: String(x?.anime || "").trim().slice(0, 40) })).filter((x) => x.name);
  if (nomes.length < 3) return res.status(400).json({ error: "Coloque pelo menos 3 personagens no seu ranking." });
  if (!trendsEnabled()) return res.status(200).json({ ok: false });
  const found = [...await searchMany(nomes.slice(0, 8).map((x) => x.name)), ...(nomes.length > 8 ? await searchMany(nomes.slice(8).map((x) => x.name)) : [])];
  const ids = [];
  const achados = nomes.map((x, i) => {
    const c = pickCharacter(found[i] || [], x.name, x.anime);
    if (c && !ids.includes(c.id)) ids.push(c.id);
    return c ? { pedido: x.name, id: c.id, name: c.name?.full } : { pedido: x.name, id: null };
  });
  if (ids.length < 3) return res.status(400).json({ error: "Não encontrei os personagens do seu ranking. Confira os nomes." });
  await saveRanking(client, ids);
  return res.status(200).json({ ok: true, achados });
}
