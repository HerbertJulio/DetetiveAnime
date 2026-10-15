import { getCharacterFull, mediaCast, charFacts, cleanDescription, descriptionFacts, streamingLinks } from "../lib/anilist.js";
import { askJson, aiEnabled } from "../lib/ai.js";
import { whereToWatch } from "../lib/tmdb.js";
import { route, clip, hexOr } from "../lib/common.js";

const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean).slice(0, n);

// Página do personagem: dados oficiais do AniList + ficha escrita pela IA (poderes, personalidade, frases e curiosidades).
export default route("GET", async (req, res) => {
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Personagem inválido." });

  const full = await getCharacterFull(id);
  if (!full || !full.main) return res.status(404).json({ error: "Não encontrei esse personagem." });
  const { character: c, main, works } = full;

  const name = c.name?.full || "";
  const anime = main.title?.english || main.title?.romaji || "";
  const raw = String(c.description || "");
  const dfacts = descriptionFacts(raw);

  const [cast, tmdb, ai] = await Promise.all([
    mediaCast(main.id, c.id).catch(() => []),
    whereToWatch(main).catch(() => null),
    aiEnabled()
      ? askJson(`Você escreve fichas de personagens de anime para um site brasileiro de fãs, para jovens de 10 a 16 anos.
Personagem: ${name}${c.name?.native ? ` (${c.name.native})` : ""}, do anime ${anime}. Outros nomes: ${(c.name?.alternative || []).join(", ") || "nenhum"}.
Informações do AniList (em inglês, podem ter spoilers): """${cleanDescription(raw).slice(0, 1800)}"""
Responda SOMENTE com JSON:
{"resumo":"2 frases apresentando o personagem, sem spoilers grandes","apelidos":["apelidos e títulos conhecidos"],"organizacao":"grupo, clã, escola, time ou organização dele (ou vazio)","poderes":[{"nome":"nome do poder, técnica ou habilidade","descricao":"1 frase simples"}],"personalidade":"3 ou 4 frases sobre o jeito dele","tracos":["4 a 6 palavras curtas sobre a personalidade"],"frases":["até 3 falas marcantes e curtas dele, traduzidas para o português"],"curiosidades":["4 curiosidades curtas e verdadeiras"],"altura":"ex. 1,90 m, ou vazio","criador":"autor da obra original","cor1":"#RRGGBB cor que lembra o personagem","cor2":"#RRGGBB segunda cor"}
Regras: português do Brasil. Nada de conteúdo adulto nem violência pesada. Não invente: se não tiver certeza, deixe de fora. Até 6 poderes.`, { maxTokens: 1600 }).catch((e) => { console.error("IA:", e.message); return null; })
      : Promise.resolve(null),
  ]);

  const p = ai || {};
  const f = charFacts(c);
  // Ficha completa fica guardada uma semana; sem a parte da IA, só 5 minutos (pra tentar de novo logo).
  res.setHeader("Cache-Control", ai ? "public, s-maxage=604800, stale-while-revalidate=86400" : "public, s-maxage=300");
  return res.status(200).json({
    id: c.id,
    name,
    native: c.name?.native || "",
    alternative: (c.name?.alternative || []).filter(Boolean).slice(0, 6),
    image: c.image?.large || null,
    url: c.siteUrl,
    favourites: c.favourites || 0,
    anime: { id: main.id, title: anime, romaji: main.title?.romaji, native: main.title?.native, cover: main.coverImage?.large || null, url: main.siteUrl },
    works: works.slice(0, 8).map((w) => ({ id: w.media.id, title: w.media.title?.english || w.media.title?.romaji, type: w.media.type, cover: w.media.coverImage?.large || null, role: w.role, year: w.media.startDate?.year || null })),
    facts: { aniversario: f.aniversario, idade: f.idade, genero: f.genero, altura: clip(p.altura, 30) || dfacts.height, criador: clip(p.criador, 60) },
    ai: Boolean(ai),
    resumo: clip(p.resumo, 400),
    apelidos: list(p.apelidos, 6, 50),
    organizacao: clip(p.organizacao, 80) || dfacts.affiliation,
    poderes: (Array.isArray(p.poderes) ? p.poderes : []).filter((x) => x?.nome).slice(0, 6).map((x) => ({ nome: clip(x.nome, 60), descricao: clip(x.descricao, 220) })),
    personalidade: clip(p.personalidade, 700),
    tracos: list(p.tracos, 6, 24),
    frases: list(p.frases, 3, 160),
    curiosidades: list(p.curiosidades, 5, 240),
    cor1: hexOr(p.cor1, null),
    cor2: hexOr(p.cor2, null),
    related: cast.slice(0, 12).map((e) => ({ id: e.node.id, name: e.node.name?.full, image: e.node.image?.large || e.node.image?.medium || null, role: e.role })),
    watch: { tmdb, official: streamingLinks(main) },
  });
});
