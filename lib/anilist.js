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
  const age = c.age ? String(c.age).trim() : "";
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
    .filter((l) => l.type === "STREAMING" && /^https:\/\//.test(l.url))
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
