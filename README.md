# Detetive Anime

Site onde você descreve o personagem (ou envia um print da cena) e descobre de qual anime ele é, em que episódio aparece e onde assistir de forma oficial no Brasil. Tem também jogo, teste, ranking, tier list, favoritos e o personagem do dia.

## O que o site faz

- **Pesquisar**: por nome, obra, apelido, poder ou organização ("Gojo", "Jujutsu Kaisen", "Seis Olhos"), com sugestões enquanto digita.
- **Página do personagem**: foto, nome, anime, poderes, personalidade, frases marcantes, curiosidades, personagens relacionados e onde assistir.
- **Tendências da comunidade**: os personagens mais procurados da semana no site e os que estão em alta no mundo.
- **Quem ganha?**: escolha dois personagens e a IA diz quem venceria a luta.
- **Calendário da temporada**: episódios novos dos próximos 7 dias, com horário de Brasília e contagem regressiva dos animes que você acompanha.
- **Conquistas**: 25 medalhas para desbloquear usando o site.
- **Coleções**: crie coleções com o nome que quiser e guarde seus personagens.
- **Buscar pela descrição**: descreva o personagem ou mande um print. A IA dá os palpites e o AniList confirma com foto, aniversário, idade e gênero oficiais. Com print, o trace.moe acha o episódio e o minuto.
- **Personagem do dia**: o aniversariante de hoje mais querido no AniList (data oficial), com curiosidades, cores e um efeito especial escolhidos pela IA.
- **Jogo**: "Quem é esse personagem?" com 3 pistas, 4 opções, pontos, sequência e recorde.
- **Teste**: "Qual personagem você é?" com 8 perguntas.
- **Ranking e Tier List**: monte o seu top 10 e a sua tier list S, A, B, C e D.
- **Favoritos** e **Últimas buscas**.
- **Configurações**: temas de cores (incluindo Corte Carmesim e Vazio Infinito), modo claro/escuro, fontes, 15 efeitos de fundo e sons.

Só aparecem plataformas oficiais. Conteúdo adulto é filtrado.

## Estrutura

```
public/index.html   o site inteiro (visual, efeitos, sons e telas)
api/search.js      busca por descrição e por print
api/find.js        pesquisa por nome, obra, apelido, poder ou organização
api/character.js   página do personagem
api/versus.js      quem ganha a luta
api/trends.js      tendências da semana
api/schedule.js    calendário da temporada
api/daily.js       personagem do dia (aniversariantes do AniList)
api/game.js        rodada do jogo
api/quiz.js        resultado do teste
api/health.js      mostra quais partes estão configuradas
lib/                AniList, IA, trace.moe, TMDB e funções comuns
test/               testes
```

## Publicar no Vercel

1. Suba o conteúdo desta pasta (não a pasta em si) para um repositório no GitHub e importe no Vercel, com Framework Preset "Other".
2. Em **Settings → Environment Variables**, cadastre:
   - `GEMINI_API_KEY` (ou `ANTHROPIC_API_KEY`) para a busca por descrição, o jogo, o teste e os textos do personagem do dia
   - `BLOB_READ_WRITE_TOKEN` para as tendências da comunidade (o Vercel cria sozinho quando um Blob store é ligado ao projeto)
   - `TMDB_TOKEN` (opcional) para mostrar os logos das plataformas no Brasil
   - `TRACE_MOE_KEY` (opcional) para mais buscas por print
3. Faça um novo deploy (Deployments → ⋯ → Redeploy).

Sem chave nenhuma, a busca por print e o personagem do dia (sem as curiosidades) já funcionam.

**Importante:** o site é público, e cada busca, rodada do jogo ou teste usa a sua chave de IA. No painel do Google AI Studio (ou no console da Anthropic) coloque um limite de gasto mensal pra não ter surpresa.

## Rodar localmente

```
npm i -g vercel
cp .env.example .env   # preencha as chaves
vercel dev
```

Testes: `npm test`

## Créditos dos dados

Personagens, fotos e aniversários: [AniList](https://anilist.co). Busca por cena: [trace.moe](https://trace.moe). Onde assistir: [JustWatch](https://www.justwatch.com/br) via [TMDB](https://www.themoviedb.org). O crédito ao JustWatch é exigido pelo TMDB e precisa continuar no rodapé.
