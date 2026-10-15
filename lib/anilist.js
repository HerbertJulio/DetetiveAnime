// Consultas ao AniList (https://anilist.co) — API GraphQL pública, sem chave.
const ENDPOINT = "https://graphql.anilist.co";

const MEDIA_FIELDS = `
  id type format isAdult siteUrl
  title { romaji english native }
  coverImage { large }
  externalLinks { site url type }
`;

// Dados do personagem que o AniList guarda (aniversário oficial, gênero, idade).
const CHAR_FIELDS = `id siteUrl favourites gender age name { full native alternative } image { large } dateOfBirth { month day }`;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function charFacts(c) {
  if (!c) return {};
  const d = c.dateOfBirth;
  const g = { Male: "Masculino", Female: "Feminino" }[c.gender] || (c.gender ? String(c.gender) : "");
  const age = c.age ? String(c.age).trim().replace(/[-–]+$/, "") : "";
  return {
    aniversario: d?.day && d?.month ? `${d.day} de ${MESES[d.month - 1]}` : "",
    genero: g,
    idade: age ? (/^\d/.test(age) && !/anos?/.test(age) ? `${age} anos` : age) : "",
  };
}

async function gql(query, variables) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "AcheiOAnime/1.0" },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`AniList respondeu ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ou\b/g, "o").replace(/uu/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Mesmo nome em qualquer ordem: "Gojo Satoru" = "Satoru Gojou".
export function sameName(a, b) {
  const ta = normalize(a).split(" ").filter(Boolean).sort().join(" ");
  const tb = normalize(b).split(" ").filter(Boolean).sort().join(" ");
  return Boolean(ta) && ta === tb;
}

export function titleMatches(media, hint) {
  const h = normalize(hint);
  if (!h) return false;
  return [media?.title?.romaji, media?.title?.english, media?.title?.native].some((t) => {
    const n = normalize(t);
    return n && (n === h || n.includes(h) || h.includes(n));
  });
}

// Escolhe, entre as obras do personagem, a que bate com o nome de anime sugerido.
export function pickMedia(nodes, animeHint) {
  const safe = (nodes || []).filter((m) => m && !m.isAdult && m.type === "ANIME");
  if (!safe.length) return null;
  const h = normalize(animeHint);
  const exact = h && safe.find((m) => [m.title?.romaji, m.title?.english, m.title?.native].some((t) => normalize(t) === h));
  return exact || safe.find((m) => titleMatches(m, animeHint)) || safe[0];
}

async function searchCharacters(name) {
  const data = await gql(
    `query ($s: String) {
      Page(perPage: 6) {
        characters(search: $s, sort: [SEARCH_MATCH, FAVOURITES_DESC]) {
          ${CHAR_FIELDS}
          media(perPage: 12, sort: [POPULARITY_DESC]) { nodes { ${MEDIA_FIELDS} } }
        }
      }
    }`,
    { s: name }
  );
  return data?.Page?.characters || [];
}

// Plano B: procura o anime e acha o personagem dentro do elenco dele.
async function searchInAnime(animeTitle, names) {
  const data = await gql(
    `query ($s: String) {
      Page(perPage: 3) {
        media(search: $s, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
          ${MEDIA_FIELDS}
          characters(perPage: 50, sort: [ROLE, FAVOURITES_DESC]) {
            nodes { ${CHAR_FIELDS} }
          }
        }
      }
    }`,
    { s: animeTitle }
  );
  for (const media of data?.Page?.media || []) {
    for (const c of media.characters?.nodes || []) {
      const all = [c.name?.full, c.name?.native, ...(c.name?.alternative || [])];
      if (names.some((n) => all.some((x) => sameName(x, n)))) return { character: c, media, exact: true };
    }
  }
  const first = data?.Page?.media?.[0];
  return first ? { character: null, media: first, exact: false } : null;
}

export async function findCharacter(names, animeHint) {
  const list = [...new Set((Array.isArray(names) ? names : [names]).filter(Boolean))].slice(0, 4);

  for (const name of list) {
    const chars = await searchCharacters(name);
    // Prefere o personagem que aparece no anime sugerido pela IA.
    for (const c of chars) {
      const media = pickMedia(c.media?.nodes, animeHint);
      if (media && titleMatches(media, animeHint)) return { character: c, media };
    }
    const named = chars.find((c) => sameName(c.name?.full, name) && pickMedia(c.media?.nodes));
    if (named) return { character: named, media: pickMedia(named.media?.nodes, animeHint) };
  }

  if (animeHint) {
    const hit = await searchInAnime(animeHint, list);
    if (hit) return hit;
  }
  return null;
}

export async function getMedia(id) {
  const data = await gql(`query ($id: Int) { Media(id: $id) { ${MEDIA_FIELDS} } }`, { id: Number(id) });
  return data?.Media || null;
}

// Links oficiais de streaming que o próprio AniList cadastra para a obra.
export function streamingLinks(media) {
  return (media?.externalLinks || [])
    .filter((l, i, all) => l.type === "STREAMING" && /^https:\/\//.test(l.url) && all.findIndex((x) => x.type === "STREAMING" && x.site === l.site) === i)
    .map((l) => ({ name: l.site, url: l.url }));
}

// Personagens que fazem aniversário hoje, segundo o AniList, do mais querido ao menos.
export async function birthdayCharacters() {
  const data = await gql(
    `query {
      Page(perPage: 25) {
        characters(isBirthday: true, sort: [FAVOURITES_DESC]) {
          ${CHAR_FIELDS}
          media(perPage: 6, sort: [POPULARITY_DESC]) { nodes { ${MEDIA_FIELDS} } }
        }
      }
    }`,
    {}
  );
  return (data?.Page?.characters || [])
    .map((c) => ({ character: c, media: pickMedia(c.media?.nodes) }))
    .filter((x) => x.media);
}

// ---------- Busca rápida, página do personagem e tendências

const LITE = `id siteUrl favourites name { full native alternative } image { large medium }`;

// Tira marcações do AniList (spoilers, negrito, links) e deixa só o texto.
export function cleanDescription(text) {
  return String(text || "")
    .replace(/~!([\s\S]*?)!~/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Altura e afiliação costumam vir no começo da descrição do AniList ("__Height:__ 190 cm").
export function descriptionFacts(text) {
  const t = String(text || "");
  const pick = (re) => (t.match(re)?.[1] || "").replace(/~!|!~/g, "").replace(/__|\*\*/g, "").trim().slice(0, 80);
  return { height: pick(/__Height:?__:?\s*([^\n]+)/i), affiliation: pick(/__(?:Affiliation|Affiliations|Organization|Occupation):?__:?\s*([^\n]+)/i) };
}

const safeMedia = (nodes) => (nodes || []).filter((m) => m && !m.isAdult);

// Uma consulta só: personagens pelo nome e obras pelo título.
export async function quickSearch(q) {
  const data = await gql(
    `query ($s: String) {
      chars: Page(perPage: 10) {
        characters(search: $s, sort: [SEARCH_MATCH, FAVOURITES_DESC]) {
          ${LITE}
          media(perPage: 4, sort: [POPULARITY_DESC]) { nodes { id type isAdult siteUrl title { romaji english } } }
        }
      }
      shows: Page(perPage: 3) {
        media(search: $s, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
          id siteUrl synonyms title { romaji english native } coverImage { large }
          characters(perPage: 16, sort: [ROLE, FAVOURITES_DESC]) { edges { role node { ${LITE} } } }
        }
      }
    }`,
    { s: q }
  );
  const characters = (data?.chars?.characters || []).filter((c) => safeMedia(c.media?.nodes).length || !(c.media?.nodes || []).length);
  return { characters, media: data?.shows?.media || [] };
}

// Vários nomes numa consulta só (com apelidos de consulta c0, c1...), pra não estourar o limite do AniList.
export async function searchMany(names) {
  const list = names.slice(0, 8);
  if (!list.length) return [];
  const vars = Object.fromEntries(list.map((n, i) => [`s${i}`, n]));
  const decl = list.map((_, i) => `$s${i}: String`).join(", ");
  const body = list.map((_, i) => `c${i}: Page(perPage: 4) { characters(search: $s${i}, sort: [SEARCH_MATCH, FAVOURITES_DESC]) { ${LITE} media(perPage: 6, sort: [POPULARITY_DESC]) { nodes { id type isAdult siteUrl title { romaji english native } } } } }`).join("\n");
  const data = await gql(`query (${decl}) { ${body} }`, vars);
  return list.map((_, i) => data?.[`c${i}`]?.characters || []);
}

export async function getCharacterFull(id) {
  const data = await gql(
    `query ($id: Int) {
      Character(id: $id) {
        ${CHAR_FIELDS}
        description(asHtml: false)
        media(perPage: 12, sort: [POPULARITY_DESC]) { edges { characterRole node { ${MEDIA_FIELDS} popularity status genres startDate { year } nextAiringEpisode { airingAt episode } } } }
      }
    }`,
    { id: Number(id) }
  );
  const c = data?.Character;
  if (!c) return null;
  const edges = (c.media?.edges || []).filter((e) => e.node && !e.node.isAdult);
  const anime = edges.filter((e) => e.node.type === "ANIME");
  const main = (anime[0] || edges[0])?.node || null;
  return { character: c, main, works: edges.map((e) => ({ role: e.characterRole, media: e.node })) };
}

export async function mediaCast(mediaId, skipId) {
  const data = await gql(
    `query ($id: Int) { Media(id: $id) { characters(perPage: 14, sort: [ROLE, FAVOURITES_DESC]) { edges { role node { ${LITE} } } } } }`,
    { id: Number(mediaId) }
  );
  return (data?.Media?.characters?.edges || []).filter((e) => e.node && e.node.id !== skipId);
}

export async function charactersByIds(ids) {
  if (!ids.length) return [];
  const data = await gql(
    `query ($ids: [Int]) { Page(perPage: 50) { characters(id_in: $ids) { ${LITE} media(perPage: 3, sort: [POPULARITY_DESC]) { nodes { id type isAdult title { romaji english } } } } } }`,
    { ids: ids.map(Number) }
  );
  return data?.Page?.characters || [];
}

// Personagens principais dos animes em alta no AniList agora.
export async function trendingCharacters() {
  const data = await gql(
    `query { Page(perPage: 8) { media(type: ANIME, isAdult: false, sort: [TRENDING_DESC]) {
      id title { romaji english } coverImage { large }
      characters(perPage: 2, sort: [ROLE, FAVOURITES_DESC]) { nodes { ${LITE} } }
    } } }`,
    {}
  );
  const out = [];
  for (const m of data?.Page?.media || []) {
    for (const c of m.characters?.nodes || []) out.push({ c, anime: m.title?.english || m.title?.romaji, animeId: m.id });
  }
  return out;
}

// Formato enxuto que o site usa em listas.
export function liteCard(c, extra = {}) {
  const media = safeMedia(c.media?.nodes);
  const m = media.find((x) => x.type === "ANIME") || media[0];
  return {
    id: c.id,
    name: c.name?.full || "",
    native: c.name?.native || "",
    image: c.image?.large || c.image?.medium || null,
    anime: m ? m.title?.english || m.title?.romaji : "",
    favourites: c.favourites || 0,
    ...extra,
  };
}

// Episódios que vão ao ar entre "from" e "to" (segundos Unix), sem conteúdo adulto.
export async function airingSchedule(from, to, maxPages = 4) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await gql(
      `query ($from: Int, $to: Int, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: [TIME]) {
            airingAt episode
            media { id isAdult siteUrl format episodes popularity countryOfOrigin
              title { romaji english native } coverImage { large color }
              externalLinks { site url type } }
          }
        }
      }`,
      { from, to, page }
    );
    const p = data?.Page;
    out.push(...(p?.airingSchedules || []));
    if (!p?.pageInfo?.hasNextPage) break;
  }
  return out.filter((s) => s.media && !s.media.isAdult);
}

// ---------- O que assistir

const REC_FIELDS = `id type isAdult siteUrl format episodes seasonYear averageScore genres
  title { romaji english native } coverImage { large color } externalLinks { site url type }`;
// Gêneros que não combinam com um site pra jovens.
const BLOCKED_GENRES = ["Ecchi", "Hentai"];
export const kidSafe = (m) => m && !m.isAdult && m.type !== "MANGA" && !(m.genres || []).some((g) => BLOCKED_GENRES.includes(g));

export async function searchAnime(q) {
  const data = await gql(
    `query ($s: String) { Page(perPage: 8) { media(search: $s, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${REC_FIELDS} } } }`,
    { s: q }
  );
  return (data?.Page?.media || []).filter(kidSafe);
}

export async function recommendationsFor(id) {
  const data = await gql(
    `query ($id: Int) { Media(id: $id) { ${REC_FIELDS}
      recommendations(perPage: 16, sort: [RATING_DESC]) { nodes { rating mediaRecommendation { ${REC_FIELDS} } } } } }`,
    { id: Number(id) }
  );
  const m = data?.Media;
  if (!m) return null;
  const recs = (m.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter(kidSafe);
  return { base: m, recs };
}

export async function popularByGenre(genre) {
  const data = await gql(
    `query ($g: String) { Page(perPage: 16) { media(type: ANIME, isAdult: false, genre: $g, genre_not_in: ["Ecchi", "Hentai"], sort: [POPULARITY_DESC]) { ${REC_FIELDS} } } }`,
    { g: genre }
  );
  return (data?.Page?.media || []).filter(kidSafe);
}

export function animeCard(m) {
  return {
    id: m.id,
    title: m.title?.english || m.title?.romaji,
    romaji: m.title?.romaji,
    native: m.title?.native,
    cover: m.coverImage?.large || null,
    color: m.coverImage?.color || null,
    url: m.siteUrl,
    format: m.format,
    year: m.seasonYear || null,
    episodes: m.episodes || null,
    score: m.averageScore || null,
    genres: (m.genres || []).slice(0, 4),
    onde: streamingLinks(m).slice(0, 4),
  };
}

// ---------- Perfil e Desafio do dia

export async function anilistUserProfile(name) {
  const data = await gql(
    `query ($n: String) { User(name: $n) { name siteUrl avatar { large }
      favourites { characters(perPage: 8) { nodes { id name { full } image { large } } } } } }`,
    { n: name }
  );
  const u = data?.User;
  if (!u) return null;
  return { name: u.name, url: u.siteUrl, avatar: u.avatar?.large || null,
    favoritos: (u.favourites?.characters?.nodes || []).map((c) => ({ id: c.id, name: c.name?.full, image: c.image?.large || null })) };
}

export async function popularCharacterIds(page) {
  const data = await gql(`query ($p: Int) { Page(page: $p, perPage: 50) { characters(sort: [FAVOURITES_DESC]) { id } } }`, { p: page });
  return (data?.Page?.characters || []).map((c) => c.id);
}

// Ficha resumida usada pra comparar palpites no desafio.
export async function challengeCharacter(id) {
  const data = await gql(
    `query ($id: Int) { Character(id: $id) { id favourites gender age name { full } image { large }
      media(perPage: 6, sort: [POPULARITY_DESC], type: ANIME) { nodes { id isAdult title { romaji english } genres startDate { year } } } } }`,
    { id: Number(id) }
  );
  const c = data?.Character;
  if (!c) return null;
  const m = (c.media?.nodes || []).find((x) => !x.isAdult);
  const age = parseInt(String(c.age || "").match(/\d+/)?.[0] || "", 10);
  return {
    id: c.id, name: c.name?.full || "", image: c.image?.large || null, favourites: c.favourites || 0,
    gender: c.gender || "", age: Number.isFinite(age) ? age : null,
    anime: m ? { id: m.id, title: m.title?.english || m.title?.romaji, genres: m.genres || [], year: m.startDate?.year || null } : null,
  };
}

