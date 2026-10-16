import { test } from "node:test";
import assert from "node:assert/strict";
import { pickMedia, normalize } from "../lib/anilist.js";
import { groupProviders } from "../lib/tmdb.js";
import { parseJson } from "../lib/ai.js";
import { formatTime } from "../lib/trace.js";

const naruto = { id: 20, type: "ANIME", format: "TV", isAdult: false, siteUrl: "https://anilist.co/anime/20",
  title: { romaji: "NARUTO", english: "Naruto", native: "ナルト" }, coverImage: { large: "c.jpg" },
  externalLinks: [{ site: "Crunchyroll", url: "https://www.crunchyroll.com/naruto", type: "STREAMING" }, { site: "Twitter", url: "https://x.com/n", type: "SOCIAL" }] };
const shippuden = { ...naruto, id: 1735, title: { romaji: "Naruto: Shippuuden", english: "Naruto Shippuden", native: "ナルト 疾風伝" } };

function fakeFetch(routes) {
  return async (url, opts = {}) => {
    const u = String(url);
    for (const [match, reply] of routes) {
      if (u.includes(match)) {
        const body = typeof reply === "function" ? reply(u, opts) : reply;
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
}

function fakeRes() {
  const res = { code: 0, body: null, headers: {} };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

test("helpers", () => {
  assert.equal(normalize("Naruto: Shippūden!"), "naruto shippuden");
  assert.equal(pickMedia([shippuden, naruto], "Naruto").id, 20);
  assert.equal(pickMedia([{ ...naruto, isAdult: true }], "Naruto"), null);
  assert.deepEqual(parseJson('Aqui:\n```json\n{"resultados":[]}\n```'), { resultados: [] });
  assert.equal(formatTime(125.7), "2:05");
  const g = groupProviders({ flatrate: [{ provider_id: 1, provider_name: "Crunchyroll", logo_path: "/a.png" }], buy: [{ provider_id: 1, provider_name: "Crunchyroll" }, { provider_id: 2, provider_name: "Apple TV" }] });
  assert.deepEqual(g.map((p) => [p.name, p.kind]), [["Crunchyroll", "Assinatura"], ["Apple TV", "Compra"]]);
});

test("busca por descrição de ponta a ponta", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  process.env.TMDB_TOKEN = "eyJtest";
  globalThis.fetch = fakeFetch([
    ["api.anthropic.com", { content: [{ type: "text", text: '{"resultados":[{"personagem":"Naruto Uzumaki","anime":"Naruto","confianca":95,"por_que":"Marcas no rosto."}]}' }] }],
    ["graphql.anilist.co", { data: { Page: { characters: [{ id: 17, siteUrl: "https://anilist.co/character/17", name: { full: "Naruto Uzumaki", native: "うずまきナルト" }, image: { large: "n.jpg" }, media: { nodes: [shippuden, naruto] } }] } } }],
    ["/search/tv", { results: [{ id: 46260, name: "Naruto", original_language: "ja", genre_ids: [16] }] }],
    ["/watch/providers", { results: { BR: { link: "https://www.themoviedb.org/tv/46260/watch?locale=BR", flatrate: [{ provider_id: 283, provider_name: "Crunchyroll", logo_path: "/c.png" }] } } }],
  ]);
  const { default: handler } = await import("../api/search.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { description: "loiro, olhos azuis, riscos na bochecha" } }, res);
  assert.equal(res.code, 200);
  const r = res.body.results[0];
  assert.equal(r.character.name, "Naruto Uzumaki");
  assert.equal(r.anime.id, 20);
  assert.equal(r.watch.tmdb.providers[0].name, "Crunchyroll");
  assert.deepEqual(r.watch.official, [{ name: "Crunchyroll", url: "https://www.crunchyroll.com/naruto" }]);
  assert.deepEqual(res.body.notes, []);
});

test("busca por print sem chaves configuradas", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.TMDB_TOKEN;
  globalThis.fetch = fakeFetch([
    ["api.trace.moe", { result: [{ anilist: { id: 20, isAdult: false }, episode: 3, from: 754.2, similarity: 0.95, video: "https://api.trace.moe/video/20/x.mp4?t=1" }] }],
    ["graphql.anilist.co", { data: { Media: naruto } }],
  ]);
  const { default: handler } = await import("../api/search.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { image: { base64: Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]), Buffer.alloc(16)]).toString("base64"), mediaType: "image/jpeg" } } }, res);
  assert.equal(res.code, 200);
  const r = res.body.results[0];
  assert.equal(r.source, "print");
  assert.equal(r.scene.episode, 3);
  assert.equal(r.scene.time, "12:34");
  assert.equal(r.watch.tmdb, null);
  assert.deepEqual(r.watch.official, [{ name: "Crunchyroll", url: "https://www.crunchyroll.com/naruto" }]);
  assert.ok(!res.body.notes.some((n) => n.includes("plataformas")));
});

const jjk = { id: 113415, type: "ANIME", format: "TV", isAdult: false, siteUrl: "https://anilist.co/anime/113415",
  title: { romaji: "Jujutsu Kaisen", english: "JUJUTSU KAISEN", native: "呪術廻戦" }, coverImage: { large: "j.jpg" }, externalLinks: [] };

test("Gojo: busca pelo nome falha, acha pelo elenco do anime", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  delete process.env.TMDB_TOKEN;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    let body;
    if (u.includes("anthropic")) body = { content: [{ type: "text", text: '{"resultados":[{"personagem":"Satoru Gojo","nomes_busca":["Gojo Satoru","Satoru Gojou"],"anime":"Jujutsu Kaisen","anime_br":"Jujutsu Kaisen","confianca":97,"por_que":"Cabelo branco e venda nos olhos."}]}' }] };
    else if (JSON.parse(opts.body).query.includes("characters(search")) body = { data: { Page: { characters: [] } } };
    else body = { data: { Page: { media: [{ ...jjk, characters: { nodes: [{ id: 127691, siteUrl: "s", name: { full: "Satoru Gojou", native: "五条悟", alternative: [] }, image: { large: "g.jpg" } }] } }] } } };
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  };
  const { default: handler } = await import("../api/search.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { description: "cabelo branco, venda nos olhos, olhos azuis" } }, res);
  const r = res.body.results[0];
  assert.equal(r.character.name, "Satoru Gojou");
  assert.equal(r.character.image, "g.jpg");
  assert.equal(r.anime.id, 113415);
});

test("AniList fora do ar: o palpite da IA aparece mesmo assim", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  globalThis.fetch = async (url) => {
    if (String(url).includes("anthropic")) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"resultados":[{"personagem":"Satoru Gojo","anime":"Jujutsu Kaisen","confianca":90,"por_que":"x"}]}' }] }) };
    return { ok: false, status: 403, json: async () => ({}), text: async () => "" };
  };
  const { default: handler } = await import("../api/search.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { description: "cabelo branco" } }, res);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].character.name, "Satoru Gojo");
  assert.equal(res.body.results[0].anime.title, "Jujutsu Kaisen");
  assert.ok(res.body.notes.some((n) => n.includes("fotos")));
});

test("rejeita pedido vazio", async () => {
  const { default: handler } = await import("../api/search.js");
  const res = fakeRes();
  await handler({ method: "POST", body: {} }, res);
  assert.equal(res.code, 400);
});


test("personagem do dia vem do AniList (data oficial) e a IA só escreve o texto", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  delete process.env.TMDB_TOKEN;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    let body;
    if (u.includes("anthropic")) body = { content: [{ type: "text", text: '{"frase":"Oi!","curiosidades":["Ama lámen.","Nasceu em 14 de outubro.","Quer ser Hokage."],"efeito":"vento","cor1":"#FF8800","cor2":"zzz"}' }] };
    else {
      assert.ok(JSON.parse(opts.body).query.includes("isBirthday: true"));
      body = { data: { Page: { characters: [
        { id: 17, siteUrl: "s", favourites: 9, gender: "Male", age: "12", name: { full: "Naruto Uzumaki", native: "うずまきナルト" }, image: { large: "n.jpg" }, dateOfBirth: { month: 10, day: 10 }, media: { nodes: [naruto] } },
        { id: 2, siteUrl: "s2", favourites: 1, name: { full: "Outro" }, image: { large: "o.jpg" }, dateOfBirth: { month: 10, day: 10 }, media: { nodes: [naruto] } },
      ] } } };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  };
  const { default: handler } = await import("../api/daily.js");
  const res = fakeRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.personagem, "Naruto Uzumaki");
  assert.equal(res.body.aniversario, "10 de outubro");
  assert.equal(res.body.imagem, "n.jpg");
  assert.equal(res.body.efeito, "vento");
  assert.equal(res.body.cor2, "#FFB15C");
  assert.deepEqual(res.body.curiosidades, ["Ama lámen.", "Quer ser Hokage."]);
  assert.equal(res.body.outros[0].personagem, "Outro");
});

test("jogo sem chave da IA avisa o motivo", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { default: handler } = await import("../api/game.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { diff: "facil" } }, res);
  assert.equal(res.code, 500);
  assert.match(res.body.error, /GEMINI_API_KEY/);
});

test("jogo devolve 4 opções com a resposta no meio", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"pistas":["a","b","c"],"resposta":"Naruto Uzumaki","anime":"Naruto","opcoes":["Boruto","Minato","Deidara","Naruto Uzumaki","Extra"],"curiosidade":"x"}' }] }) });
  const { default: handler } = await import("../api/game.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { diff: "medio", seen: ["Goku"] } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.opcoes.length, 4);
  assert.ok(res.body.opcoes.includes("Naruto Uzumaki"));
});

test("teste devolve o personagem com foto do AniList", async () => {
  process.env.ANTHROPIC_API_KEY = "x";
  globalThis.fetch = async (url) => {
    if (String(url).includes("anthropic")) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"personagem":"Naruto Uzumaki","anime":"Naruto","por_que":"Você é corajoso.","tracos":["Corajoso","Leal","Comilão"],"criador":"Masashi Kishimoto","plataformas":["Crunchyroll"]}' }] }) };
    return { ok: true, status: 200, json: async () => ({ data: { Page: { characters: [{ id: 17, siteUrl: "s", gender: "Male", name: { full: "Naruto Uzumaki" }, image: { large: "n.jpg" }, dateOfBirth: { month: 10, day: 10 }, media: { nodes: [naruto] } }] } } }) };
  };
  const { default: handler } = await import("../api/quiz.js");
  const res = fakeRes();
  await handler({ method: "POST", body: { respostas: ["a", "b", "c", "d"] } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.result.character.image, "n.jpg");
  assert.equal(res.body.result.facts.aniversario, "10 de outubro");
  assert.equal(res.body.tracos.length, 3);
});

test("Gemini responde quando a GEMINI_API_KEY existe", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = "g";
  let headers = null;
  globalThis.fetch = fakeFetch([
    ["generativelanguage.googleapis.com", (u, o) => { headers = o.headers; return { candidates: [{ content: { parts: [{ text: '{"resultados":[{"personagem":"Naruto Uzumaki","anime":"Naruto"}]}' }] } }] }; }],
  ]);
  const { guessCharacters, provider } = await import("../lib/ai.js");
  assert.equal(provider(), "gemini");
  const r = await guessCharacters("loiro", null);
  assert.equal(r[0].personagem, "Naruto Uzumaki");
  assert.equal(headers["x-goog-api-key"], "g");
  delete process.env.GEMINI_API_KEY;
});
