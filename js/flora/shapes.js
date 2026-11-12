/*
 * flora/shapes.js
 * ---------------------------------------------------------------------------
 * Names for the kinds of flowers and plant silhouettes the 3D view can draw,
 * and best guesses for which one a plant should get.
 *
 * Every plant has (optionally) a `flower` and a `crown`:
 *   flower  the shape of its flower head: daisy, coneflower, spike, cluster...
 *   crown   for trees and shrubs, the outline of the canopy: round, vase, cone...
 * When they're blank, guessFlower() / guessCrown() pick one from the genus
 * (first word of the scientific name), then the plant family, then the
 * growth form. You can always override it in the Edit form.
 *
 * Nothing here touches three.js; flora/geometry.js builds the actual shapes.
 * To teach the app a new genus, add it to GENUS_FLOWER or GENUS_CROWN.
 */

/*
 * Flower head types.
 *   label    shown in the Edit form
 *   size     default size in feet: the width of one head, or for tall
 *            "spike-like" types (spike, bells, plume, grass) its length
 *   seed     what's left after blooming:
 *              'center' the middle of the flower stays as a seed head (coneflowers)
 *              'head'   the whole head turns brown and stays (spikes, clusters)
 *              'none'   nothing worth drawing
 *   center   default color of the flower's middle
 */
export const FLOWERS = {
    daisy:   { label: 'Daisy (ray petals around a disk)', size: 0.22, seed: 'center', center: '#c99a1e' },
    cone:    { label: 'Coneflower (drooping petals, raised cone)', size: 0.3, seed: 'center', center: '#7d4419' },
    column:  { label: 'Mexican hat (tall column center)', size: 0.16, seed: 'center', center: '#4a3020' },
    cup:     { label: 'Cup (broad petals, bowl shaped)', size: 0.18, seed: 'none', center: '#e8cf5a' },
    star:    { label: 'Star (flat open petals)', size: 0.11, seed: 'none', center: '#e8cf5a' },
    cluster: { label: 'Rounded cluster (milkweed, verbena)', size: 0.2, seed: 'head', center: '#6d7a45' },
    flat:    { label: 'Flat-topped cluster (yarrow, elderberry)', size: 0.3, seed: 'head', center: '#6d7a45' },
    globe:   { label: 'Globe (buttonbush, sensitive briar)', size: 0.12, seed: 'head', center: '#6d7a45' },
    pompom:  { label: 'Pompom (bee balm)', size: 0.2, seed: 'head', center: '#5f5a3c' },
    spike:   { label: 'Spike (blazing star, salvia)', size: 0.6, seed: 'head', center: '#4f6b34' },
    bells:   { label: 'Bells on a stalk (penstemon, yucca)', size: 0.6, seed: 'head', center: '#4f6b34' },
    tube:    { label: 'Trumpets (honeysuckle, trumpet creeper)', size: 0.22, seed: 'none', center: '#4f6b34' },
    plume:   { label: 'Plume (goldenrod)', size: 0.6, seed: 'head', center: '#4f6b34' },
    iris:    { label: 'Iris', size: 0.32, seed: 'none', center: '#e8cf5a' },
    bract:   { label: 'Four bracts (flowering dogwood)', size: 0.25, seed: 'none', center: '#a8b060' },
    blossom: { label: 'Small blossoms (plum, redbud)', size: 0.09, seed: 'none', center: '#e8cf5a' },
    catkin:  { label: 'Catkins (oaks, walnuts)', size: 0.25, seed: 'none', center: '#8a8a50' },
    grass:   { label: 'Grass seed head', size: 0.5, seed: 'head', center: '#8a7a50' },
    none:    { label: 'No showy flowers', size: 0, seed: 'none', center: '#888888' },
};

/* Tree and shrub silhouettes. */
export const CROWNS = {
    round:     'Round (oaks, most trees)',
    spreading: 'Spreading, low and wide (redbud, honey locust)',
    vase:      'Vase (elms)',
    cone:      'Cone / conifer (redcedar, pines)',
    column:    'Narrow column',
    mound:     'Mounded shrub',
    upright:   'Upright, airy shrub (false indigo, elderberry)',
    rosette:   'Rosette of sword leaves (yucca)',
};

/* Genus → flower type. Checked first because it's the most specific. */
const GENUS_FLOWER = {
    // daisies and their kin
    Rudbeckia: 'daisy', Helianthus: 'daisy', Gaillardia: 'daisy', Coreopsis: 'daisy', Symphyotrichum: 'daisy',
    Aster: 'daisy', Erigeron: 'daisy', Engelmannia: 'daisy', Berlandiera: 'daisy', Thelesperma: 'daisy',
    Helenium: 'daisy', Heliopsis: 'daisy', Silphium: 'daisy', Zinnia: 'daisy', Grindelia: 'daisy',
    Verbesina: 'daisy', Packera: 'daisy', Tetraneuris: 'daisy', Hymenoxys: 'daisy', Melampodium: 'daisy',
    Machaeranthera: 'daisy', Xanthisma: 'daisy', Chrysopsis: 'daisy', Leucanthemum: 'daisy', Cosmos: 'daisy',
    Passiflora: 'daisy', Escobaria: 'cup',
    Echinacea: 'cone', Dracopis: 'cone', Ratibida: 'column',
    // spikes, bells and plumes
    Liatris: 'spike', Salvia: 'spike', Agastache: 'spike', Lobelia: 'spike', Amorpha: 'spike', Dalea: 'spike',
    Lupinus: 'spike', Baptisia: 'spike', Verbena: 'spike', Delphinium: 'spike', Physostegia: 'spike',
    Veronicastrum: 'spike', Sophora: 'spike', Castilleja: 'spike', Stachys: 'spike', Scutellaria: 'spike',
    Teucrium: 'spike', Lythrum: 'spike', Gaura: 'spike', Oenothera: 'cup',
    Penstemon: 'bells', Yucca: 'bells', Hesperaloe: 'bells', Clematis: 'bells', Campanula: 'bells', Nolina: 'plume',
    Solidago: 'plume', Artemisia: 'plume', Rhus: 'plume',
    // clusters, globes and pompoms
    Asclepias: 'cluster', Glandularia: 'cluster', Phlox: 'cluster', Conoclinium: 'cluster', Hydrangea: 'cluster',
    Pycnanthemum: 'cluster', Ceanothus: 'cluster', Atriplex: 'cluster', Euphorbia: 'star',
    Achillea: 'flat', Vernonia: 'flat', Eupatorium: 'flat', Ageratina: 'flat', Zizia: 'flat', Sambucus: 'flat',
    Viburnum: 'flat', Cornus: 'flat', Sapindus: 'flat', Eutrochium: 'flat',
    Cephalanthus: 'globe', Mimosa: 'globe', Desmanthus: 'globe', Trifolium: 'globe', Allium: 'globe',
    Eryngium: 'globe', Maclura: 'globe', Acacia: 'globe',
    Monarda: 'pompom',
    // cups, stars and trumpets
    Callirhoe: 'cup', Sphaeralcea: 'cup', Opuntia: 'cup', Cylindropuntia: 'cup', Echinocereus: 'cup',
    Rosa: 'cup', Hibiscus: 'cup', Anemone: 'cup', Ipomoea: 'cup', Argemone: 'cup', Calylophus: 'cup',
    Tradescantia: 'star', Commelina: 'star', Symphoricarpos: 'star',
    Lonicera: 'tube', Campsis: 'tube', Bignonia: 'tube', Ipomopsis: 'tube', Mirabilis: 'tube', Ribes: 'tube',
    Iris: 'iris',
    // trees and shrubs
    Cercis: 'blossom', Prunus: 'blossom', Crataegus: 'blossom', Malus: 'blossom', Amelanchier: 'blossom',
    Quercus: 'catkin', Juglans: 'catkin', Carya: 'catkin', Salix: 'catkin', Populus: 'catkin', Betula: 'catkin',
    Gleditsia: 'catkin', Gymnocladus: 'catkin', Celtis: 'none', Ulmus: 'none', Juniperus: 'none',
    Pinus: 'none', Parthenocissus: 'none', Fraxinus: 'none',
};

/* Family → flower type, for plants whose genus isn't listed (iNaturalist gives the family). */
const FAMILY_FLOWER = {
    Asteraceae: 'daisy', Lamiaceae: 'spike', Fabaceae: 'spike', Apocynaceae: 'cluster', Malvaceae: 'cup',
    Onagraceae: 'cup', Cactaceae: 'cup', Rosaceae: 'blossom', Iridaceae: 'iris', Poaceae: 'grass',
    Cyperaceae: 'grass', Juncaceae: 'grass', Plantaginaceae: 'bells', Campanulaceae: 'spike',
    Caprifoliaceae: 'tube', Bignoniaceae: 'tube', Verbenaceae: 'cluster', Polemoniaceae: 'cluster',
    Apiaceae: 'flat', Fagaceae: 'catkin', Juglandaceae: 'catkin', Salicaceae: 'catkin', Betulaceae: 'catkin',
    Cupressaceae: 'none', Pinaceae: 'none', Boraginaceae: 'cluster', Commelinaceae: 'star', Ranunculaceae: 'cup',
    Papaveraceae: 'cup', Liliaceae: 'bells', Asparagaceae: 'bells', Amaryllidaceae: 'globe', Rubiaceae: 'globe',
    Cornaceae: 'flat', Anacardiaceae: 'plume', Sapindaceae: 'flat', Hydrangeaceae: 'cluster', Euphorbiaceae: 'star',
    Solanaceae: 'star', Convolvulaceae: 'cup', Acanthaceae: 'tube', Gentianaceae: 'cup', Primulaceae: 'star',
    Violaceae: 'star', Geraniaceae: 'cup', Linaceae: 'cup', Nyctaginaceae: 'tube', Scrophulariaceae: 'spike',
    Orobanchaceae: 'spike', Polygonaceae: 'cluster', Amaranthaceae: 'plume', Ulmaceae: 'none', Cannabaceae: 'none',
    Moraceae: 'globe', Oleaceae: 'none', Vitaceae: 'none', Grossulariaceae: 'tube', Adoxaceae: 'flat',
    Viburnaceae: 'flat', Rhamnaceae: 'cluster', Ericaceae: 'bells', Lythraceae: 'spike',
};

/* Last resort: by growth form. */
const FORM_FLOWER = {
    tree: 'blossom', shrub: 'blossom', vine: 'tube', forb: 'daisy', annual: 'daisy', iris: 'iris', cactus: 'cup', grass: 'grass',
};

/* A few genera with flowers much bigger or smaller than their type's default (feet). */
const GENUS_SIZE = {
    Helianthus: 0.3, Zinnia: 0.28, Hibiscus: 0.5, Ipomoea: 0.25, Opuntia: 0.25, Callirhoe: 0.17,
    Oenothera: 0.3, Rosa: 0.22, Coreopsis: 0.14, Symphyotrichum: 0.11, Erigeron: 0.08, Achillea: 0.28,
    Liatris: 0.7, Dalea: 0.16, Amorpha: 0.45, Lobelia: 0.7, Salvia: 0.55, Delphinium: 0.6, Yucca: 1.6,
    Solidago: 0.7, Sambucus: 0.5, Viburnum: 0.3, Cornus: 0.18, Cephalanthus: 0.13, Hydrangea: 0.45,
    Asclepias: 0.18, Monarda: 0.18, Vernonia: 0.3, Penstemon: 0.6, Desmanthus: 0.07, Mimosa: 0.08,
};

/* The genus is the first word of the scientific name ("Echinacea angustifolia" → "Echinacea"). */
export function genusOf(sci) {
    const g = (sci || '').trim().split(/\s+/)[0] || '';
    return /^[A-Z][a-z]+$/.test(g) ? g : '';
}

/*
 * Pick a flower type: the plant's own setting, else by genus, family, then form.
 * `p` can be a garden plant or a library entry ({ sci, family, form, flower }).
 */
export function guessFlower(p) {
    if (p.flower && FLOWERS[p.flower]) return p.flower;
    const g = genusOf(p.sci);
    // A plant listed only by genus in the old garden file, like "Helianthus sp.", still matches here.
    return GENUS_FLOWER[g] || FAMILY_FLOWER[p.family] || FORM_FLOWER[p.form] || 'daisy';
}

/* Size of one flower head (or spike length) in feet. flowerSize on a plant is in inches. */
export function flowerSizeFt(p, type) {
    if (p.flowerSize > 0) return p.flowerSize / 12;
    return GENUS_SIZE[genusOf(p.sci)] || FLOWERS[type].size;
}

/* A few genera whose flower middles aren't the type's default color. */
const GENUS_CENTER = {
    Rudbeckia: '#2e1d12', Helianthus: '#5a3a1c', Gaillardia: '#6b2a1a', Echinacea: '#8a4a1a', Zinnia: '#8a5a1a',
    Engelmannia: '#c99a1e', Berlandiera: '#7a3a1a', Passiflora: '#6a3a8a', Ratibida: '#4a3020',
};
export function centerColor(p, type) {
    return GENUS_CENTER[genusOf(p.sci)] || FLOWERS[type].center;
}

/* Genus → canopy silhouette. */
const GENUS_CROWN = {
    Juniperus: 'cone', Pinus: 'cone', Picea: 'cone', Abies: 'cone', Thuja: 'cone', Cupressus: 'cone', Taxodium: 'cone',
    Ulmus: 'vase', Zelkova: 'vase',
    Cercis: 'spreading', Gleditsia: 'spreading', Prosopis: 'spreading', Cornus: 'spreading', Sapindus: 'spreading',
    Prunus: 'spreading', Crataegus: 'spreading', Albizia: 'spreading',
    Populus: 'column', Carpinus: 'round',
    Amorpha: 'upright', Sambucus: 'upright', Cephalanthus: 'upright',
    Yucca: 'rosette', Hesperaloe: 'rosette', Nolina: 'rosette', Agave: 'rosette',
};

export function guessCrown(p) {
    if (p.crown && CROWNS[p.crown]) return p.crown;
    const c = GENUS_CROWN[genusOf(p.sci)];
    if (c) return c;
    return p.form === 'tree' ? 'round' : 'mound';
}
