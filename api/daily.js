import { askJson, aiEnabled } from "../lib/ai.js";
import { birthdayCharacters, streamingLinks, charFacts } from "../lib/anilist.js";
import { whereToWatch } from "../lib/tmdb.js";
import { route, clip, hexOr, EFEITOS } from "../lib/common.js";

// Personagem do dia: o aniversariante de hoje mais querido no AniList.
// A data vem do AniList (oficial); a IA só escreve a apresentação e escolhe o efeito e as cores.
export default route("GET", async (req, res) => {
  const list = await birthdayCharacters();
  if (!list.length) return res.status(200).json({ none: true });

  const { character: c, media: m } = list[0];
  const facts = charFacts(c);
  const name = c.name?.full, anime = m.title?.english || m.title?.romaji;

  let extra = {};
  if (aiEnabled()) {
    try {
      extra = await askJson(`Hoje é o aniversário oficial de ${name}, do anime ${anime} (dados do AniList). Escreva para um site de fãs de anime, público jovem, em português do Brasil.
NÃO cite datas nem o dia do aniversário no texto. Responda SOMENTE com JSON:
{"frase":"uma frase curta e animada apresentando o personagem","curiosidades":["3 curiosidades curtas e verdadeiras sobre o personagem, sem datas"],"efeito":"um destes, o que mais combina com o poder ou o estilo dele: ${EFEITOS.join(", ")}","cor1":"#RRGGBB cor principal do personagem","cor2":"#RRGGBB segunda cor"}`, { maxTokens: 700 }) || {};
    } catch (e) { console.error("IA:", e.message); }
  }
  let tmdb = null;
  try { tmdb = await whereToWatch(m); } catch {}

  // O mesmo resultado serve pra todo mundo por um tempo (economiza IA e AniList)
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  return res.status(200).json({
    personagem: name,
    nome_japones: c.name?.native || "",
    imagem: c.image?.large || null,
    url: c.siteUrl,
    anime,
    anime_romaji: m.title?.romaji,
    capa: m.coverImage?.large || null,
    anime_url: m.siteUrl,
    aniversario: facts.aniversario,
    aniversario_hoje: true,
    frase: clip(extra.frase, 200),
    curiosidades: (Array.isArray(extra.curiosidades) ? extra.curiosidades : []).slice(0, 3).map((x) => clip(x, 200)).filter((x) => !/\d{1,2} de [a-zç]+/i.test(x)),
    efeito: EFEITOS.includes(extra.efeito) ? extra.efeito : "estrelas",
    cor1: hexOr(extra.cor1, "#FF4F9A"),
    cor2: hexOr(extra.cor2, "#FFB15C"),
    watch: { tmdb, official: streamingLinks(m) },
    outros: list.slice(1, 6).map((x) => ({ personagem: x.character.name?.full, anime: x.media.title?.english || x.media.title?.romaji, imagem: x.character.image?.large || null })),
  });
});
