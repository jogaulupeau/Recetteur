// Devine le rayon d'un ingrédient quand la recette ne l'indique pas.
import { normalize } from './text.js';

const RULES = [
  ['surgeles', ['surgele', 'glace', 'petits pois surgel']],
  ['boissons', ['vin ', 'biere', 'jus ', 'eau gazeuse', 'cidre', 'rhum', 'cognac', 'sirop', 'cafe', 'the ', 'infusion']],
  ['condiments-epices', ['sel', 'poivre', 'paprika', 'cumin', 'curry', 'cannelle', 'muscade', 'piment', 'epice', 'herbes de provence', 'thym sec', 'laurier', 'curcuma', 'coriandre moulue', 'gingembre moulu', 'vanille', 'moutarde', 'vinaigre', 'sauce soja', 'ketchup', 'mayonnaise', 'cornichon', 'tabasco', 'bouillon', 'fond de', 'sauce worcestershire', 'harissa', 'nuoc', 'miso']],
  ['boulangerie', ['pain', 'baguette', 'brioche', 'tortilla', 'wrap', 'pate a pizza', 'burger bun', 'pita', 'naan', 'chapelure', 'croute']],
  ['fruits-legumes', ['tomate', 'oignon', 'echalote', 'ail', 'carotte', 'courgette', 'aubergine', 'poivron', 'pomme de terre', 'patate', 'salade', 'laitue', 'epinard', 'champignon', 'poireau', 'chou', 'brocoli', 'haricot vert', 'concombre', 'radis', 'celeri', 'fenouil', 'betterave', 'potiron', 'courge', 'citron', 'orange', 'pomme', 'poire', 'banane', 'fraise', 'framboise', 'peche', 'abricot', 'ananas', 'mangue', 'avocat', 'persil', 'basilic', 'coriandre', 'menthe', 'ciboulette', 'thym', 'romarin', 'aneth', 'gingembre', 'navet', 'panais', 'endive', 'asperge', 'artichaut', 'cresson', 'roquette', 'mache', 'raisin', 'kiwi', 'cerise', 'melon', 'pasteque', 'prune', 'figue', 'patate douce', 'mais', 'herbe', 'legume', 'fruit']],
  ['viandes-poissons', ['poulet', 'boeuf', 'veau', 'porc', 'agneau', 'dinde', 'canard', 'lapin', 'jambon', 'lardon', 'bacon', 'saucisse', 'chorizo', 'merguez', 'steak', 'hache', 'escalope', 'filet', 'cote', 'roti', 'saumon', 'cabillaud', 'thon', 'crevette', 'moule', 'poisson', 'sardine', 'maquereau', 'colin', 'lieu', 'truite', 'gambas', 'calamar', 'saint-jacques', 'noix de saint', 'andouille', 'boudin', 'rillette', 'pate de campagne', 'foie', 'gigot', 'souris', 'paleron', 'joue', 'cuisse', 'blanc de']],
  ['cremerie', ['oeuf', 'lait', 'creme', 'beurre', 'fromage', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte', 'chevre', 'feta', 'ricotta', 'mascarpone', 'yaourt', 'yogourt', 'skyr', 'fromage blanc', 'raclette', 'camembert', 'roquefort', 'reblochon', 'cheddar', 'philadelphia', 'petit suisse', 'margarine']],
  ['epicerie-sucree', ['sucre', 'chocolat', 'cacao', 'miel', 'confiture', 'levure', 'gelatine', 'extrait de vanille', 'sucre vanille', 'pepites', 'nutella', 'pate a tartiner', 'amande', 'noisette', 'biscuit', 'speculoos', 'sirop d', 'sucre glace', 'vermicelles', 'caramel', 'coco', 'fecule', 'maizena']],
  ['epicerie', ['farine', 'pate', 'spaghetti', 'tagliatelle', 'penne', 'macaroni', 'riz', 'semoule', 'boulgour', 'quinoa', 'lentille', 'pois chiche', 'haricot rouge', 'haricot blanc', 'flageolet', 'huile', 'conserve', 'coulis', 'concentre de tomate', 'tomates pelees', 'lait de coco', 'noix', 'cacahuete', 'pignon', 'graine', 'sesame', 'chips', 'cereale', 'flocon', 'polenta', 'couscous', 'nouille', 'vermicelle de riz', 'galette de riz', 'olive', 'capre', 'anchois', 'thon en boite', 'tahini', 'puree', 'pesto', 'bouillon cube']],
];

export function guessAisle(nom) {
  const n = ` ${normalize(nom)} `;
  // Le plus long mot-clé trouvé gagne (« sucre vanille » avant « sucre »).
  let best = null;
  for (const [rayon, keys] of RULES) {
    for (const k of keys) {
      const kk = normalize(k);
      const hit = k.endsWith(' ') ? n.includes(` ${kk} `) : n.includes(kk);
      if (hit && (!best || kk.length > best.len)) best = { rayon, len: kk.length };
    }
  }
  return best?.rayon ?? 'autre';
}

const STAPLES = ['sel', 'poivre', 'eau', 'huile', 'huile d olive', 'huile de tournesol', 'sucre', 'farine', 'vinaigre', 'beurre', 'moutarde', 'bouillon cube', 'epices'];
export function guessStaple(nom) {
  return STAPLES.includes(normalize(nom).replace(/s$/, '')) || STAPLES.includes(normalize(nom));
}
