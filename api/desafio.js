import { popularCharacterIds, challengeCharacter } from "../lib/anilist.js";
import { readBody } from "../lib/common.js";
import { withLang, currentLang } from "../lib/lang.js";

// Desafio do dia: um personagem misterioso igual pra todo mundo, trocado à meia-noite de Brasília.
// POST {dia}                       -> só o número do desafio
// POST {id, tentativa, dia, lang}  -> compara o palpite com a resposta; dicas aparecem aos poucos;
//                                     a resposta só vem no acerto ou na 6ª tentativa.
const START = Date.UTC(2026, 9, 15); // desafio nº 1 = 15/10/2026
export const MAX = 6;
const BLOCKED = ["Ecchi", "Hentai"];

export const todayKey = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const dayNumber = (key) => Math.floor((Date.parse(key + "T00:00:00Z") - START) / 86400000) + 1;
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// Os 150 personagens mais queridos do AniList, pra o desafio ser possível de acertar.
let pool = null;
async function answerFor(key) {
  if (!pool || Date.now() - pool.at > 6 * 3600e3) {
    const ids = [];
    for (let p = 1; p <= 3; p++) ids.push(...await popularCharacterIds(p));
    pool = { at: Date.now(), ids: [...new Set(ids)], cache: new Map() };
  }
  const start = hash("detetive:" + key) % pool.ids.length;
  for (let k = 0; k < Math.min(10, pool.ids.length); k++) {
    const id = pool.ids[(start + k) % pool.ids.length];
    if (!pool.cache.has(id)) pool.cache.set(id, await challengeCharacter(id));
    const c = pool.cache.get(id);
    if (c?.anime && !c.anime.genres.some((g) => BLOCKED.includes(g))) return c;
  }
  return null;
}

// "mais"/"menos" = a resposta tem mais/menos que o palpite
export function compare(g, a) {
  const num = (x, y) => (x == null || y == null ? "?" : x === y ? "certo" : y > x ? "mais" : "menos");
  const gg = g.anime?.genres || [], ag = a.anime?.genres || [];
  const shared = gg.filter((x) => ag.includes(x));
  return {
    anime: g.anime && a.anime && g.anime.id === a.anime.id ? "certo" : "errado",
    genero: !g.gender || !a.gender ? "?" : g.gender === a.gender ? "certo" : "errado",
    idade: num(g.age, a.age),
    estreia: num(g.anime?.year ?? null, a.anime?.year ?? null),
    generos: !gg.length || !ag.length ? "?" : shared.length === ag.length && gg.length === ag.length ? "certo" : shared.length ? "perto" : "errado",
    generosIguais: shared,
    fama: g.favourites === a.favourites ? "certo" : a.favourites > g.favourites ? "mais" : "menos",
  };
}

export function hints(a, tentativa, lang = "pt") {
  const en = lang === "en";
  const all = [
    en ? `The anime's genres: ${a.anime.genres.slice(0, 3).join(", ")}` : `Gêneros do anime: ${a.anime.genres.slice(0, 3).join(", ")}`,
    en ? `The anime first aired in ${a.anime.year || "?"}` : `O anime estreou em ${a.anime.year || "?"}`,
    en ? `The name starts with "${a.name.charAt(0)}"` : `O nome começa com "${a.name.charAt(0)}"`,
  ];
  return all.slice(0, Math.floor((tentativa - 1) / 2)); // 1 dica na 3ª tentativa, 2 na 5ª
}

const flat = (c) => ({ id: c.id, name: c.name, image: c.image, anime: c.anime?.title || "", genres: c.anime?.genres || [], gender: c.gender, age: c.age, year: c.anime?.year || null, favourites: c.favourites });

export default withLang(async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
  try {
    const key = todayKey(), numero = dayNumber(key);
    const b = readBody(req);
    if (b.dia && b.dia !== key) return res.status(409).json({ error: currentLang() === "en" ? "A new challenge started! Reload the page." : "O desafio mudou! Recarregue a página pra jogar o de hoje.", novo: true, numero });
    if (!b.id) return res.status(200).json({ numero, dia: key, tentativas: MAX });
    const a = await answerFor(key);
    if (!a) return res.status(503).json({ error: "O desafio de hoje ainda não está pronto." });
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Escolha um personagem." });
    const g = id === a.id ? a : await challengeCharacter(id);
    if (!g) return res.status(404).json({ error: "Não encontrei esse personagem." });
    const tentativa = Math.max(1, Math.min(MAX, Number(b.tentativa) || 1));
    const acertou = g.id === a.id;
    return res.status(200).json({
      numero,
      acertou,
      palpite: flat(g),
      comparacao: compare(g, a),
      dicas: acertou ? [] : hints(a, tentativa + 1, currentLang()),
      resposta: acertou || tentativa >= MAX ? { ...flat(a), url: `https://anilist.co/character/${a.id}` } : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "O desafio não respondeu agora. Tente de novo." });
  }
});
