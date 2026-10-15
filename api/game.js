import { askJson } from "../lib/ai.js";
import { readBody, clip, route, needAi } from "../lib/common.js";

// Uma rodada do jogo "Quem é esse personagem?".
const DIFF_TXT = {
  facil: "muito famoso, que quase toda criança e adolescente que vê anime conhece, de séries bem populares",
  medio: "conhecido, de animes populares, mas não necessariamente o protagonista",
  dificil: "menos óbvio: coadjuvantes marcantes ou personagens de animes cult, ainda assim reconhecíveis por fãs",
};

export default route("POST", async (req, res) => {
  needAi();
  const body = readBody(req);
  const diff = DIFF_TXT[body.diff] ? body.diff : "facil";
  const seen = (Array.isArray(body.seen) ? body.seen : []).slice(-30).map((x) => clip(x, 60)).filter(Boolean);

  const prompt = `Crie uma rodada de um jogo de adivinhar personagem de anime.
Escolha UM personagem ${DIFF_TXT[diff]}. Nada de conteúdo adulto.
Não escolha nenhum destes, que já saíram: ${seen.join(", ") || "nenhum"}.
Responda SOMENTE com JSON, em português do Brasil:
{"pistas":["pista 1: só aparência geral (cabelo, olhos, roupa), sem dizer nome, anime, poderes nem bordões","pista 2: um detalhe visual marcante ou objeto que carrega","pista 3: algo sobre a personalidade ou o papel na história, ainda sem dizer nome nem anime"],"resposta":"nome do personagem","anime":"nome do anime como é conhecido no Brasil","opcoes":["exatamente 4 nomes de personagens, incluindo a resposta, de visual parecido entre si"],"curiosidade":"uma curiosidade curta sobre o personagem"}`;

  const d = await askJson(prompt);
  if (!d?.resposta || !Array.isArray(d.pistas) || d.pistas.length < 3) {
    throw Object.assign(new Error("resposta ruim"), { publicMessage: "Não consegui criar a rodada. Tente de novo." });
  }
  let opts = (Array.isArray(d.opcoes) ? d.opcoes : []).map((o) => clip(o, 60)).filter(Boolean);
  opts = [...new Set([d.resposta, ...opts.filter((o) => o !== d.resposta)])].slice(0, 4);
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    pistas: d.pistas.slice(0, 3).map((p) => clip(p, 240)),
    resposta: clip(d.resposta, 60),
    anime: clip(d.anime, 80),
    opcoes: opts,
    curiosidade: clip(d.curiosidade, 240),
  });
});
