import { charactersByIds, liteCard } from "../lib/anilist.js";
import { askJson } from "../lib/ai.js";
import { route, clip, needAi } from "../lib/common.js";

const STATS = ["forca", "velocidade", "inteligencia", "tecnica", "resistencia"];
const num = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

// Quem ganharia? ?a=<id AniList>&b=<id AniList>. A mesma dupla sempre recebe a mesma resposta (fica guardada no Vercel).
export default route("GET", async (req, res) => {
  needAi();
  let a = Number(req.query?.a), b = Number(req.query?.b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0) return res.status(400).json({ error: "Escolha os dois personagens." });
  if (a === b) return res.status(400).json({ error: "Escolha dois personagens diferentes." });
  const swap = a > b;
  if (swap) [a, b] = [b, a];

  const chars = await charactersByIds([a, b]);
  const A = chars.find((c) => c.id === a), B = chars.find((c) => c.id === b);
  if (!A || !B) return res.status(404).json({ error: "Não encontrei um dos personagens." });
  const ca = liteCard(A), cb = liteCard(B);

  const r = await askJson(`Batalha de fãs, só por diversão, num site brasileiro para jovens: ${ca.name} (${ca.anime}) contra ${cb.name} (${cb.anime}).
Pense nos poderes, técnicas e feitos que cada um mostra na obra, na versão mais forte que aparece no anime ou mangá.
Responda SOMENTE com JSON:
{"vencedor":"A ou B ou empate","confianca":50 a 100,"manchete":"1 frase curta e empolgante","explicacao":"3 a 5 frases dizendo quem ganharia e por quê, em tom de narrador de luta empolgado, sem violência pesada","momento_decisivo":"1 frase com o lance que decide","atributos":{"A":{"forca":0-100,"velocidade":0-100,"inteligencia":0-100,"tecnica":0-100,"resistencia":0-100},"B":{"forca":0-100,"velocidade":0-100,"inteligencia":0-100,"tecnica":0-100,"resistencia":0-100}},"vantagens_A":["2 ou 3 vantagens curtas"],"vantagens_B":["2 ou 3 vantagens curtas"]}
A é ${ca.name}. B é ${cb.name}. Português do Brasil.`, { maxTokens: 1200 });
  if (!r) throw Object.assign(new Error("resposta vazia"), { publicMessage: "A IA não respondeu agora. Tente de novo." });

  const side = (k) => ({ stats: Object.fromEntries(STATS.map((s) => [s, num(r.atributos?.[k]?.[s])])), vantagens: (Array.isArray(r[`vantagens_${k}`]) ? r[`vantagens_${k}`] : []).slice(0, 3).map((x) => clip(x, 90)) });
  let win = String(r.vencedor || "").trim().toUpperCase();
  win = win.startsWith("A") ? "A" : win.startsWith("B") ? "B" : "empate";
  const left = { ...ca, ...side("A") }, right = { ...cb, ...side("B") };

  res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
  return res.status(200).json({
    a: swap ? right : left,
    b: swap ? left : right,
    vencedor: win === "empate" ? "empate" : (win === "A") !== swap ? "a" : "b",
    confianca: Math.max(50, num(r.confianca) || 60),
    manchete: clip(r.manchete, 140),
    explicacao: clip(r.explicacao, 900),
    momento_decisivo: clip(r.momento_decisivo, 240),
  });
});
