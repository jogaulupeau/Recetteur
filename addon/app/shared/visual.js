// Quelles icônes dessiner pour une recette ? Logique pure (testée) : l'ingrédient réel détermine l'icône,
// la quantité détermine l'importance. Le dessin lui-même vit dans public/js/art.js.
import { normalize } from './text.js';
import { canonicalUnit } from './quantity.js';
import { UNITES } from './vocab.js';

// [expression sur le nom normalisé (sans accents, minuscules, œ→oe), icône]. Le premier qui correspond gagne :
// les cas particuliers passent donc avant les cas généraux (« pomme de terre » avant « pomme »).
export const RULES = [
  [/pate (brisee|feuilletee|sablee|a tarte|a pizza|a crepes|levee|filo)|fond de tarte|pate a /, 'pate'],
  [/patate douce/, 'courge'],
  [/pommes? de terre|patates?|grenailles?|ratte/, 'patate'],
  [/tomate|coulis/, 'tomate'],
  [/carotte/, 'carotte'],
  [/courgette|concombre/, 'courgette'],
  [/aubergine/, 'aubergine'],
  [/poivron/, 'poivron'],
  [/piment|harissa/, 'piment'],
  [/oignon|echalote|ciboule/, 'oignon'],
  [/\bail\b|gousse d ail/, 'ail'],
  [/poireau|celeri|fenouil/, 'poireau'],
  [/champignon|cepe|girolle|pleurote|shiitake|morille/, 'champignon'],
  [/brocoli|chou fleur|romanesco/, 'brocoli'],
  [/salade|laitue|epinard|roquette|\bmache\b|cresson|blette|\bchoux?\b|\bkale\b|jeunes? pousses?|endive|mesclun/, 'feuilles'],
  [/persil|basilic|coriandre|menthe|ciboulette|aneth|cerfeuil|estragon|thym|romarin|sauge|laurier|origan|herbes?/, 'herbes'],
  [/citron|yuzu|pamplemousse|clementine/, 'citron'],
  [/orange|mandarine/, 'orange'],
  [/\bpommes?\b/, 'pomme'],
  [/poire/, 'poire'],
  [/banane/, 'banane'],
  [/fraise|framboise|myrtille|\bmures?\b|cerise|groseille|fruits? rouges?|\bbaies?\b|cassis/, 'baies'],
  [/abricot|peche|nectarine|mangue|ananas|prune|figue|raisin|kiwi|melon|pasteque|datte/, 'fruit'],
  [/avocat/, 'avocat'],
  [/potiron|courge|butternut|citrouille/, 'courge'],
  [/betterave|radis|navet/, 'betterave'],
  [/\bmais\b/, 'mais'],
  [/haricots? verts?|asperge|petits? pois|pois gourmands?|edamame/, 'gousses'],
  [/\boeufs?\b|omelette/, 'oeuf'],   // \b : « boeuf » contient « oeuf »
  [/feta|tofu|paneer|halloumi/, 'cubes'],
  [/mozzarella|burrata|chevre|boursin|ricotta|mascarpone|fromage blanc|faisselle|cottage/, 'boule'],
  [/fromage|parmesan|gruyere|emmental|comte|cheddar|raclette|reblochon|camembert|brie|roquefort|gorgonzola|cantal|mimolette|pecorino|maroilles|tomme|morbier/, 'fromage'],
  [/beurre|margarine/, 'beurre'],
  [/lait de coco|\bcoco\b|noix de coco/, 'coco'],
  [/creme|\blait\b|yaourt|yogourt|skyr|kefir/, 'creme'],
  [/saucisse|chipolata|merguez|chorizo|andouille|saucisson|boudin/, 'saucisse'],
  [/jambon|lardon|bacon|poitrine|pancetta|coppa|\bporc\b|rillette|travers/, 'porc'],
  [/poulet|dinde|canard|volaille|pintade|cuisse|blanc de|escalope de (dinde|poulet)/, 'poulet'],
  [/boeuf|veau|agneau|steak|\bhache|entrecote|bavette|rumsteck|paleron|gigot|viande|bourguignon|\bjoue\b|\bsouris\b|boulette|cote de/, 'viande'],
  [/saumon|cabillaud|\bthon\b|\bcolin\b|\blieu\b|truite|sardine|maquereau|dorade|merlu|poisson|haddock|anchois|morue|julienne|\bbar\b|\bsole\b|\braie\b/, 'poisson'],
  [/crevette|gambas|langoustine|homard|\bcrabe\b|\bmoules?\b|\bcoquilles?\b|saint jacques|calamar|poulpe|fruits de mer|surimi/, 'crevette'],   // \b : « semoule » contient « moule », « coquillettes » contient « coquille »
  [/spaghetti|tagliatelle|penne|macaroni|fusilli|linguine|lasagne|ravioli|tortellini|nouille|vermicelle|coquillette|farfalle|rigatoni|gnocchi|udon|capellini|torsade|\bpates?\b/, 'pates'],
  [/\briz\b|risotto|arborio|basmati|sushi/, 'riz'],
  [/semoule|couscous|boulgour|quinoa|millet|polenta|\borge\b|epeautre|\bble\b/, 'graines'],
  [/lentille|pois chiches?|haricots? (rouges?|blancs?|secs?|noirs?)|flageolet|feves?|soja|pois casses?/, 'legumineuse'],
  [/\bpain\b|baguette|brioche|tortilla|\bwrap\b|\bpita\b|\bnaan\b|burger|crouton|chapelure|biscotte|\btoasts?\b|galette/, 'pain'],
  [/noix|amande|noisette|cacahuete|pistache|pignon|cajou|pecan/, 'noix'],
  [/chocolat|cacao|nutella/, 'chocolat'],
  [/miel|sirop|caramel|confiture|sucre|vanille/, 'miel'],
  [/farine|maizena|fecule|levure|semoule fine/, 'farine'],
  [/olive|capre/, 'olive'],
  [/curry|paprika|cumin|curcuma|cannelle|muscade|epice|gingembre|safran|za atar|ras el hanout|poivre|\bsel\b/, 'epice'],
];

// Ce qui ne se « voit » pas dans l'assiette : jamais dessiné.
const INVISIBLE = /\beau\b|huile|vinaigre|bouillon|fond de|vin\b|biere|cidre|jus\b|sauce soja|moutarde|mayonnaise|ketchup|rhum|cognac|armagnac|alcool|sirop/;

// Poids visuel relatif d'une famille : une feta ou un œuf se reconnaissent même en petite quantité,
// de la farine ou de la crème noient moins le plat que les légumes.
const VISUAL = { oeuf: 1.4, cubes: 1.2, fromage: 1.3, boule: 1.1, creme: 0.35, beurre: 0.5, farine: 0.3, miel: 0.3, epice: 0.15, herbes: 0.6, pate: 0.9, noix: 1.2, olive: 1.2, coco: 0.6 };

// Poids moyen (g) d'une pièce lorsque la recette compte en unités (« 2 oignons »).
const PIECE_G = { oeuf: 55, tomate: 120, oignon: 100, carotte: 80, patate: 150, courgette: 220, aubergine: 250, poivron: 160, citron: 90, orange: 150,
  pomme: 150, poire: 160, banane: 120, avocat: 160, courge: 800, betterave: 100, ail: 5, poulet: 700, viande: 200, porc: 90, saucisse: 90, poisson: 150,
  crevette: 15, pate: 250, pain: 150, champignon: 25, brocoli: 350, feuilles: 150, mais: 200, boule: 125, fromage: 30, cubes: 30, noix: 8 };
const UNIT_G = { 'c. à soupe': 15, 'c. à café': 5, pincée: 0.5, gousse: 5, tranche: 30, botte: 40, bouquet: 40, branche: 3, brin: 1, feuille: 1, sachet: 10, boîte: 400,
  verre: 150, tasse: 150, pot: 125, tête: 60, morceau: 40, poignée: 30, filet: 150, noix: 10, cube: 10, bâton: 20, rouleau: 250, paquet: 250, barquette: 250, bocal: 300, carré: 15, trait: 2, cm: 5 };

/** Icône d'un ingrédient d'après son nom (null = rien de reconnaissable). */
export function iconFor(nom) {
  const n = normalize(nom);
  if (INVISIBLE.test(n) && !/lait de coco/.test(n)) return null;
  // En français le nom principal vient en premier (« pâtes à la crème » = des pâtes) : on retient la règle qui
  // correspond le plus tôt dans le nom ; à égalité, l'ordre des règles (« pomme de terre » avant « pomme »).
  let best = null;
  for (const [re, icon] of RULES) {
    const m = re.exec(n);
    if (m && (!best || m.index < best.index)) best = { icon, index: m.index };
  }
  return best?.icon ?? null;
}

/** Poids approximatif en grammes d'un ingrédient (pour classer ce qui domine l'assiette). */
export function weightOf(ing, icon) {
  if (ing.quantite == null) return 3;
  const q = ing.quantite_max != null ? (ing.quantite + ing.quantite_max) / 2 : ing.quantite;
  const unit = canonicalUnit(ing.unite) ?? '';
  const def = UNITES[unit];
  let g;
  if (def?.famille === 'masse') g = q * def.facteur;
  else if (def?.famille === 'volume') g = q * def.facteur * 0.6; // un liquide pèse moins « à l'œil » qu'un solide
  else if (unit && UNIT_G[unit] != null) g = q * UNIT_G[unit];
  else g = q * (PIECE_G[icon] ?? 100);
  return g * (VISUAL[icon] ?? 1);
}

/**
 * Icônes à dessiner pour une recette : les ingrédients qui dominent, dédoublonnés, du plus au moins important.
 * @returns {{icon:string, weight:number, share:number, noms:string[]}[]}
 */
export function pickIngredients(recette, max = 5) {
  const by = new Map();
  for (const ing of recette.ingredients) {
    const icon = iconFor(ing.nom);
    if (!icon) continue;
    // Les produits de placard (sel, huile, farine, sucre…) restent hors de l'assiette sauf s'ils sont tout ce qu'il y a.
    const w = weightOf(ing, icon) * (ing.basique ? 0.1 : 1) * (ing.optionnel ? 0.4 : 1);
    const cur = by.get(icon) ?? { icon, weight: 0, noms: [], name: ing.nom };
    cur.weight += w;
    cur.noms.push(ing.nom);
    // Pour les variantes de couleur (poivron rouge/vert, oignon rouge…), on garde le nom du plus gros ingrédient.
    if (w > (cur.best ?? 0)) (cur.best = w), (cur.name = ing.nom);
    by.set(icon, cur);
  }
  const list = [...by.values()].filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, max);
  const total = list.reduce((s, x) => s + x.weight, 0) || 1;
  return list.map(({ icon, weight, noms, name }) => ({ icon, weight, share: weight / total, noms, name }));
}

/** Mise en scène : « pie » (tarte, quiche, pizza), « bowl » (soupe, smoothie…), « stack » (crêpes) ou « plate ». */
export function dishForm(recette) {
  const t = normalize(`${recette.titre} ${recette.type === 'dessert' ? '' : ''}`);
  if (/\b(tarte|tartelette|quiche|tourte|pizza|clafoutis|flammekueche|tatin)\b/.test(t)) return 'pie';
  if (/\b(soupe|veloute|potage|gaspacho|minestrone|bouillon|ramen|pho|chowder|dahl|dal|smoothie|milkshake|shake)\b/.test(t)) return 'bowl';
  if (/\b(crepes?|pancakes?|blinis?|gaufres?)\b/.test(t)) return 'stack';
  return 'plate';
}
