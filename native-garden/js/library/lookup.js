/*
 * library/lookup.js
 * ---------------------------------------------------------------------------
 * "Check for this garden": combines iNaturalist and GBIF into one answer
 * about a plant, for the garden's location:
 *
 *   taxon    photo, common name, family, Wikipedia summary (iNaturalist)
 *   bloom    flowering observations by month near the garden (iNaturalist)
 *   gbif     record counts in the county and state (GBIF)
 *   verdict  a nativity code + a plain-language explanation
 *   form     a guess at the growth form (tree, shrub, wildflower...) from the plant family
 *
 * Each part is best-effort: if one service is down, the others still show.
 */
import { getTaxon, findTaxonId, floweringByMonth } from './inat.js';
import { matchName, countRecords } from './gbif.js';
import { monthsToRange } from '../util.js';

/*
 * plant: { sci, inatId }  (either is enough)
 * place: the garden's place (model.js cleanPlace), or null
 */
export async function checkPlant(plant, place, signal) {
    const out = { taxon: null, bloom: null, gbif: null, verdict: null, form: null, errors: [] };

    // 1. iNaturalist: who is this?
    try {
        const id = plant.inatId || (plant.sci ? await findTaxonId(plant.sci, signal) : 0);
        if (id) out.taxon = await getTaxon(id, place?.inat, place?.country, signal);
    } catch (err) {
        if (signal?.aborted) throw err;
        out.errors.push('iNaturalist');
    }

    // 2 and 3 run at the same time: when does it flower nearby, and where is it recorded?
    const sci = out.taxon ? out.taxon.sci : plant.sci;
    await Promise.all([
        (async () => {
            if (!out.taxon || !place) return;
            try { out.bloom = await bloomNear(out.taxon.id, place, signal); }
            catch (err) { if (signal?.aborted) throw err; out.errors.push('iNaturalist flowering records'); }
        })(),
        (async () => {
            if (!sci || !place?.gadm?.state) return;
            try { out.gbif = await gbifCounts(sci, place.gadm, signal); }
            catch (err) { if (signal?.aborted) throw err; out.errors.push('GBIF'); }
        })(),
    ]);

    out.verdict = verdict(out, place);
    out.form = guessForm(out.taxon);
    return out;
}

/*
 * Flowering months near the garden. Start with a 150 km circle; if there are
 * very few records, widen to 400 km. A month counts as a bloom month when it
 * has at least 15% as many records as the busiest month.
 */
async function bloomNear(taxonId, place, signal) {
    let radius = 150;
    let counts = await floweringByMonth(taxonId, place.lat, place.lng, radius, signal);
    let total = counts.reduce((a, b) => a + b, 0);
    if (total < 8) {
        radius = 400;
        counts = await floweringByMonth(taxonId, place.lat, place.lng, radius, signal);
        total = counts.reduce((a, b) => a + b, 0);
    }
    const peak = Math.max(...counts);
    const months = counts.map((n, i) => (peak && n >= peak * 0.15 ? i + 1 : 0)).filter(Boolean);
    return { counts, total, radius, range: total >= 3 ? monthsToRange(months) : null };
}

/* GBIF record counts: county (all records + herbarium specimens) and state. */
async function gbifCounts(sci, gadm, signal) {
    const match = await matchName(sci, signal);
    if (!match) return null;
    const [county, countySpecimens, state] = await Promise.all([
        gadm.county ? countRecords(match.key, gadm.county, false, signal) : null,
        gadm.county ? countRecords(match.key, gadm.county, true, signal) : null,
        countRecords(match.key, gadm.state, false, signal),
    ]);
    return { key: match.key, county, countySpecimens, state };
}

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/*
 * Turn the evidence into a nativity code and a sentence or two.
 * iNaturalist's native/introduced status decides native vs. not; GBIF records
 * in the county can raise "native to the state" to "recorded in this county".
 */
function verdict(r, place) {
    const county = place?.county || 'this county';
    const state = place?.state || 'this state';
    const est = r.taxon && r.taxon.establishment;
    const g = r.gbif;
    const notes = [];
    let code = 'unknown';

    if (est) {
        const where = est.place || (est.level === 'county' ? county : state);
        if (est.means === 'native' || est.means === 'endemic') {
            code = est.level === 'county' ? 'county' : est.level === 'state' ? 'state' : 'region';
            notes.push(`iNaturalist lists it as ${est.means} in ${where}.`);
        } else if (est.means === 'introduced') {
            code = est.level === 'county' || est.level === 'state' || est.level === 'country' ? 'no' : 'unknown';
            notes.push(`iNaturalist lists it as introduced in ${where}.`);
        } else {
            notes.push(`iNaturalist lists it as "${est.means}" in ${where}.`);
        }
    } else if (r.taxon) {
        notes.push(`iNaturalist has no native or introduced status for it in ${state}.`);
    }

    if (g) {
        if (g.county > 0) {
            notes.push(`GBIF has ${plural(g.county, 'record')} from ${county}` + (g.countySpecimens ? `, including ${plural(g.countySpecimens, 'herbarium specimen')}.` : '.'));
            if ((code === 'state' || code === 'region') && (g.countySpecimens > 0 || g.county >= 3)) code = 'county';
        } else if (g.county === 0) {
            notes.push(`GBIF has no records from ${county}.`);
        }
        if (g.state != null) notes.push(`${plural(g.state, 'GBIF record')} from ${state}.`);
    } else if (place?.gadm?.state && !r.errors.includes('GBIF')) {
        notes.push("GBIF didn't recognize the name.");
    }
    if (g && g.county > 0) notes.push('Some records can be garden plantings, so treat counts as a guide.');
    return { code, note: notes.join(' ') };
}

/*
 * A starting guess at the growth form from the plant's family (and a few
 * genera that don't follow their family). It's only a default for the Add
 * form; people should change it if it's wrong.
 */
const FAMILY_FORM = {
    Poaceae: 'grass', Cyperaceae: 'grass', Juncaceae: 'grass', Typhaceae: 'grass',
    Cactaceae: 'cactus', Iridaceae: 'iris',
    Vitaceae: 'vine', Bignoniaceae: 'vine', Passifloraceae: 'vine', Smilacaceae: 'vine', Menispermaceae: 'vine',
    Fagaceae: 'tree', Pinaceae: 'tree', Cupressaceae: 'tree', Juglandaceae: 'tree', Ulmaceae: 'tree', Cannabaceae: 'tree',
    Salicaceae: 'tree', Platanaceae: 'tree', Magnoliaceae: 'tree', Betulaceae: 'tree', Moraceae: 'tree', Oleaceae: 'tree',
    Sapindaceae: 'tree', Ebenaceae: 'tree', Cornaceae: 'shrub', Rosaceae: 'shrub', Ericaceae: 'shrub', Caprifoliaceae: 'shrub',
    Adoxaceae: 'shrub', Viburnaceae: 'shrub', Anacardiaceae: 'shrub', Rhamnaceae: 'shrub', Hydrangeaceae: 'shrub',
    Grossulariaceae: 'shrub', Celastraceae: 'shrub', Elaeagnaceae: 'shrub', Aquifoliaceae: 'shrub', Myricaceae: 'shrub',
};
const GENUS_FORM = {
    Cercis: 'tree', Gleditsia: 'tree', Gymnocladus: 'tree', Robinia: 'tree', Prosopis: 'tree', Maclura: 'tree',
    Prunus: 'shrub', Crataegus: 'tree', Amelanchier: 'shrub', Amorpha: 'shrub', Lonicera: 'vine', Campsis: 'vine',
    Clematis: 'vine', Parthenocissus: 'vine', Ipomoea: 'vine', Toxicodendron: 'shrub', Yucca: 'shrub', Opuntia: 'cactus',
    Helianthus: 'annual', Zinnia: 'annual', Gaillardia: 'forb', Asclepias: 'forb', Sapindus: 'tree', Acer: 'tree',
    Aesculus: 'tree', Fraxinus: 'tree', Forestiera: 'shrub', Celtis: 'tree', Rubus: 'shrub', Rosa: 'shrub', Fragaria: 'forb',
    Potentilla: 'forb', Geum: 'forb', Physocarpus: 'shrub', Cornus: 'shrub', Ilex: 'shrub', Hamamelis: 'shrub',
    // More common North American trees, shrubs and vines, so "Natives near you" can sort plants
    // before their families have been looked up (and for genera that differ from their family).
    Quercus: 'tree', Carya: 'tree', Juglans: 'tree', Ulmus: 'tree', Morus: 'tree', Platanus: 'tree', Populus: 'tree',
    Salix: 'tree', Juniperus: 'tree', Pinus: 'tree', Picea: 'tree', Abies: 'tree', Tsuga: 'tree', Thuja: 'tree',
    Taxodium: 'tree', Pseudotsuga: 'tree', Betula: 'tree', Alnus: 'shrub', Ostrya: 'tree', Carpinus: 'tree', Tilia: 'tree',
    Liriodendron: 'tree', Magnolia: 'tree', Nyssa: 'tree', Liquidambar: 'tree', Diospyros: 'tree', Sassafras: 'tree',
    Fagus: 'tree', Castanea: 'tree', Catalpa: 'tree', Ptelea: 'shrub', Sideroxylon: 'tree', Ungnadia: 'shrub',
    Vachellia: 'shrub', Senegalia: 'shrub', Mimosa: 'shrub', Parkinsonia: 'tree', Olneya: 'tree', Chilopsis: 'tree',
    Asimina: 'shrub', Rhus: 'shrub', Viburnum: 'shrub', Sambucus: 'shrub', Symphoricarpos: 'shrub', Cephalanthus: 'shrub',
    Callicarpa: 'shrub', Ceanothus: 'shrub', Vaccinium: 'shrub', Rhododendron: 'shrub', Kalmia: 'shrub', Aronia: 'shrub',
    Spiraea: 'shrub', Ribes: 'shrub', Philadelphus: 'shrub', Lindera: 'shrub', Calycanthus: 'shrub', Clethra: 'shrub',
    Itea: 'shrub', Zanthoxylum: 'shrub', Euonymus: 'shrub', Berberis: 'shrub', Mahonia: 'shrub', Artemisia: 'shrub',
    Ericameria: 'shrub', Chrysothamnus: 'shrub', Larrea: 'shrub', Fallugia: 'shrub', Cercocarpus: 'shrub',
    Purshia: 'shrub', Leucophyllum: 'shrub', Dalea: 'forb', Baccharis: 'shrub', Corylus: 'shrub', Comptonia: 'shrub',
    Morella: 'shrub', Lespedeza: 'forb', Ceratiola: 'shrub', Agave: 'shrub', Nolina: 'shrub', Dasylirion: 'shrub',
    Hesperaloe: 'shrub', Echinocereus: 'cactus', Cylindropuntia: 'cactus', Escobaria: 'cactus', Coryphantha: 'cactus',
    Mammillaria: 'cactus', Ferocactus: 'cactus', Vitis: 'vine', Smilax: 'vine', Celastrus: 'vine', Bignonia: 'vine',
    Wisteria: 'vine', Passiflora: 'vine', Ampelopsis: 'vine', Cocculus: 'vine', Gelsemium: 'vine', Aristolochia: 'vine',
};

/* taxon: anything with .genus and/or .family names. */
export function guessForm(taxon) {
    if (!taxon) return null;
    return GENUS_FORM[taxon.genus] || FAMILY_FORM[taxon.family] || 'forb';
}
