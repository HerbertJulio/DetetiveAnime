import { findCharacter, getMedia, streamingLinks, charFacts } from "../lib/anilist.js";
import { whereToWatch } from "../lib/tmdb.js";
import { traceScene, formatTime } from "../lib/trace.js";
import { guessCharacters, aiEnabled } from "../lib/ai.js";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function mediaCard(media, fallbackName) {
  if (!media) return { id: null, title: fallbackName || "", romaji: fallbackName || "", native: null, cover: null, url: null, format: null };
  return {
    id: media.id,
    title: media.title?.english || media.title?.romaji,
    romaji: media.title?.romaji,
    native: media.title?.native,
    cover: media.coverImage?.large || null,
    url: media.siteUrl,
    format: media.format,
  };
}

import { withLang } from "../lib/lang.js";

export default withLang(handler);
async function handler(req, res) {
  try {
    return await search(req, res);
  } catch (err) {
    console.error("Falha na busca:", err);
    return res.status(500).json({ error: `Erro no servidor: ${err.message}` });
  }
}

async function search(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const description = String(body.description || "").trim().slice(0, 1000);
  let image = null;
  if (body.image?.base64) {
    if (!IMAGE_TYPES.includes(body.image.mediaType)) return res.status(400).json({ error: "Envie o print em JPG, PNG ou WebP." });
    const buffer = Buffer.from(body.image.base64, "base64");
    if (buffer.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "O print é grande demais. Tente uma imagem menor." });
    image = { base64: body.image.base64, mediaType: body.image.mediaType, buffer };
  }
  if (!description && !image) return res.status(400).json({ error: "Descreva o personagem ou envie um print." });

  const notes = [];
  const results = [];

  // 1) Print da cena -> trace.moe acha anime, episódio e minuto.
  if (image) {
    try {
      const scene = await traceScene(image.buffer, image.mediaType);
      if (scene) {
        const media = await getMedia(scene.anilistId);
        if (media && !media.isAdult) {
          results.push({
            source: "print",
            media,
            confidence: Math.round(scene.similarity * 100),
            why: "O print bate com uma cena deste anime.",
            scene: {
              episode: scene.episode,
              time: formatTime(scene.from),
              video: scene.video,
            },
          });
        }
      } else {
        notes.push("Não achei a cena exata do print. Os palpites abaixo vêm da descrição.");
      }
    } catch (e) {
      notes.push(e.code === "quota"
        ? "A busca por print atingiu o limite do mês. Usei só a descrição."
        : "A busca por print falhou agora. Usei só a descrição.");
    }
  }

  // 2) Descrição (e print) -> IA sugere personagens -> AniList confirma com foto.
  if (description || (image && !results.length)) {
    if (!aiEnabled()) {
      notes.push("A busca por descrição ainda não está configurada no servidor.");
    } else {
      try {
        const guesses = await guessCharacters(description, image);
        let anilistFailed = false;
        const found = await Promise.all(guesses.map((g) => {
          const names = [g.personagem, ...(Array.isArray(g.nomes_busca) ? g.nomes_busca : [])];
          return findCharacter(names, g.anime)
            .then((hit) => ({ g, hit }))
            .catch((err) => { console.error("AniList:", g.personagem, err.message); anilistFailed = true; return { g, hit: null }; });
        }));
        for (const { g, hit } of found) {
          if (!g.personagem) continue;
          const c = hit?.character;
          results.push({
            source: "descricao",
            character: c
              ? { id: c.id, name: c.name?.full, native: c.name?.native, image: c.image?.large || null, url: c.siteUrl }
              : { id: null, name: String(g.personagem), native: null, image: null, url: null },
            media: hit?.media || null,
            animeName: g.anime_br || g.anime,
            confidence: Math.max(0, Math.min(100, Number(g.confianca) || 0)),
            why: String(g.por_que || ""),
            sceneText: g.cena ? String(g.cena) : "",
            // Aniversário, gênero e idade vêm do AniList quando ele tem; o resto, da IA.
            facts: { altura: g.altura || "", criador: g.criador || "", ...Object.fromEntries(Object.entries(charFacts(c)).filter(([, v]) => v)) },
          });
        }
        if (anilistFailed) notes.push("Não consegui carregar as fotos de alguns personagens agora. Os palpites continuam valendo.");
      } catch (e) {
        console.error(e);
        notes.push("A IA não respondeu agora. Tente de novo em instantes.");
      }
    }
  }

  // Remove repetidos (mesmo personagem no mesmo anime).
  const seen = new Set();
  const unique = results.filter((r) => {
    const k = `${r.character?.id || r.character?.name || "scene"}:${r.media?.id || r.animeName}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 3) Onde assistir: TMDB/JustWatch no Brasil + links oficiais do AniList.
  const watchCache = new Map();
  const getWatch = (media) => {
    if (!media) return Promise.resolve(null);
    if (!watchCache.has(media.id)) watchCache.set(media.id, whereToWatch(media).catch(() => null));
    return watchCache.get(media.id);
  };

  const out = await Promise.all(unique.map(async (r) => ({
    source: r.source,
    character: r.character || null,
    anime: mediaCard(r.media, r.animeName),
    confidence: r.confidence,
    why: r.why,
    scene: r.scene || null,
    sceneText: r.sceneText || "",
    facts: r.facts || null,
    watch: {
      region: "BR",
      tmdb: await getWatch(r.media),
      official: streamingLinks(r.media),
    },
  })));

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ results: out, notes });
}
