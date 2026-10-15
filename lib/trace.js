// Busca de cena por print no trace.moe (https://trace.moe).
// Funciona sem chave (cota mensal pequena). Com TRACE_MOE_KEY a cota aumenta.
export async function traceScene(buffer, mediaType = "image/jpeg") {
  const headers = { "Content-Type": mediaType };
  if (process.env.TRACE_MOE_KEY) headers["x-trace-key"] = process.env.TRACE_MOE_KEY;
  const r = await fetch("https://api.trace.moe/search?cutBorders&anilistInfo", {
    method: "POST",
    headers,
    body: buffer,
  });
  if (r.status === 402 || r.status === 429) throw Object.assign(new Error("Cota do trace.moe esgotada"), { code: "quota" });
  if (!r.ok) throw new Error(`trace.moe respondeu ${r.status}`);
  const j = await r.json();
  const top = (j.result || []).find((x) => !x.anilist?.isAdult);
  if (!top || top.similarity < 0.87) return null;
  return {
    anilistId: typeof top.anilist === "object" ? top.anilist.id : top.anilist,
    episode: top.episode ?? null,
    from: top.from,
    similarity: top.similarity,
    video: top.video ? `${top.video}&size=m` : null,
    image: top.image || null,
  };
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
