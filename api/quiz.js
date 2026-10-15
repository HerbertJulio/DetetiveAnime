import { askJson } from "../lib/ai.js";
import { findCharacter, streamingLinks, charFacts } from "../lib/anilist.js";
import { whereToWatch } from "../lib/tmdb.js";
import { readBody, clip, route, needAi, PLATAFORMAS } from "../lib/common.js";

// Resultado do teste "Qual personagem você é?".
export default route("POST", async (req, res) => {
  needAi();
  const body = readBody(req);
  const answers = (Array.isArray(body.respostas) ? body.respostas : []).slice(0, 10).map((x) => clip(x, 160)).filter(Boolean);
  if (answers.length < 3) return res.status(400).json({ error: "Responda as perguntas do teste primeiro." });

  const prompt = `Um teste de personalidade "Qual personagem de anime você é?". Respostas da pessoa:
${answers.join("\n")}
Escolha UM personagem de anime conhecido (nada de conteúdo adulto) que combine com essas respostas. Responda SOMENTE com JSON, em português do Brasil, com tom divertido:
{"personagem":"nome","nomes_busca":["nome em romaji na ordem japonesa","nome na ordem ocidental"],"anime":"nome do anime no Brasil","anime_romaji":"nome em romaji","por_que":"2-3 frases explicando por que a pessoa é esse personagem, citando as respostas","tracos":["3 traços curtos em comum"],"altura":"","criador":"autor da obra original","plataformas":["só destes: ${PLATAFORMAS.join(", ")}"]}`;

  const d = await askJson(prompt);
  if (!d?.personagem) throw Object.assign(new Error("resposta ruim"), { publicMessage: "Não consegui ver o resultado. Tente de novo." });

  // Foto e dados oficiais pelo AniList (se der)
  let hit = null;
  try { hit = await findCharacter([d.personagem, ...(Array.isArray(d.nomes_busca) ? d.nomes_busca : [])], d.anime_romaji || d.anime); } catch (e) { console.error("AniList:", e.message); }
  const c = hit?.character, m = hit?.media;
  let tmdb = null;
  try { tmdb = m ? await whereToWatch(m) : null; } catch {}

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    tracos: (Array.isArray(d.tracos) ? d.tracos : []).slice(0, 3).map((t) => clip(t, 40)),
    result: {
      source: "teste",
      character: { name: c?.name?.full || clip(d.personagem, 60), native: c?.name?.native || null, image: c?.image?.large || null, url: c?.siteUrl || null },
      anime: m
        ? { id: m.id, title: m.title?.english || m.title?.romaji, romaji: m.title?.romaji, native: m.title?.native, cover: m.coverImage?.large || null, url: m.siteUrl }
        : { title: clip(d.anime, 80), romaji: clip(d.anime_romaji || d.anime, 80), native: null, cover: null, url: null },
      confidence: 100,
      why: clip(d.por_que, 500),
      facts: { altura: clip(d.altura, 30), criador: clip(d.criador, 60), ...Object.fromEntries(Object.entries(charFacts(c)).filter(([, v]) => v)) },
      watch: {
        tmdb,
        official: m ? streamingLinks(m) : [],
        suggested: (Array.isArray(d.plataformas) ? d.plataformas : []).filter((p) => PLATAFORMAS.includes(p)),
      },
    },
  });
});
