// Interpreta a descrição (e o print, se houver) e sugere personagens prováveis.
// Funciona com Gemini (GEMINI_API_KEY) ou Claude (ANTHROPIC_API_KEY). As chaves ficam só nas variáveis do Vercel.
// AI_PROVIDER escolhe qual usar quando as duas existem ("gemini" ou "anthropic"). AI_MODEL troca o modelo.

export function provider() {
  const want = (process.env.AI_PROVIDER || "").toLowerCase();
  const hasG = Boolean(process.env.GEMINI_API_KEY), hasA = Boolean(process.env.ANTHROPIC_API_KEY);
  if (want === "gemini" && hasG) return "gemini";
  if (want === "anthropic" && hasA) return "anthropic";
  return hasG ? "gemini" : hasA ? "anthropic" : null;
}

export function aiEnabled() {
  return provider() !== null;
}

export function buildPrompt(description, hasImage) {
  return `Você identifica personagens de anime pela aparência (rosto, cabelo, olhos, marcas, roupas, acessórios).
Descrição do usuário: """${description || "(sem texto)"}"""
${hasImage ? "Há um print de uma cena anexado. Use-o junto com a descrição." : ""}
Responda SOMENTE com JSON, neste formato:
{"resultados":[{"personagem":"nome do personagem como é mais conhecido","nomes_busca":["nome em romaji na ordem japonesa","nome na ordem ocidental","grafia do AniList, ex. com ou longo"],"anime":"nome do anime em romaji","anime_br":"nome do anime como é conhecido no Brasil","confianca":0-100,"por_que":"1-2 frases em português do Brasil ligando a descrição ao personagem","cena":"onde aparece: temporada, arco ou episódio aproximado","altura":"ex. 1,90 m, ou vazio se não souber","criador":"autor da obra original"}]}
Regras: até 4 resultados, do mais provável ao menos provável. Só personagens que existem de verdade. Nada de conteúdo adulto. Se nada combinar, responda {"resultados":[]}.`;
}

export function parseJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

async function askAnthropic(prompt, image, maxTokens) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  content.push({ type: "text", text: prompt });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: /^claude/.test(process.env.AI_MODEL || "") ? process.env.AI_MODEL : "claude-sonnet-5-5", max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`IA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}

// Modelos tentados em ordem: se um estiver lotado (503/429) ou não existir, passa pro próximo.
export function geminiModels() {
  return [...new Set([process.env.AI_MODEL, "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"].filter((m) => m && !/^claude/.test(m)))];
}

async function askGemini(prompt, image, maxTokens) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64 } });
  parts.push({ text: prompt });
  let lastErr;
  for (const model of geminiModels()) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: Math.max(maxTokens, 4096), responseMimeType: "application/json" },
      }),
    });
    if (r.ok) {
      const j = await r.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (text) return text;
      lastErr = new Error(`IA ${model} respondeu vazio`);
      continue;
    }
    lastErr = new Error(`IA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if (![404, 429, 500, 503].includes(r.status)) throw lastErr;
  }
  throw lastErr;
}

// Pergunta qualquer coisa à IA e devolve o JSON da resposta.
export async function askJson(prompt, { image, maxTokens = 1500 } = {}) {
  const text = provider() === "gemini" ? await askGemini(prompt, image, maxTokens) : await askAnthropic(prompt, image, maxTokens);
  return parseJson(text);
}

export async function guessCharacters(description, image) {
  const data = await askJson(buildPrompt(description, Boolean(image)), { image, maxTokens: 1200 });
  return Array.isArray(data?.resultados) ? data.resultados.slice(0, 4) : [];
}
