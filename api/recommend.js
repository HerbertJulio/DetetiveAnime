import { searchAnime, recommendationsFor, popularByGenre, animeCard } from "../lib/anilist.js";
import { askJson, aiEnabled } from "../lib/ai.js";
import { route, clip } from "../lib/common.js";

export const GENEROS = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Mystery", "Sci-Fi", "Sports", "Slice of Life", "Supernatural", "Romance", "Horror", "Mecha", "Music", "Psychological"];

// O que assistir agora:
// ?busca=texto  -> animes pra escolher (sugestões)
// ?id=123       -> parecidos com esse anime, com o motivo escrito pela IA
// ?genero=Action -> os mais populares do gênero
export default route("GET", async (req, res) => {
  const q = req.query || {};
  if (q.busca) {
    const list = await searchAnime(clip(q.busca, 80));
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json({ animes: list.map(animeCard) });
  }
  if (q.genero) {
    if (!GENEROS.includes(q.genero)) return res.status(400).json({ error: "Gênero inválido." });
    const list = await popularByGenre(q.genero);
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json({ recs: list.slice(0, 12).map(animeCard) });
  }
  const id = Number(q.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Escolha um anime." });
  const found = await recommendationsFor(id);
  if (!found) return res.status(404).json({ error: "Não encontrei esse anime." });
  const base = animeCard(found.base);
  const recs = found.recs.slice(0, 8).map(animeCard);

  let motivos = {}, ok = false;
  if (aiEnabled() && recs.length) {
    const ai = await askJson(`Um jovem fã de anime (10 a 16 anos) gostou de "${base.title}" (gêneros: ${base.genres.join(", ")}).
Para cada anime abaixo, escreva UMA frase curta e empolgante em português do Brasil dizendo por que ele combina com quem gostou de "${base.title}". Sem spoilers.
${recs.map((r) => `${r.id}: ${r.title} (${r.genres.join(", ")})`).join("\n")}
Responda SOMENTE com JSON: {"motivos":{"<id>":"frase"}}`, { maxTokens: 900 }).catch((e) => { console.error("IA:", e.message); return null; });
    if (ai?.motivos) { motivos = ai.motivos; ok = true; }
  }
  res.setHeader("Cache-Control", ok || !aiEnabled() ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=300");
  return res.status(200).json({ base, recs: recs.map((r) => ({ ...r, motivo: clip(motivos[r.id] || motivos[String(r.id)], 220) })) });
});
