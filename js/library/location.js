/*
 * library/location.js
 * ---------------------------------------------------------------------------
 * Working out where a garden is, when someone creates one:
 *
 *   currentPosition()    the device's GPS / network location (asks permission)
 *   searchAddress(q)     a town, address or landmark → map points (OpenStreetMap's Nominatim)
 *   placeFromPoint()     a map point → country, state, county and the ids
 *                        GBIF and iNaturalist use for them (cleanPlace shape)
 *
 * Privacy: the point is rounded to 2 decimal places (about 1 km), which is
 * plenty for nativity and bloom-time lookups and doesn't pin down a house.
 */
import { reverseGeocode } from './gbif.js';
import { findPlaceIds } from './inat.js';
import { fetchJSON } from '../util.js';
import { ZONES } from '../model.js';

const round2 = (v) => Math.round(v * 100) / 100;

//SJM: auto looks up hardiness zone. 
const USDA_ZONE_QUERY =
    'https://services1.arcgis.com/SyUSN23vOoYdfLC8/arcgis/rest/services/PHZM_Links_with_zones/FeatureServer/6/query';

export async function hardinessZoneAt(lat, lng) {
    const params = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'ClassName',
        returnGeometry: 'false',
        f: 'json',
    });

    const result = await fetchJSON(`${USDA_ZONE_QUERY}?${params}`);
    if (result.error) {
        throw new Error(result.error.message || 'USDA zone lookup failed.');
    }

    const zone = result.features?.[0]?.attributes?.ClassName;
    if (!zone) return '';
    if (!ZONES.includes(zone)) throw new Error(`Unexpected USDA zone: ${zone}`);

    return zone;
}

/* Ask the browser where we are. Rejects with a readable message. */
export function currentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error("This browser can't share its location.")); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: round2(pos.coords.latitude), lng: round2(pos.coords.longitude) }),
            (err) => reject(new Error(err.code === 1 ? 'Location permission was turned down. Search for your town instead.' : "Couldn't get your location. Search for your town instead.")),
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
        );
    });
}

/*
 * Search OpenStreetMap for a place name. Nominatim's rules: no searching on
 * every keystroke (we only search when the person presses Search) and show
 * the "© OpenStreetMap contributors" credit (done in ui/gardens.js).
 */
export async function searchAddress(q) {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    const list = await fetchJSON(u);
    return (Array.isArray(list) ? list : []).map(r => ({
        label: r.display_name,
        lat: round2(Number(r.lat)),
        lng: round2(Number(r.lon)),
    })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/* Add the right word after a US county name ("Roger Mills" → "Roger Mills County"). */
function countyLabel(name, country, state) {
    if (!name || country !== 'United States') return name;
    if (/ (County|Parish|Borough|city)$/i.test(name)) return name;
    if (state === 'Louisiana') return `${name} Parish`;
    if (state === 'Alaska') return `${name} Borough`;
    return `${name} County`;
}

/*
 * Everything the app needs to know about a point. GBIF names the areas;
 * iNaturalist gives its own ids for the state and county. Either can fail
 * (for example in the middle of the ocean); we keep whatever we got.
 */
export async function placeFromPoint(lat, lng) {
    lat = round2(lat);
    lng = round2(lng);
    let areas = { country: '', countryGid: '', state: '', stateGid: '', county: '', countyGid: '' };
    try { areas = await reverseGeocode(lat, lng); } catch (err) { console.warn('GBIF reverse geocode failed', err); }
    let inat = { state: 0, county: 0 };
    try { inat = await findPlaceIds(areas.state, areas.county); } catch (err) { console.warn('iNaturalist place lookup failed', err); }
    const county = countyLabel(areas.county, areas.country, areas.state);
    return {
        lat, lng,
        label: [county, areas.state, areas.country].filter(Boolean).join(', ') || `${lat}, ${lng}`,
        country: areas.country, state: areas.state, county,
        gadm: { country: areas.countryGid, state: areas.stateGid, county: areas.countyGid },
        inat,
    };
}
