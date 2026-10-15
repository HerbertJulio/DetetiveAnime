import { airingSchedule, streamingLinks } from "../lib/anilist.js";
import { route } from "../lib/common.js";

// Calendário da temporada: episódios novos dos próximos 7 dias (horários do AniList).
export default route("GET", async (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3 * 3600; // inclui o que saiu há pouco
  const list = await airingSchedule(from, now + 7 * 86400);
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=1800");
  return res.status(200).json({
    agora: now,
    episodios: list.map((s) => ({
      at: s.airingAt,
      ep: s.episode,
      total: s.media.episodes || null,
      id: s.media.id,
      title: s.media.title?.english || s.media.title?.romaji,
      romaji: s.media.title?.romaji,
      native: s.media.title?.native,
      cover: s.media.coverImage?.large || null,
      color: s.media.coverImage?.color || null,
      url: s.media.siteUrl,
      format: s.media.format,
      pais: s.media.countryOfOrigin,
      popular: s.media.popularity || 0,
      onde: streamingLinks(s.media).slice(0, 3),
    })),
  });
});
