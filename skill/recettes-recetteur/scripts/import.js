// Extraction du JSON d'une réponse collée telle quelle depuis un chat (blocs ```json, texte autour…).
export function extractJson(text) {
  let s = String(text ?? '').trim();
  if (!s) throw new Error('Rien à importer : le texte est vide.');
  const fenced = s.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    // Texte autour du JSON : on tente de découper du premier { ou [ au dernier } ou ].
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch { /* on remonte l'erreur d'origine */ }
    }
    throw new Error(`JSON invalide : ${e.message}`);
  }
}
