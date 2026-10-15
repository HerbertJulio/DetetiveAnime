import { quickSearch, searchMany, liteCard, normalize, sameName, titleMatches } from "../lib/anilist.js";
import { askJson, aiEnabled } from "../lib/ai.js";
import { clip } from "../lib/common.js";

// Pesquisa por nome, apelido, obra, poder/técnica ou organização.
// ?q=texto            -> busca completa (usa a IA quando o nome não bate)
// ?q=texto&modo=rapido -> só AniList, pra sugestões enquanto a pessoa digita
export default async function handler(req, res) {
  try {
    const q = clip(req.query?.q, 80);
    if (q.length < 2) return res.status(400).json({ error: "Digite pelo menos 2 letras." });
    const rapido = req.query?.modo === "rapido";
    const out = await find(q, rapido);
    // Resposta vazia ou com a IA fora do ar não fica guardada, pra a próxima pessoa tentar de novo.
    const keep = out.resultados.length || out.obra;
    res.setHeader("Cache-Control", out.iaFalhou || !keep ? "no-store" : `public, s-maxage=${rapido ? 3600 : 86400}, stale-while-revalidate=3600`);
    return res.status(200).json(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "A pesquisa falhou agora. Tente de novo." });
  }
}

// Variações de grafia que o AniList usa ("Gojo" -> "Gojou", "Yuji" -> "Yuuji").
export function spellings(q) {
  const v = new Set([q]);
  v.add(q.replace(/o\b/gi, "ou"));
  v.add(q.replace(/u(?=[^aeiou]|$)/gi, "uu"));
  return [...v].filter(Boolean);
}

export function nameHit(c, nq) {
  const all = [c.name?.full, c.name?.native, ...(c.name?.alternative || [])].map(normalize).filter(Boolean);
  const words = nq.split(" ");
  return all.some((n) => n.includes(nq) || words.every((w) => n.split(" ").some((t) => t.startsWith(w))));
}

// A obra só conta quando a pesquisa é praticamente o título ("Jujutsu Kaisen"), não um pedaço dele.
export function showHit(m, nq) {
  const titles = [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].map(normalize).filter(Boolean);
  return titles.some((t) => t === nq || (t.includes(nq) && nq.length >= t.length * 0.6) || (nq.includes(t) && t.length >= nq.length * 0.6));
}
// Personagem famoso (muita gente favoritou) ou nome completo igual: aí não precisa perguntar pra IA.
const strongHit = (c, q) => (c.favourites || 0) >= 5000 || (sameName(c.name?.full, q) && q.trim().includes(" "));

const mediaCard = (m) => ({ id: m.id, title: m.title?.english || m.title?.romaji, native: m.title?.native || "", cover: m.coverImage?.large || null, url: m.siteUrl });

export async function find(q, rapido) {
  const nq = normalize(q);
  let { characters, media } = await quickSearch(q);
  if (!characters.length) {
    for (const alt of spellings(q).slice(1)) {
      const more = await quickSearch(alt);
      if (more.characters.length) { characters = more.characters; break; }
    }
  }

  const named = characters.filter((c) => nameHit(c, nq));
  const show = media.find((m) => showHit(m, nq));
  const obra = show ? { ...mediaCard(show), personagens: (show.characters?.edges || []).map((e) => liteCard({ ...e.node, media: { nodes: [{ ...show, type: "ANIME" }] } }, { role: e.role })) } : null;

  if (rapido) {
    return { q, tipo: named.length ? "personagem" : obra ? "obra" : "sugestao", resultados: (named.length ? named : characters).slice(0, 6).map((c) => liteCard(c)), obra: obra ? { ...obra, personagens: obra.personagens.slice(0, 6) } : null };
  }

  const byName = named.slice(0, 10).map((c) => liteCard(c));
  if (obra || named.some((c) => strongHit(c, q))) {
    return { q, tipo: named.length ? "personagem" : "obra", explicacao: "", resultados: byName, obra };
  }

  // Não é nome nem obra: pode ser poder, técnica, organização ou apelido. A IA ajuda a descobrir quem é.
  let iaFalhou = false;
  if (aiEnabled()) {
    const ai = await askJson(`Um usuário de um site brasileiro de anime (público jovem) pesquisou: "${q}".
Isso pode ser nome ou apelido de personagem, nome de obra, um poder/técnica/habilidade, uma organização/clã/grupo/escola, ou uma característica marcante.
Descubra a quais personagens de anime a pesquisa se refere. Responda SOMENTE com JSON:
{"tipo":"apelido|poder|organizacao|obra|caracteristica|outro","explicacao":"1 frase em português do Brasil explicando o que é \\"${q}\\"","personagens":[{"nome":"nome completo do personagem em romaji, como no AniList","anime":"nome do anime em romaji","motivo":"por que aparece, ex.: dono da técnica, membro do grupo"}]}
Regras: até 8 personagens, do mais ligado ao menos ligado. Só personagens que existem. Nada de conteúdo adulto. Se não souber, "personagens":[].`, { maxTokens: 900 }).catch((e) => { console.error("IA:", e.message); iaFalhou = true; return null; });

    const guesses = (Array.isArray(ai?.personagens) ? ai.personagens : []).filter((g) => g?.nome).slice(0, 8);
    if (guesses.length) {
      const found = await searchMany(guesses.map((g) => g.nome)).catch(() => guesses.map(() => []));
      const seen = new Set();
      const resultados = [];
      guesses.forEach((g, i) => {
        const list = found[i] || [];
        const c = list.find((x) => (x.media?.nodes || []).some((m) => !m.isAdult && titleMatches(m, g.anime)))
          || list.find((x) => sameName(x.name?.full, g.nome)) || null;
        if (c && !seen.has(c.id)) { seen.add(c.id); resultados.push(liteCard(c, { motivo: clip(g.motivo, 140) })); }
      });
      const outros = byName.filter((c) => !seen.has(c.id));
      if (resultados.length) return { q, tipo: clip(ai.tipo, 20) || "outro", explicacao: clip(ai.explicacao, 220), resultados, outros, obra: null };
    }
  }

  if (byName.length) return { q, tipo: "personagem", explicacao: "", resultados: byName, obra: null, iaFalhou };
  return { q, tipo: "sugestao", explicacao: "", resultados: characters.slice(0, 8).map((c) => liteCard(c)), obra: null, iaFalhou };
}
