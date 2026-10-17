import { getCharacterFull, cleanDescription, descriptionFacts } from "../lib/anilist.js";
import { askJson } from "../lib/ai.js";
import { route, clip, needAi, readBody } from "../lib/common.js";
import { trendsEnabled, visitor, recordVote, countVotes } from "../lib/trends.js";
import { withLang } from "../lib/lang.js";

const STATS = ["forca", "velocidade", "inteligencia", "tecnica", "resistencia", "poderes"];
const num = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

const ids = (q) => [Number(q?.a), Number(q?.b)];
const okIds = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a > 0 && b > 0 && a !== b && a < 1e8 && b < 1e8;

// Votação dos fãs: GET ?a&b&votos=1 mostra o placar; POST {a, b, voto} registra um voto.
async function votes(req, res) {
  res.setHeader("Cache-Control", req.method === "POST" ? "no-store" : "public, s-maxage=30, stale-while-revalidate=60");
  const [a, b] = req.method === "POST" ? ids(readBody(req)) : ids(req.query);
  if (!okIds(a, b)) return res.status(400).json({ error: "Luta inválida." });
  if (!trendsEnabled()) return res.status(200).json({ ligado: false, votos: { [a]: 0, [b]: 0 } });
  if (req.method === "POST") {
    const v = Number(readBody(req).voto);
    if (v !== a && v !== b) return res.status(400).json({ error: "Voto inválido." });
    await recordVote(a, b, v, visitor(req));
  }
  return res.status(200).json({ ligado: true, votos: await countVotes(a, b) });
}

export default withLang(handler);
async function handler(req, res) {
  if (req.method === "POST" || req.query?.votos) {
    try { return await votes(req, res); }
    catch (e) { console.error(e); return res.status(500).json({ error: "A votação não respondeu agora." }); }
  }
  return fight(req, res);
}

// Quem ganharia? ?a=<id AniList>&b=<id AniList>. A mesma dupla sempre recebe a mesma resposta (fica guardada no Vercel).
// A IA recebe a ficha de verdade de cada personagem (descrição do AniList: poderes, técnicas, feitos),
// dá notas de atributos com base nela, e quem tiver a maior soma de atributos vence.
const card = (full) => {
  const c = full.character, m = full.main;
  return { id: c.id, name: c.name?.full || "", native: c.name?.native || "", image: c.image?.large || c.image?.medium || null,
    anime: m ? m.title?.english || m.title?.romaji || "" : "", favourites: c.favourites || 0 };
};
const ficha = (full) => {
  const c = full.character, f = descriptionFacts(String(c.description || ""));
  const extra = [f.affiliation && `Afiliação: ${f.affiliation}`, f.height && `Altura: ${f.height}`].filter(Boolean).join(". ");
  return `${cleanDescription(String(c.description || "")).slice(0, 1500) || "(sem descrição no AniList)"}${extra ? `\n${extra}` : ""}`;
};
const total = (st) => STATS.reduce((n, k) => n + st[k], 0);

const fight = route("GET", async (req, res) => {
  needAi();
  let a = Number(req.query?.a), b = Number(req.query?.b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0) return res.status(400).json({ error: "Escolha os dois personagens." });
  if (a === b) return res.status(400).json({ error: "Escolha dois personagens diferentes." });
  const swap = a > b;
  if (swap) [a, b] = [b, a];

  const [FA, FB] = await Promise.all([getCharacterFull(a), getCharacterFull(b)]);
  if (!FA?.main || !FB?.main) return res.status(404).json({ error: "Não encontrei um dos personagens." });
  const ca = card(FA), cb = card(FB);

  const r = await askJson(`Batalha de fãs, só por diversão, num site brasileiro para jovens: ${ca.name} (${ca.anime}) contra ${cb.name} (${cb.anime}).
Você é um especialista em "power scaling" (comparar a força de personagens de obras diferentes). Analise com cuidado e com honestidade de fã que conhece as obras.

FICHA DE A — ${ca.name} (${ca.anime}):
"""${ficha(FA)}"""

FICHA DE B — ${cb.name} (${cb.anime}):
"""${ficha(FB)}"""

Como analisar:
1. PODERES: liste os poderes, técnicas e habilidades especiais de cada um, incluindo transformações e formas mais fortes (ex.: formas super, expansões de domínio, itens que dão poder).
2. HISTÓRIA: lembre os maiores feitos de cada um na obra (o que destruíram, quem venceram, o que aguentaram).
3. MUNDO: considere a escala de poder do universo de cada obra (nível de rua, cidade, país, planeta, estrela, universo) e onde cada um fica dentro dela. Um personagem de um universo com escala muito maior tem notas MUITO maiores nos atributos ligados a isso.
4. HABILIDADES ESPECIAIS: pense em poderes que anulam ou contornam o outro (defesas absolutas, ataques que ignoram defesa, imortalidade, velocidade de reação).
5. Se os dois já lutaram na própria obra, considere COMO a luta aconteceu: ataque surpresa, ajuda de outros, condições especiais ou o roteiro. Aqui a luta é justa: 1 contra 1, os dois no auge, cada um sabendo quem é o outro, sem ajuda e sem favorecimento do roteiro.
6. Dê notas de 0 a 100 usando a MESMA régua para os dois. "poderes" mede o quanto os poderes especiais e a escala dele decidem uma luta.
7. O vencedor é quem tiver a MAIOR SOMA das notas, então as notas precisam refletir de verdade quem ganharia.
Responda SOMENTE com JSON:
{"nivel_A":"escala de poder curta, ex.: nível de cidade","nivel_B":"...","habilidades_A":["3 a 5 poderes ou feitos curtos"],"habilidades_B":["3 a 5 poderes ou feitos curtos"],"atributos":{"A":{"forca":0-100,"velocidade":0-100,"inteligencia":0-100,"tecnica":0-100,"resistencia":0-100,"poderes":0-100},"B":{"forca":0-100,"velocidade":0-100,"inteligencia":0-100,"tecnica":0-100,"resistencia":0-100,"poderes":0-100}},"manchete":"1 frase curta e empolgante","explicacao":"3 a 5 frases dizendo quem ganharia e por quê, citando poderes, feitos e a escala de cada mundo, em tom de narrador de luta empolgado, sem violência pesada","momento_decisivo":"1 frase com o lance que decide","vantagens_A":["2 ou 3 vantagens curtas"],"vantagens_B":["2 ou 3 vantagens curtas"]}
A é ${ca.name}. B é ${cb.name}. Português do Brasil.`, { maxTokens: 2000 });
  if (!r) throw Object.assign(new Error("resposta vazia"), { publicMessage: "A IA não respondeu agora. Tente de novo." });

  const side = (k) => ({
    stats: Object.fromEntries(STATS.map((s) => [s, num(r.atributos?.[k]?.[s])])),
    vantagens: (Array.isArray(r[`vantagens_${k}`]) ? r[`vantagens_${k}`] : []).slice(0, 3).map((x) => clip(x, 90)),
    habilidades: (Array.isArray(r[`habilidades_${k}`]) ? r[`habilidades_${k}`] : []).slice(0, 5).map((x) => clip(x, 80)).filter(Boolean),
    nivel: clip(r[`nivel_${k}`], 60),
  });
  const A = side("A"), B = side("B");
  // O vencedor sai da soma dos atributos (assim o resultado sempre bate com as barrinhas).
  const tA = total(A.stats), tB = total(B.stats), diff = Math.abs(tA - tB);
  const win = diff === 0 ? "empate" : tA > tB ? "A" : "B";
  const left = { ...ca, ...A, total: tA }, right = { ...cb, ...B, total: tB };

  res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
  return res.status(200).json({
    a: swap ? right : left,
    b: swap ? left : right,
    vencedor: win === "empate" ? "empate" : (win === "A") !== swap ? "a" : "b",
    confianca: win === "empate" ? 50 : Math.min(97, 55 + Math.round(diff / 3.6)),
    manchete: clip(r.manchete, 140),
    explicacao: clip(r.explicacao, 900),
    momento_decisivo: clip(r.momento_decisivo, 240),
  });
});
