// Vocabulaire commun : types de plats, rayons, unités.
// Ce fichier n'importe rien : il est copié tel quel dans le skill (scripts/sync-skill.js).

export const FORMAT = 'recetteur/v1';

export const TYPES = {
  entree: 'Entrée',
  plat: 'Plat',
  accompagnement: 'Accompagnement',
  dessert: 'Dessert',
  'petit-dejeuner': 'Petit-déjeuner',
  gouter: 'Goûter',
  apero: 'Apéro',
  boisson: 'Boisson',
  sauce: 'Sauce',
  autre: 'Autre',
};

export const DIFFICULTES = ['facile', 'moyen', 'difficile'];

// L'ordre suit un parcours de magasin classique.
export const RAYONS = {
  'fruits-legumes': 'Fruits & légumes',
  boulangerie: 'Boulangerie',
  'viandes-poissons': 'Viandes & poissons',
  cremerie: 'Crèmerie & œufs',
  epicerie: 'Épicerie',
  'epicerie-sucree': 'Épicerie sucrée',
  'condiments-epices': 'Condiments & épices',
  surgeles: 'Surgelés',
  boissons: 'Boissons',
  autre: 'Autre',
};

// Unités reconnues. `famille` + `facteur` permettent de convertir et d'additionner
// (kg → g, l/cl/dl → ml). `abbr` : symbole invariable (jamais de « s » au pluriel).
export const UNITES = {
  g: { famille: 'masse', facteur: 1, abbr: true },
  kg: { famille: 'masse', facteur: 1000, abbr: true },
  ml: { famille: 'volume', facteur: 1, abbr: true },
  cl: { famille: 'volume', facteur: 10, abbr: true },
  dl: { famille: 'volume', facteur: 100, abbr: true },
  l: { famille: 'volume', facteur: 1000, abbr: true },
  'c. à soupe': { abbr: true },
  'c. à café': { abbr: true },
  pincée: {},
  gousse: {},
  tranche: {},
  botte: {},
  bouquet: {},
  branche: {},
  brin: {},
  feuille: {},
  sachet: {},
  boîte: {},
  verre: {},
  tasse: {},
  pot: {},
  tête: {},
  morceau: {},
  poignée: {},
  filet: {},
  noix: {},
  cube: {},
  bâton: {},
  rouleau: {},
  paquet: {},
  barquette: {},
  bocal: {},
  carré: {},
  trait: {},
};

// Écritures alternatives acceptées à l'import → unité canonique.
export const UNITE_ALIAS = {
  gr: 'g', gramme: 'g', grammes: 'g',
  kilo: 'kg', kilos: 'kg', kilogramme: 'kg', kilogrammes: 'kg',
  millilitre: 'ml', millilitres: 'ml',
  centilitre: 'cl', centilitres: 'cl',
  décilitre: 'dl', decilitre: 'dl', décilitres: 'dl',
  litre: 'l', litres: 'l', L: 'l',
  cs: 'c. à soupe', cas: 'c. à soupe', 'c.s.': 'c. à soupe', 'c.s': 'c. à soupe', càs: 'c. à soupe',
  'c à s': 'c. à soupe', 'c. à s.': 'c. à soupe', 'c à soupe': 'c. à soupe', 'c. a soupe': 'c. à soupe',
  'cuillère à soupe': 'c. à soupe', 'cuillères à soupe': 'c. à soupe', 'cuillere a soupe': 'c. à soupe',
  'cuillères a soupe': 'c. à soupe', 'c. à soupe': 'c. à soupe',
  cc: 'c. à café', 'c.c.': 'c. à café', 'c.c': 'c. à café', càc: 'c. à café', 'c à c': 'c. à café',
  'c. à c.': 'c. à café', 'c à café': 'c. à café', 'c. a café': 'c. à café',
  'cuillère à café': 'c. à café', 'cuillères à café': 'c. à café', 'cuillere a cafe': 'c. à café',
  'cuillères a café': 'c. à café', 'c. à café': 'c. à café',
  pincées: 'pincée', gousses: 'gousse', tranches: 'tranche', bottes: 'botte', bouquets: 'bouquet',
  branches: 'branche', brins: 'brin', feuilles: 'feuille', sachets: 'sachet', boites: 'boîte',
  boite: 'boîte', boîtes: 'boîte', verres: 'verre', tasses: 'tasse', pots: 'pot', têtes: 'tête',
  tete: 'tête', morceaux: 'morceau', poignées: 'poignée', poignee: 'poignée', filets: 'filet',
  noisette: 'noix', noisettes: 'noix', cubes: 'cube', bâtons: 'bâton', rouleaux: 'rouleau',
  paquets: 'paquet', barquettes: 'barquette', bocaux: 'bocal', carrés: 'carré', carres: 'carré',
  traits: 'trait', pièce: '', pièces: '', piece: '', pieces: '', unité: '', unités: '', u: '',
};

