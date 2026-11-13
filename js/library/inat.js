/*
 * library/inat.js
 * ---------------------------------------------------------------------------
 * Talking to iNaturalist (https://api.inaturalist.org/v1/docs/).
 * Free, no key needed, and it allows requests from web pages (CORS).
 * They ask apps to stay under about 60 requests a minute, so we only call it
 * when someone searches or opens a plant, and fetchJSON caches answers.
 *
 * What we use it for:
 *   searchTaxa()        name search while typing in the Library
 *   getTaxon()          photo, Wikipedia summary, family, native/introduced status
 *   findTaxonId()       scientific name → iNaturalist taxon number
 *   floweringByMonth()  how many "flowering" observations per month near the garden
 *   floweringPhotos()  licensed photos from nearby flowering observations
 *   findPlaceIds()      the iNaturalist ids for the garden's state and county
 *
 * Photos belong to the people who took them. We always show the photo's
 * attribution text (it includes the license) next to the picture.
 */
import { fetchJSON, stripHtml } from '../util.js';

const API = 'https://api.inaturalist.org/v1';
const PLANTAE = 47126;     // iNaturalist's id for the plant kingdom, so searches only return plants
const PHOTO_LICENSES = new Map([
    ['cc0', 'CC0'],
    ['cc-by', 'CC BY'],
    ['cc-by-sa', 'CC BY-SA'],
]);

function photoOf(t) {
    const p = t && t.default_photo;
    if (!p || !p.square_url) return null;
    return { square: p.square_url, medium: p.medium_url || p.square_url, credit: p.attribution || '' };
}

/* Name search: returns up to 10 plants matching the text (common or scientific). */
export async function searchTaxa(q, signal) {
    const u = `${API}/taxa/autocomplete?q=${encodeURIComponent(q)}&taxon_id=${PLANTAE}&is_active=true&per_page=10&locale=en`;
    const js = await fetchJSON(u, { signal });
    const ranks = ['species', 'subspecies', 'variety', 'form', 'hybrid', 'genus'];
    return (js.results || []).filter(t => ranks.includes(t.rank)).map(t => ({
        id: t.id,
        sci: t.name,
        common: t.preferred_common_name || '',
        rank: t.rank,
        photo: photoOf(t),
    }));
}

/* Find the taxon number for a scientific name (best exact match, else the first species). */
export async function findTaxonId(sci, signal) {
    const want = sci.trim().toLowerCase();
    const results = await searchTaxa(sci, signal);
    const exact = results.find(t => t.sci.toLowerCase() === want);
    return (exact || results.find(t => t.rank !== 'genus') || results[0] || {}).id || 0;
}

/*
 * Is it native here? iNaturalist keeps "listed taxa": per place, whether a
 * species is native, endemic or introduced. We look for the most local answer:
 * the garden's county, then its state, then its country, then whatever
 * iNaturalist offers. `level` says which one we found.
 */
function establishmentFrom(t, placeIds, countryName) {
    const listed = Array.isArray(t.listed_taxa) ? t.listed_taxa : [];
    const pid = (l) => l.place_id ?? (l.place && l.place.id);
    const placeName = (l) => (l.place && (l.place.display_name || l.place.name)) || '';
    for (const [level, id] of [['county', placeIds?.county], ['state', placeIds?.state]]) {
        if (!id) continue;
        const l = listed.find(x => pid(x) === id && x.establishment_means);
        if (l) return { means: l.establishment_means, level, place: placeName(l) };
    }
    if (t.preferred_establishment_means && placeIds?.state) {
        return { means: t.preferred_establishment_means, level: 'state', place: '' };
    }
    const country = listed.find(x => x.establishment_means && x.place && x.place.admin_level === 0
        && (!countryName || (x.place.name || '').toLowerCase() === countryName.toLowerCase()));
    if (country) return { means: country.establishment_means, level: 'country', place: placeName(country) };
    const em = t.establishment_means;
    if (em && em.establishment_means) return { means: em.establishment_means, level: 'other', place: placeName(em) };
    return null;
}

/*
 * Full details for one taxon. placeIds = { state, county } from the garden's
 * location (so iNaturalist answers native/introduced for that place).
 */
export async function getTaxon(id, placeIds, countryName, signal) {
    const pref = placeIds?.state ? `&preferred_place_id=${placeIds.state}` : '';
    const js = await fetchJSON(`${API}/taxa/${id}?locale=en${pref}`, { signal });
    const t = js.results && js.results[0];
    if (!t) throw new Error('iNaturalist has no taxon with that number.');
    const family = (t.ancestors || []).find(a => a.rank === 'family');
    const genus = (t.ancestors || []).find(a => a.rank === 'genus');
    return {
        id: t.id,
        sci: t.name,
        common: t.preferred_common_name || '',
        rank: t.rank,
        photo: photoOf(t),
        wiki: stripHtml(t.wikipedia_summary),
        wikiUrl: t.wikipedia_url || '',
        family: family ? family.name : '',
        genus: genus ? genus.name : (t.rank === 'species' ? t.name.split(' ')[0] : ''),
        establishment: establishmentFrom(t, placeIds, countryName),
        observations: t.observations_count || 0,
    };
}

/*
 * Flowering observations per month within `radiusKm` of a point. iNaturalist
 * users can tag photos as "Flowering" (annotation term 12, value 13); this
 * counts those by month of the year. Returns 12 numbers, January first.
 */
export async function floweringByMonth(taxonId, lat, lng, radiusKm, signal) {
    const u = `${API}/observations/histogram?taxon_id=${taxonId}&interval=month_of_year&term_id=12&term_value_id=13`
        + `&verifiable=true&lat=${lat}&lng=${lng}&radius=${radiusKm}`;
    const js = await fetchJSON(u, { signal });
    const months = (js.results && js.results.month_of_year) || {};
    return Array.from({ length: 12 }, (_, i) => Number(months[i + 1]) || 0);
}

/*
 * A few nearby observations annotated as flowering. Only photos with licenses
 * that permit reuse with attribution are included.
 */
export async function floweringPhotos(taxonId, lat, lng, radiusKm, signal) {
    const params = new URLSearchParams({
        taxon_id: String(taxonId),
        term_id: '12',
        term_value_id: '13',
        verifiable: 'true',
        photos: 'true',
        lat: String(lat),
        lng: String(lng),
        radius: String(radiusKm),
        per_page: '6',
        order: 'desc',
        order_by: 'observed_on',
    });
    const js = await fetchJSON(`${API}/observations?${params}`, { signal });
    const photos = [];
    for (const observation of js.results || []) {
        for (const photo of observation.photos || []) {
            const license = PHOTO_LICENSES.get(photo.license_code);
            if (typeof photo.url !== 'string' || !license) continue;
            photos.push({
                url: photo.url.replace('/square.', '/medium.'),
                attribution: photo.attribution || 'iNaturalist contributor',
                license,
                observationUrl: observation.uri || `https://www.inaturalist.org/observations/${observation.id}`,
            });
            break;
        }
        if (photos.length === 6) break;
    }
    return photos;
}

/*
 * iNaturalist's own ids for a state and county, found by name.
 * (iNaturalist "admin_level": 0 = country, 10 = state/province, 20 = county.)
 * Returns { state, county }, with 0 for anything not found.
 */
export async function findPlaceIds(stateName, countyName) {
    const out = { state: 0, county: 0 };
    const norm = (s) => (s || '').toLowerCase().replace(/ (county|parish|borough)$/, '').trim();
    if (stateName) {
        const js = await fetchJSON(`${API}/places/autocomplete?q=${encodeURIComponent(stateName)}&per_page=20`);
        const hit = (js.results || []).find(p => p.admin_level === 10 && norm(p.name) === norm(stateName));
        if (hit) out.state = hit.id;
    }
    if (countyName) {
        const js = await fetchJSON(`${API}/places/autocomplete?q=${encodeURIComponent(norm(countyName))}&per_page=20`);
        const counties = (js.results || []).filter(p => p.admin_level === 20 && norm(p.name) === norm(countyName));
        // Many states share county names (there are 30 Washington Counties), so prefer the one inside our state.
        const inState = counties.find(p => out.state && (p.ancestor_place_ids || []).includes(out.state));
        const hit = inState || (counties.length === 1 ? counties[0] : null);
        if (hit) out.county = hit.id;
    }
    return out;
}

/* Links for people to look further themselves. */
export function taxonUrl(id) { return `https://www.inaturalist.org/taxa/${id}`; }
export function nearbyUrl(id, lat, lng) {
    return `https://www.inaturalist.org/observations?taxon_id=${id}&lat=${lat}&lng=${lng}&radius=150&term_id=12&term_value_id=13`;
}
