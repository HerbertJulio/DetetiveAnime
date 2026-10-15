import { aiEnabled } from "../lib/ai.js";
import { tmdbEnabled } from "../lib/tmdb.js";

// Mostra para a página quais buscas estão ligadas, sem expor nenhuma chave.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ descricao: aiEnabled(), print: true, ondeAssistir: tmdbEnabled() });
}
