// "Onde assistir" pelo TMDB (dados de disponibilidade fornecidos pelo JustWatch).
// Precisa da variável TMDB_TOKEN: pode ser o "API Read Access Token" (começa com eyJ) ou a "API Key".
const BASE = "https://api.themoviedb.org/3";
const LOGO = "https://image.tmdb.org/t/p/w92";

function tmdbFetch(path, params = {}) {
  const token = process.env.TMDB_TOKEN;
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: "application/json" };
  if (token.startsWith("eyJ")) headers.Authorization = `Bearer ${token}`;
  else url.searchParams.set("api_key", token);
  return fetch(url, { headers }).then((r) => {
    if (!r.ok) throw new Error(`TMDB respondeu ${r.status}`);
    return r.json();
  });
}

export function tmdbEnabled() {
  return Boolean(process.env.TMDB_TOKEN);
}

// Junta as ofertas por plataforma, sem repetir, marcando o tipo (assinatura, grátis, aluguel, compra).
export function groupProviders(br) {
  if (!br) return [];
  const kinds = [["flatrate", "Assinatura"], ["free", "Grátis"], ["ads", "Grátis com anúncios"], ["rent", "Aluguel"], ["buy", "Compra"]];
  const seen = new Map();
  for (const [key, label] of kinds) {
    for (const p of br[key] || []) {
      if (!seen.has(p.provider_id)) {
        if (/youtube/i.test(p.provider_name || "")) continue;
        seen.set(p.provider_id, { name: p.provider_name, logo: p.logo_path ? LOGO + p.logo_path : null, kind: label });
      }
    }
  }
  return [...seen.values()];
}

export async function whereToWatch(media, region = "BR") {
  if (!tmdbEnabled() || !media) return null;
  const isMovie = media.format === "MOVIE";
  const kind = isMovie ? "movie" : "tv";
  const queries = [media.title?.english, media.title?.romaji, media.title?.native].filter(Boolean);

  for (const q of queries) {
    const s = await tmdbFetch(`/search/${kind}`, { query: q, language: "pt-BR" });
    const results = s.results || [];
    // Prefere produção japonesa de animação (gênero 16).
    const hit = results.find((x) => x.original_language === "ja" && (x.genre_ids || []).includes(16))
      || results.find((x) => x.original_language === "ja")
      || null;
    if (!hit) continue;
    const w = await tmdbFetch(`/${kind}/${hit.id}/watch/providers`);
    const br = w.results?.[region];
    return {
      title: hit.name || hit.title,
      link: br?.link || `https://www.themoviedb.org/${kind}/${hit.id}/watch?locale=${region}`,
      providers: groupProviders(br),
    };
  }
  return { title: null, link: null, providers: [] };
}
