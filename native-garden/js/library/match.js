/*
 * library/match.js
 * ---------------------------------------------------------------------------
 * Connecting garden plants to the plant library.
 *
 *   libMatch(plant)     the library entry for a garden plant (same scientific name)
 *   traitsOf(plant)     its sun, water, zones and wildlife: the plant's own
 *                       values where set, otherwise the library entry's
 *   entryNative(entry)  a library entry's nativity for the open garden
 *
 * traitsOf() is what Garden Check, the care calendar and the detail panel
 * use, so a plant imported without those details still gets them when the
 * library knows the species.
 */
import { S } from '../state.js';
import { catalogNative, placeKey } from '../model.js';

/* A scientific name we can match on ('' for "sp.", hybrids and placeholders). */
export function sciKey(sci) {
    const t = (sci || '').trim().toLowerCase();
    return t && !/\bsp\.?$|not recorded|not confirmed|hybrid/.test(t) ? t : '';
}

/* The library entry (starter list first, then saved) for a garden plant, if any. */
export function libMatch(it) {
    const k = sciKey(it.sci);
    if (!k) return null;
    return S.library.catalog.find(e => sciKey(e.sci) === k) || [...S.library.saved.values()].find(e => sciKey(e.sci) === k) || null;
}

/* Sun, water, hardiness zones and wildlife for a garden plant. */
export function traitsOf(it) {
    const e = libMatch(it);
    return {
        sun: it.sun && it.sun.length ? it.sun : (e ? e.sun : []),
        water: it.water || (e ? e.water : ''),
        zones: it.zones || (e ? e.zones : null),
        tags: it.tags && it.tags.length ? it.tags : (e ? e.tags : []),
        fromLibrary: !!e,
    };
}

/* Nativity for the open garden: starter-list codes are translated; saved checks only count for the same place. */
export function entryNative(e) {
    if (e.source === 'catalog') return catalogNative(e, S.meta?.place);
    if (e.nativeFor && e.nativeFor === placeKey(S.meta?.place)) return e.native;
    return 'unknown';
}
