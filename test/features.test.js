import { test } from "node:test";
import assert from "node:assert/strict";

function fakeFetch(handler) {
  return async (url, opts = {}) => {
    const body = await handler(String(url), opts);
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}
function fakeRes() {
  const res = { code: 0, body: null, headers: {} };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const gemini = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const gojo = { id: 127691, siteUrl: "https://anilist.co/character/127691", favourites: 90000, name: { full: "Satoru Gojou", native: "五条悟", alternative: ["Gojo"] }, image: { large: "g.jpg" },
  media: { nodes: [{ id: 113415, type: "ANIME", isAdult: false, title: { romaji: "Jujutsu Kaisen", english: "JUJUTSU KAISEN" } }] } };
const jjk = { id: 113415, siteUrl: "https://anilist.co/anime/113415", synonyms: ["JJK"], title: { romaji: "Jujutsu Kaisen", english: "JUJUTSU KAISEN", native: "呪術廻戦" }, coverImage: { large: "c.jpg" },
  characters: { edges: [{ role: "MAIN", node: { ...gojo, id: 1, name: { full: "Yuuji Itadori", alternative: [] } } }] } };

test("pesquisa pelo nome acha o personagem sem usar IA", async () => {
  process.env.GEMINI_API_KEY = "g";
  let usedAi = false;
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) { usedAi = true; return gemini({}); }
    return { data: { chars: { characters: [gojo] }, shows: { media: [] } } };
  });
  const { default: handler } = await import("../api/find.js");
  const res = fakeRes();
  await handler({ query: { q: "Gojo" } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.tipo, "personagem");
  assert.equal(res.body.resultados[0].name, "Satoru Gojou");
  assert.equal(res.body.resultados[0].anime, "JUJUTSU KAISEN");
  assert.equal(usedAi, false);
});

test("pesquisa pela obra lista os personagens dela", async () => {
  globalThis.fetch = fakeFetch(() => ({ data: { chars: { characters: [] }, shows: { media: [jjk] } } }));
  const { find } = await import("../api/find.js");
  const r = await find("Jujutsu Kaisen", false);
  assert.equal(r.tipo, "obra");
  assert.equal(r.obra.title, "JUJUTSU KAISEN");
  assert.equal(r.obra.personagens[0].name, "Yuuji Itadori");
});

test("pesquisa por poder usa a IA e confirma no AniList", async () => {
  process.env.GEMINI_API_KEY = "g";
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) return gemini({ tipo: "poder", explicacao: "Os Seis Olhos são uma habilidade rara.", personagens: [{ nome: "Satoru Gojo", anime: "Jujutsu Kaisen", motivo: "Dono dos Seis Olhos" }] });
    const q = JSON.parse(o.body).query;
    if (q.includes("c0:")) return { data: { c0: { characters: [gojo] } } };
    return { data: { chars: { characters: [] }, shows: { media: [] } } };
  });
  const { find } = await import("../api/find.js");
  const r = await find("Seis Olhos", false);
  assert.equal(r.tipo, "poder");
  assert.match(r.explicacao, /Seis Olhos/);
  assert.equal(r.resultados[0].id, 127691);
  assert.equal(r.resultados[0].motivo, "Dono dos Seis Olhos");
});

test("página do personagem junta AniList e IA", async () => {
  process.env.GEMINI_API_KEY = "g";
  delete process.env.TMDB_TOKEN;
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) return gemini({ resumo: "O feiticeiro mais forte.", poderes: [{ nome: "Infinito", descricao: "Nada encosta nele." }], frases: ["Fica tranquilo."], curiosidades: ["Adora doces."], cor1: "#33CCFF", cor2: "nada" });
    const q = JSON.parse(o.body).query;
    if (q.includes("Character(id")) return { data: { Character: { ...gojo, gender: "Male", age: "28", dateOfBirth: { month: 12, day: 7 }, description: "__Height:__ 190 cm\nStrongest.",
      media: { edges: [{ characterRole: "MAIN", node: { ...jjk, type: "ANIME", isAdult: false, format: "TV", externalLinks: [{ site: "Crunchyroll", url: "https://www.crunchyroll.com/jjk", type: "STREAMING" }], startDate: { year: 2020 } } }] } } } };
    if (q.includes("Media(id")) return { data: { Media: { characters: { edges: [{ role: "MAIN", node: { id: 1, name: { full: "Yuuji Itadori" }, image: { large: "y.jpg" } } }, { role: "MAIN", node: { id: 127691, name: { full: "Satoru Gojou" }, image: {} } }] } } } };
  });
  const { default: handler } = await import("../api/character.js");
  const res = fakeRes();
  await handler({ method: "GET", query: { id: "127691" } }, res);
  assert.equal(res.code, 200);
  const b = res.body;
  assert.equal(b.name, "Satoru Gojou");
  assert.equal(b.facts.aniversario, "7 de dezembro");
  assert.equal(b.facts.altura, "190 cm");
  assert.equal(b.poderes[0].nome, "Infinito");
  assert.equal(b.cor1, "#33CCFF");
  assert.equal(b.cor2, null);
  assert.deepEqual(b.related.map((r) => r.name), ["Yuuji Itadori"]);
  assert.equal(b.watch.official[0].name, "Crunchyroll");
});

test("comparar devolve o vencedor do lado certo mesmo com a ordem trocada", async () => {
  process.env.GEMINI_API_KEY = "g";
  const sukuna = { ...gojo, id: 5, name: { full: "Ryoumen Sukuna" } };
  globalThis.fetch = fakeFetch((u) => {
    if (u.includes("generativelanguage")) return gemini({ vencedor: "B", confianca: 70, manchete: "Duelo!", atributos: { A: { forca: 90 }, B: { forca: 95 } }, vantagens_A: ["x"], vantagens_B: ["y"] });
    return { data: { Page: { characters: [gojo, sukuna] } } };
  });
  const { default: handler } = await import("../api/versus.js");
  const res = fakeRes();
  // a=Gojo (id maior), b=Sukuna (id menor): no servidor, A vira Sukuna e B vira Gojo.
  await handler({ method: "GET", query: { a: "127691", b: "5" } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.a.name, "Satoru Gojou");
  assert.equal(res.body.vencedor, "a");
  assert.equal(res.body.a.stats.forca, 95);
  assert.equal(res.body.b.stats.forca, 90);
});

test("tendências contam as visitas da semana", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "x";
  const saved = [];
  globalThis.__blobMock = {
    put: async (path) => { saved.push(path); return {}; },
    list: async ({ prefix }) => ({ blobs: saved.filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false }),
  };
  globalThis.fetch = fakeFetch((u, o) => {
    const q = JSON.parse(o.body).query;
    if (q.includes("id_in")) return { data: { Page: { characters: [gojo, { ...gojo, id: 1, name: { full: "Yuuji Itadori" } }] } } };
    return { data: { Page: { media: [] } } };
  });
  const { default: handler } = await import("../api/trends.js");
  for (const id of [1, 127691, 127691]) await handler({ method: "POST", body: { id } }, fakeRes());
  const res = fakeRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.local.map((c) => [c.name, c.count]), [["Satoru Gojou", 2], ["Yuuji Itadori", 1]]);
  const bad = fakeRes();
  await handler({ method: "POST", body: { id: "abc" } }, bad);
  assert.equal(bad.code, 400);
  delete globalThis.__blobMock; delete process.env.BLOB_READ_WRITE_TOKEN;
});

test("se um modelo do Gemini estiver lotado, tenta o próximo", async () => {
  process.env.GEMINI_API_KEY = "g"; delete process.env.ANTHROPIC_API_KEY; delete process.env.AI_MODEL;
  const tried = [];
  globalThis.fetch = async (url) => {
    const m = String(url).match(/models\/([^:]+)/)[1]; tried.push(m);
    if (tried.length === 1) return { ok: false, status: 503, json: async () => ({}), text: async () => "busy" };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }), text: async () => "" };
  };
  const { askJson } = await import("../lib/ai.js");
  assert.deepEqual(await askJson("x"), { ok: 1 });
  assert.deepEqual(tried, ["gemini-flash-latest", "gemini-flash-lite-latest"]);
});
