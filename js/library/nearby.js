/*
 * library/nearby.js
 * ---------------------------------------------------------------------------
 * "Natives near you": the native plants people have actually recorded
 * around the garden, straight from iNaturalist. Unlike the starter list,
 * this works wherever the garden is.
 *
 *   placeIdsFor(place)                     iNaturalist's ids for the garden's state and county
 *   fetchNatives(placeId, page, signal)    one page of native plants recorded in a place
 *   fillFamilies(plants, signal, onStep)   look up each plant's family (for type filters)
 *   readCached(placeId) / writeCached()    keep a list on this device for a week
 *
 * The list comes from iNaturalist's "species counts": every species with
 * observations in the place, most-observed first. We ask for:
 *   taxon_id=211194   vascular plants only (no mosses or algae)
 *   native=true       species iNaturalist lists as native to that place
 *   captive=false     leave out garden and potted plants people photographed
 *   verifiable=true   observations with a photo, date and location
 *
 * Two things to know about the result:
 *   - "Native" comes from iNaturalist's place checklists. Some natives aren't
 *     marked native yet, so they're missing; search for them by name.
 *   - A plant shows up only if someone has photographed it there. Rural
 *     counties may have few records, so the Library falls back to the state.
 */
import { fetchJSON, sleep } from '../util.js';
import { findPlaceIds } from './inat.js';

const API = 'https://api.inaturalist.org/v1';
const VASCULAR = 211194;                 // iNaturalist's id for vascular plants
export const PER_PAGE = 200;             // plants per request (iNaturalist's usual maximum)
const LEAF_RANKS = ['species', 'subspecies', 'variety', 'form', 'hybrid'];
const KEEP_DAYS = 7;                     // how long a downloaded list is reused on this device

/* iNaturalist's place ids for the garden. Older gardens may not have them saved yet. */
export async function placeIdsFor(place) {
    if (place?.inat?.state || place?.inat?.county) return place.inat;
    if (!place?.state) return { state: 0, county: 0 };
    return findPlaceIds(place.state, place.county);
}

/* One result from iNaturalist → the same shape as a Library search result (inat.js searchTaxa). */
function toPlant(r) {
    const t = r.taxon || {};
    const p = t.default_photo;
    return {
        id: t.id,
        sci: t.name || '',
        common: t.preferred_common_name || '',
        rank: t.rank,
        count: r.count || 0,                                   // how many observations in the place
        photo: p && p.square_url ? { square: p.square_url, medium: p.medium_url || p.square_url, credit: p.attribution || '' } : null,
        genus: (t.name || '').split(' ')[0],
        family: '',                                            // filled in by fillFamilies()
    };
}

/*
 * One page of native plants recorded in a place, most-observed first.
 * Returns { total, plants }; total counts every plant iNaturalist has, so
 * there are more pages while plants loaded < total.
 */
export async function fetchNatives(placeId, page = 1, signal) {
    const u = `${API}/observations/species_counts?place_id=${placeId}&taxon_id=${VASCULAR}`
        + `&native=true&captive=false&verifiable=true&per_page=${PER_PAGE}&page=${page}&locale=en`;
    const js = await fetchJSON(u, { signal, timeout: 20000 });
    const plants = (js.results || []).filter(r => r.taxon && LEAF_RANKS.includes(r.taxon.rank)).map(toPlant);
    return { total: js.total_results || 0, plants };
}

/*
 * Look up the family of each plant that doesn't have one yet, 30 at a time
 * (the most iNaturalist returns per request), pausing a second between
 * requests to stay well under their limit of about 60 a minute.
 * A family of '-' means "looked up, not found". onStep() runs after each batch.
 */
export async function fillFamilies(plants, signal, onStep) {
    const need = plants.filter(p => !p.family);
    for (let i = 0; i < need.length; i += 30) {
        if (i) await sleep(1100);
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');   // the list was replaced meanwhile
        const batch = need.slice(i, i + 30);
        const js = await fetchJSON(`${API}/taxa/${batch.map(p => p.id).join(',')}?locale=en`, { signal, timeout: 20000 });
        const family = new Map();
        for (const t of js.results || []) {
            const f = (t.ancestors || []).find(a => a.rank === 'family');
            if (f) family.set(t.id, f.name);
        }
        for (const p of batch) p.family = family.get(p.id) || '-';
        if (onStep) onStep();
    }
}

/* ---------- keeping a list on this device ---------- */

const cacheKey = (placeId) => `native-garden:nearby:${placeId}`;

/* A list saved in the last week for this place, or null. */
export function readCached(placeId) {
    try {
        const c = JSON.parse(localStorage.getItem(cacheKey(placeId)) || 'null');
        if (c && Array.isArray(c.plants) && Date.now() - c.at < KEEP_DAYS * 864e5) return c;
    } catch (e) { /* unreadable: download again */ }
    return null;
}

/* Save { total, page, plants } for this place. Storage full or blocked? Then just don't keep it. */
export function writeCached(placeId, data) {
    try {
        localStorage.setItem(cacheKey(placeId), JSON.stringify({ total: data.total, page: data.page, plants: data.plants, at: Date.now() }));
    } catch (e) { /* not kept; it downloads again next time */ }
}
