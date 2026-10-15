// "Mais procurados da semana": cada visita a um personagem vira um arquivinho no Vercel Blob,
// numa pasta da semana (trends/2026-W42/<id>/...). Pra montar o ranking, contamos os arquivos.
// Precisa da variável BLOB_READ_WRITE_TOKEN (o Vercel cria quando o Blob é ligado ao projeto).

export const trendsEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function blob() {
  return globalThis.__blobMock || import("@vercel/blob");
}

// Semana no padrão ISO (segunda a domingo), ex. "2026-W42".
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export async function recordView(id) {
  const { put } = await blob();
  const rand = Math.random().toString(36).slice(2, 8);
  await put(`trends/${weekKey()}/${id}/${Date.now()}-${rand}.txt`, "1", { access: "private", addRandomSuffix: false, contentType: "text/plain" });
}

export async function topIds(limit = 10, week = weekKey()) {
  const { list } = await blob();
  const counts = new Map();
  let cursor;
  for (let page = 0; page < 5; page++) {
    const r = await list({ prefix: `trends/${week}/`, limit: 1000, cursor });
    for (const b of r.blobs || []) {
      const id = Number(String(b.pathname).split("/")[2]);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, count]) => ({ id, count }));
}

// Votação dos fãs no "Quem ganha?": cada voto é um arquivinho em votes/<menor id>-<maior id>/<id escolhido>/...
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export async function recordVote(a, b, side) {
  const { put } = await blob();
  const rand = Math.random().toString(36).slice(2, 8);
  await put(`votes/${pairKey(a, b)}/${side}/${Date.now()}-${rand}.txt`, "1", { access: "private", addRandomSuffix: false, contentType: "text/plain" });
}

export async function countVotes(a, b) {
  const { list } = await blob();
  const counts = { [a]: 0, [b]: 0 };
  let cursor;
  for (let page = 0; page < 5; page++) {
    const r = await list({ prefix: `votes/${pairKey(a, b)}/`, limit: 1000, cursor });
    for (const x of r.blobs || []) {
      const id = Number(String(x.pathname).split("/")[2]);
      if (id in counts) counts[id] += 1;
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return counts;
}

// Ranking da comunidade: cada navegador guarda o seu top 10 como um arquivo
// rank/<cliente>/<id1>_<id2>_..._<id10>.txt. Mandar de novo troca o antigo.
export async function saveRanking(client, ids) {
  const { put, list, del } = await blob();
  const old = await list({ prefix: `rank/${client}/`, limit: 50 });
  if (old.blobs?.length) await del(old.blobs.map((b) => b.url));
  await put(`rank/${client}/${ids.join("_")}.txt`, "1", { access: "private", addRandomSuffix: false, contentType: "text/plain" });
}

// Soma pontos: 1º lugar vale 10, o 10º vale 1.
export async function communityRanking(limit = 10) {
  const { list } = await blob();
  const pts = new Map(), lists = new Map();
  let cursor, total = 0;
  for (let page = 0; page < 5; page++) {
    const r = await list({ prefix: "rank/", limit: 1000, cursor });
    for (const b of r.blobs || []) {
      const ids = String(b.pathname).split("/")[2]?.replace(/\.txt$/, "").split("_").map(Number).filter(Boolean).slice(0, 10) || [];
      if (!ids.length) continue;
      total += 1;
      ids.forEach((id, i) => { pts.set(id, (pts.get(id) || 0) + (10 - i)); lists.set(id, (lists.get(id) || 0) + 1); });
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  const top = [...pts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, p]) => ({ id, pontos: p, listas: lists.get(id) }));
  return { total, top };
}
