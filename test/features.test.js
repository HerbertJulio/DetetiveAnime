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
  assert.equal(b.cor2, "#33CCFF");
  const { vivid } = await import("../api/character.js");
  assert.equal(vivid("#FFFFFF"), null);
  assert.equal(vivid("#3B82F6"), "#3B82F6");
  assert.deepEqual(b.related.map((r) => r.name), ["Yuuji Itadori"]);
  assert.equal(b.watch.official[0].name, "Crunchyroll");
});

test("comparar devolve o vencedor do lado certo mesmo com a ordem trocada", async () => {
  process.env.GEMINI_API_KEY = "g";
  const sukuna = { ...gojo, id: 5, name: { full: "Ryoumen Sukuna" } };
  let prompt = "";
  const full = (c, desc) => ({ ...c, description: desc, media: { edges: [{ characterRole: "MAIN", node: { id: 1, type: "ANIME", isAdult: false, title: { english: "JUJUTSU KAISEN" } } }] } });
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) { prompt = JSON.parse(o.body).contents[0].parts.at(-1).text;
      return gemini({ vencedor: "B", confianca: 70, manchete: "Duelo!", atributos: { A: { forca: 90 }, B: { forca: 95 } }, habilidades_B: ["Infinito", "Vazio Infinito"], vantagens_A: ["x"], vantagens_B: ["y"] }); }
    const { variables } = JSON.parse(o.body);
    return { data: { Character: variables.id === 5 ? full(sukuna, "King of Curses with Malevolent Shrine.") : full(gojo, "Uses Limitless and the Six Eyes.") } };
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
  // A IA recebe a ficha de verdade e o vencedor sai da soma dos atributos (mesmo se a IA disser outro)
  assert.match(prompt, /Limitless and the Six Eyes/);
  assert.match(prompt, /Malevolent Shrine/);
  assert.deepEqual(res.body.a.habilidades, ["Infinito", "Vazio Infinito"]);
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

test("nome pouco conhecido também pergunta pra IA (ex.: organização Akatsuki)", async () => {
  process.env.GEMINI_API_KEY = "g";
  const weak = { ...gojo, id: 81369, favourites: 1296, name: { full: "Akatsuki", alternative: [] } };
  const itachi = { ...gojo, id: 14, name: { full: "Itachi Uchiha" }, media: { nodes: [{ id: 20, type: "ANIME", isAdult: false, title: { romaji: "NARUTO", english: "Naruto" } }] } };
  const yona = { ...jjk, id: 20770, title: { romaji: "Akatsuki no Yona", english: "Yona of the Dawn" }, synonyms: [] };
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) return gemini({ tipo: "organizacao", explicacao: "A Akatsuki é uma organização de ninjas.", personagens: [{ nome: "Itachi Uchiha", anime: "Naruto", motivo: "Membro" }] });
    const q = JSON.parse(o.body).query;
    if (q.includes("c0:")) return { data: { c0: { characters: [itachi] } } };
    return { data: { chars: { characters: [weak] }, shows: { media: [yona] } } };
  });
  const { find } = await import("../api/find.js");
  const r = await find("Akatsuki", false);
  assert.equal(r.tipo, "organizacao");
  assert.equal(r.resultados[0].name, "Itachi Uchiha");
  assert.equal(r.outros[0].name, "Akatsuki");
  assert.equal(r.obra, null);
});

test("calendário traz os episódios da semana sem conteúdo adulto", async () => {
  const sched = (id, adult, at) => ({ airingAt: at, episode: 3, media: { id, isAdult: adult, siteUrl: "u", episodes: 12, popularity: 9000, title: { romaji: "R" + id }, coverImage: { large: "c" }, externalLinks: [{ site: "Crunchyroll", url: "https://cr", type: "STREAMING" }] } });
  let pages = 0;
  globalThis.fetch = fakeFetch((u, o) => {
    pages++;
    const { page } = JSON.parse(o.body).variables;
    return { data: { Page: { pageInfo: { hasNextPage: page < 2 }, airingSchedules: page === 1 ? [sched(1, false, 100), sched(2, true, 200)] : [sched(3, false, 300)] } } };
  });
  const { default: handler } = await import("../api/schedule.js");
  const res = fakeRes();
  await handler({ method: "GET", query: {} }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.episodios.map((e) => e.id), [1, 3]);
  assert.equal(res.body.episodios[0].onde[0].name, "Crunchyroll");
  assert.equal(pages, 2);
});

test("votação dos fãs conta os votos de cada lado", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "x";
  let saved = [];
  globalThis.__blobMock = { put: async (p) => { if (!saved.includes(p)) saved.push(p); }, del: async (urls) => { saved = saved.filter((p) => !urls.includes("u:" + p)); },
    list: async ({ prefix }) => ({ blobs: saved.filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, url: "u:" + pathname })), hasMore: false }) };
  const { default: handler } = await import("../api/versus.js");
  const vote = (ip, voto) => handler({ method: "POST", query: {}, headers: { "x-real-ip": ip }, body: { a: 7, b: 3, voto } }, fakeRes());
  await vote("1.1.1.1", 7); await vote("2.2.2.2", 7); await vote("3.3.3.3", 3);
  await vote("1.1.1.1", 7); // a mesma pessoa votando de novo não conta duas vezes
  await vote("4.4.4.4", 7); await vote("4.4.4.4", 3); // mudou de ideia: o voto troca de lado
  const res = fakeRes();
  await handler({ method: "GET", query: { a: "3", b: "7", votos: "1" } }, res);
  assert.deepEqual(res.body.votos, { 3: 2, 7: 2 });
  const bad = fakeRes();
  await handler({ method: "POST", query: {}, body: { a: 7, b: 3, voto: 9 } }, bad);
  assert.equal(bad.code, 400);
  delete globalThis.__blobMock; delete process.env.BLOB_READ_WRITE_TOKEN;
});

test("o que assistir: parecidos com o anime, com motivo e sem conteúdo adulto", async () => {
  process.env.GEMINI_API_KEY = "g";
  const rec = (id, extra = {}) => ({ id, type: "ANIME", isAdult: false, siteUrl: "u", title: { english: "A" + id }, coverImage: { large: "c" }, genres: ["Action"], externalLinks: [], ...extra });
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) return gemini({ motivos: { 2: "Lutas incríveis." } });
    return { data: { Media: { ...rec(1), recommendations: { nodes: [{ mediaRecommendation: rec(2) }, { mediaRecommendation: rec(3, { isAdult: true }) }, { mediaRecommendation: rec(4, { genres: ["Ecchi"] }) }] } } } };
  });
  const { default: handler } = await import("../api/recommend.js");
  const res = fakeRes();
  await handler({ method: "GET", query: { id: "1" } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.recs.map((r) => r.id), [2]);
  assert.equal(res.body.recs[0].motivo, "Lutas incríveis.");
});

test("ranking da comunidade soma os pontos dos rankings enviados", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "x";
  let saved = [];
  globalThis.__blobMock = {
    put: async (p) => { saved.push(p); },
    del: async (urls) => { saved = saved.filter((p) => !urls.includes("u:" + p)); },
    list: async ({ prefix }) => ({ blobs: saved.filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, url: "u:" + pathname })), hasMore: false }),
  };
  const mk = (id, full, fav) => ({ id, favourites: fav, name: { full, alternative: [] }, image: {}, media: { nodes: [] } });
  globalThis.fetch = fakeFetch((u, o) => {
    const { query, variables } = JSON.parse(o.body);
    if (query.includes("c0:")) {
      const pool = { Gojo: [mk(10, "Satoru Gojou", 9)], Luffy: [mk(20, "Luffy Monkey", 9)], Naruto: [mk(30, "Naruto Uzumaki", 9)] };
      return { data: Object.fromEntries(Object.keys(variables).map((k, i) => [`c${i}`, { characters: pool[variables[k]] || [] }])) };
    }
    if (query.includes("id_in")) return { data: { Page: { characters: [mk(10, "Satoru Gojou", 9), mk(20, "Luffy Monkey", 9), mk(30, "Naruto Uzumaki", 9)] } } };
    return { data: { Page: { media: [] } } };
  });
  const { default: handler } = await import("../api/trends.js");
  const send = (ip, nomes) => handler({ method: "POST", headers: { "x-forwarded-for": ip + ", 10.0.0.1" }, body: { tipo: "ranking", nomes: nomes.map((name) => ({ name })) } }, fakeRes());
  await send("9.9.9.1", ["Gojo", "Luffy", "Naruto"]);
  await send("9.9.9.1", ["Luffy", "Gojo", "Naruto"]); // mandou de novo: troca o antigo
  await send("9.9.9.2", ["Luffy", "Naruto", "Gojo"]);
  const res = fakeRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.body.comunidade.total, 2);
  assert.deepEqual(res.body.comunidade.top.map((c) => [c.name, c.pontos]), [["Luffy Monkey", 20], ["Satoru Gojou", 17], ["Naruto Uzumaki", 17]]);
  delete globalThis.__blobMock; delete process.env.BLOB_READ_WRITE_TOKEN;
});

test("desafio do dia confere o palpite no servidor e só revela no fim", async () => {
  const mk = (id, gender, age, animeId, year, genres, fav) => ({ id, favourites: fav, gender, age: String(age), name: { full: "P" + id }, image: { large: "i" },
    media: { nodes: [{ id: animeId, isAdult: false, title: { romaji: "A" + animeId }, genres, startDate: { year } }] } });
  const people = { 1: mk(1, "Male", 28, 10, 2020, ["Action", "Supernatural"], 9000), 2: mk(2, "Female", 16, 20, 2015, ["Action"], 4000) };
  globalThis.fetch = fakeFetch((u, o) => {
    const { query, variables } = JSON.parse(o.body);
    if (query.includes("FAVOURITES_DESC")) return { data: { Page: { characters: [{ id: 1 }] } } };
    return { data: { Character: people[variables.id] } };
  });
  const { default: handler, compare, prova, todayKey } = await import("../api/desafio.js");
  const pv = (n) => prova(todayKey(), n);
  const r1 = fakeRes();
  await handler({ method: "POST", query: {}, body: { id: 2, tentativa: 1 } }, r1);
  assert.equal(r1.body.acertou, false);
  assert.equal(r1.body.resposta, null);
  assert.deepEqual(r1.body.comparacao, { anime: "errado", genero: "errado", idade: "mais", estreia: "mais", generos: "perto", generosIguais: ["Action"], fama: "mais" });
  const r3 = fakeRes();
  await handler({ method: "POST", query: {}, body: { id: 2, tentativa: 5, prova: pv(4) } }, r3);
  assert.equal(r3.body.dicas.length, 5);
  // Sem a prova assinada não dá pra pular direto pra última tentativa e ver a resposta.
  const cheat = fakeRes();
  await handler({ method: "POST", query: {}, body: { id: 2, tentativa: 6 } }, cheat);
  assert.equal(cheat.body.resposta, null);
  assert.equal(cheat.body.tentativa, 1);
  const last = fakeRes();
  await handler({ method: "POST", query: {}, body: { id: 2, tentativa: 6, prova: pv(5) } }, last);
  assert.equal(last.body.resposta.id, 1);
  const win = fakeRes();
  await handler({ method: "POST", query: {}, body: { id: 1, tentativa: 2 } }, win);
  assert.equal(win.body.acertou, true);
  assert.equal(win.body.resposta.id, 1);
  const en = fakeRes();
  await handler({ method: "POST", query: {}, body: { id: 2, tentativa: 3, prova: pv(2), lang: "en" } }, en);
  assert.match(en.body.dicas[0], /^The anime's genres/);
});

test("com lang=en a IA recebe o pedido pra responder em inglês", async () => {
  process.env.GEMINI_API_KEY = "g";
  let sent = "";
  globalThis.fetch = fakeFetch((u, o) => { if (u.includes("generativelanguage")) { sent = JSON.parse(o.body).contents[0].parts.at(-1).text; return gemini({ motivos: {} }); }
    return { data: { Media: { id: 1, type: "ANIME", isAdult: false, title: { english: "X" }, genres: [], coverImage: {}, externalLinks: [], recommendations: { nodes: [{ mediaRecommendation: { id: 2, type: "ANIME", isAdult: false, title: { english: "Y" }, genres: [], coverImage: {}, externalLinks: [] } }] } } } }; });
  const { default: handler } = await import("../api/recommend.js");
  await handler({ method: "GET", query: { id: "1", lang: "en" } }, fakeRes());
  assert.match(sent, /Write every text value of the JSON in natural English/);
  await handler({ method: "GET", query: { id: "1" } }, fakeRes());
  assert.doesNotMatch(sent, /natural English/);
});


test("onde assistir não mostra o YouTube", async () => {
  const { streamingLinks } = await import("../lib/anilist.js");
  const links = streamingLinks({ externalLinks: [{ type: "STREAMING", site: "YouTube", url: "https://www.youtube.com/x" }, { type: "STREAMING", site: "Crunchyroll", url: "https://cr.com/x" }] });
  assert.deepEqual(links.map((l) => l.name), ["Crunchyroll"]);
});

test("quem ganha: as notas são ajustadas pra concordar com o veredito da IA", async () => {
  process.env.GEMINI_API_KEY = "g";
  const mk = (id, n) => ({ id, name: { full: n }, image: {}, favourites: 1, description: "x", media: { edges: [{ characterRole: "MAIN", node: { id, type: "ANIME", isAdult: false, title: { english: "W" + id } } }] } });
  globalThis.fetch = fakeFetch((u, o) => {
    if (u.includes("generativelanguage")) return gemini({ vencedor: "B", confianca: 80, atributos: { A: { forca: 99, velocidade: 99, inteligencia: 90, tecnica: 90, resistencia: 90, poderes: 90 }, B: { forca: 95, velocidade: 95, inteligencia: 80, tecnica: 80, resistencia: 90, poderes: 99 } } });
    const { variables } = JSON.parse(o.body); return { data: { Character: mk(variables.id, "P" + variables.id) } };
  });
  const { default: handler } = await import("../api/versus.js");
  const res = fakeRes();
  await handler({ method: "GET", query: { a: "10", b: "20" } }, res);
  assert.equal(res.body.vencedor, "b");
  assert.ok(res.body.b.total > res.body.a.total);
  assert.equal(res.body.confianca, 80);
});
