/*
 * library/gbif.js
 * ---------------------------------------------------------------------------
 * Talking to GBIF, the Global Biodiversity Information Facility
 * (https://techdocs.gbif.org/en/openapi/). Free, no key, allows web pages.
 *
 * GBIF gathers records of where species have been found: herbarium
 * specimens in museums, survey data, and research-grade iNaturalist
 * observations. We use it to answer "has this plant been recorded in my
 * county / state?", which is good evidence a plant belongs there.
 * (Not perfect: some records are garden plantings.)
 *
 * GBIF describes areas with GADM ids, e.g. "USA.37.65_1" for Roger Mills
 * County, Oklahoma. reverseGeocode() turns a map point into those ids when a
 * garden is created, and they're saved in the garden's place.
 */
import { fetchJSON } from '../util.js';

const API = 'https://api.gbif.org/v1';

/*
 * Which country, state/province and county contain this point?
 * Returns names and GADM ids ('' when not found, e.g. in the ocean).
 */
export async function reverseGeocode(lat, lng) {
    const js = await fetchJSON(`${API}/geocode/reverse?lat=${lat}&lng=${lng}`);
    const list = Array.isArray(js) ? js : [];
    const find = (type) => list.find(r => r.type === type) || null;
    const c = find('GADM0'), s = find('GADM1'), k = find('GADM2');
    return {
        country: c ? c.title : '', countryGid: c ? c.id : '',
        state: s ? s.title : '', stateGid: s ? s.id : '',
        county: k ? k.title : '', countyGid: k ? k.id : '',
    };
}

/* Match a scientific name to GBIF's backbone taxonomy. Returns { key, name } or null. */
export async function matchName(sci, signal) {
    const js = await fetchJSON(`${API}/species/match?name=${encodeURIComponent(sci)}&kingdom=Plantae`, { signal });
    if (!js || js.matchType === 'NONE' || !js.usageKey) return null;
    // If the name is an old synonym, count records under the accepted name.
    return { key: js.acceptedUsageKey || js.usageKey, name: js.scientificName || sci, matchType: js.matchType };
}

/*
 * How many records of this taxon in a GADM area? With specimensOnly, count
 * only preserved herbarium specimens (the strongest evidence).
 * limit=0 asks for the count without downloading any records.
 */
export async function countRecords(taxonKey, gadmGid, specimensOnly, signal) {
    let u = `${API}/occurrence/search?taxonKey=${taxonKey}&gadmGid=${encodeURIComponent(gadmGid)}&occurrenceStatus=PRESENT&limit=0`;
    if (specimensOnly) u += '&basisOfRecord=PRESERVED_SPECIMEN';
    const js = await fetchJSON(u, { signal });
    return Number(js.count) || 0;
}

/* A GBIF map/search link for people to explore the records themselves. */
export function recordsUrl(taxonKey, gadmGid) {
    return `https://www.gbif.org/occurrence/search?taxon_key=${taxonKey}&gadm_gid=${encodeURIComponent(gadmGid)}`;
}
