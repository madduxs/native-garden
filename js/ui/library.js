/*
 * ui/library.js
 * ---------------------------------------------------------------------------
 * The Library tab and the library entry panel.
 *
 * The tab has two views, picked at the top:
 *   Natives near you   native plants recorded around the garden, live from
 *                      iNaturalist (library/nearby.js)
 *   Starter list       data/catalog.json plus plants this person saved
 *
 * Rows open with a key that says where the plant came from:
 *   'cat:<id>'        starter list (data/catalog.json)
 *   'sav:<id>'        My library: plants this person saved
 *   'inat:<taxon id>' iNaturalist: a name search result or a "near you" plant
 * (A "near you" plant that's also in the starter list opens its richer
 * starter-list entry instead.)
 *
 * Clicking a row sets S.libSel to its key; the detail panel (ui/detail.js)
 * then calls renderLibDetail() to show it. "Add to garden" opens the Add form
 * already filled in from the entry.
 */
import { S, scheduleUI } from '../state.js';
import { select } from '../garden.js';
import { Store } from '../store/index.js';
import { searchTaxa } from '../library/inat.js';
import { placeIdsFor, fetchNatives, fillFamilies, readCached, writeCached, PER_PAGE } from '../library/nearby.js';
import { guessForm } from '../library/lookup.js';
import { $, h, MSHORT, fmtRange, clamp, inRange, slug, toast, loadPref, savePref } from '../util.js';
import { FORMS, DEF_H, SEED_BROWN, TAGS, nativeShort, placeKey, cleanLib, zoneNum } from '../model.js';
import { swatch, fact, nativeChip, photoFigure, confirmButton, traitFacts, tagChips } from './common.js';
import { sciKey, entryNative } from '../library/match.js';
import { checkBlock, getCheck, runCheck } from './lookup.js';
import { guessFlower } from '../flora/shapes.js';

/* What the Library tab is showing (only this module needs it). */
const LS = {
    source: loadPref('libSource', ''),   // 'near' (Natives near you) or 'list' (starter list); '' = pick by whether the garden has a location
    q: '',               // search text
    filter: 'all',       // growth-form filter
    month: false,        // only plants blooming in the current month
    native: false,       // only plants known to be native here
    sun: '',             // only plants happy in this light ('full', 'part', 'shade')
    zone: false,         // only plants hardy in the garden's zone
    tag: '',             // only plants that support this wildlife (a TAGS key), set by Garden Check
    inat: { q: '', status: 'idle', results: [] },   // the iNaturalist search
};
const inatSeen = new Map();   // taxon id → search result, so 'inat:<id>' can be shown later

/* "Natives near you": what's loaded, for which place (see loadNear). */
const NEAR = {
    forPlace: '',        // placeKey() of the garden location this list is for
    placeIds: null,      // { state, county } iNaturalist place ids
    placeIdsFor: '',     // which location those ids belong to
    scope: '',           // 'county' or 'state'
    placeId: 0,
    status: 'idle',      // 'idle' | 'loading' | 'more' | 'done' | 'error' | 'noplace'
    total: 0,            // how many plants iNaturalist has for the place
    page: 0,             // pages loaded so far
    plants: [],          // see library/nearby.js toPlant()
    families: 'idle',    // 'loading' while plant families are being looked up for the type filters
    note: '',            // e.g. why it's showing the state instead of the county
};
let nearCtl = null;      // cancels a load when a newer one starts
let searchTimer = 0, searchCtl = null;

/* ---------- helpers ---------- */

/* Plants in the garden that are this species. */
function gardenMatches(e) {
    const k = sciKey(e.sci);
    return k ? [...S.items.plants.values()].filter(p => sciKey(p.sci) === k) : [];
}

function getEntry(key) {
    if (!key) return null;
    const i = key.indexOf(':');
    const kind = key.slice(0, i), id = key.slice(i + 1);
    if (kind === 'cat') return S.library.catalog.find(e => e.id === id) || null;
    if (kind === 'sav') return S.library.saved.get(id) || null;
    return null;
}

export function openLib(key) {
    select(null);           // clears any selected item and open form
    S.libSel = key;
    scheduleUI();
}

export function closeLib() {
    S.libSel = null;
    scheduleUI();
}

/*
 * Set the Library's filters from elsewhere, e.g. "Find natives that bloom in
 * May" on the Now tab, or Garden Check's "Find caterpillar host plants".
 *   opts.month  true = only plants blooming in the current month
 *   opts.tag    only plants that support this wildlife (a TAGS key)
 *   opts.sun    only plants for this light ('full', 'part', 'shade')
 *   opts.form   a plant-type filter ('tree', 'shrub', 'grass', …)
 * Filters not given are cleared, so the list shows exactly what was asked for.
 */
export function showInLibrary(opts = {}) {
    LS.source = 'list';                 // these filters need the starter list's details
    LS.month = !!opts.month;
    LS.tag = opts.tag || '';
    LS.sun = opts.sun || '';
    LS.filter = opts.form || 'all';
    LS.q = '';
    // Natives for this place, if the starter list knows any for it.
    LS.native = true;
    if (!libList().length) LS.native = false;
    const input = $('#libSearch');
    if (input) input.value = '';
}

export function showBloomingInLibrary() {
    showInLibrary({ month: true });
}

/*
 * Turn a library entry into the starting values for a new garden plant.
 * Young trees and shrubs start small, with their mature size kept for the
 * "Mature size" view. If "For this garden" was checked, its local bloom
 * months and nativity are used.
 */
function plantFromEntry(e) {
    const woody = e.form === 'tree' || e.form === 'shrub';
    const check = getCheck({ sci: e.sci, inatId: e.inatId });
    const local = check && check.status === 'done' ? check.result : null;
    let native = entryNative(e), nativeNote = '';
    if (local && local.verdict.code !== 'unknown') { native = local.verdict.code; nativeNote = local.verdict.note; }
    const bloom = (local && local.bloom && local.bloom.range) || e.bloom;
    const notes = [
        e.cautions ? `Watch for: ${e.cautions}` : '',
        nativeNote ? `Nativity check: ${nativeNote}` : '',
    ].filter(Boolean).join('\n\n');
    return {
        name: e.name, sci: e.sci, form: e.form, status: 'planned', native,
        bloom, bloomColor: e.bloomColor, bloomColor2: e.bloomColor2, leaf: e.leaf, foliage: e.foliage, fall: e.fall,
        fruit: e.fruit, fruitColor: e.fruitColor, seed: e.seed,
        h: woody ? Math.min(e.form === 'tree' ? 5 : 2, e.h) : e.form === 'vine' ? Math.min(6, e.h) : e.h,
        w: woody ? Math.min(1.5, e.w) : 0,
        matureH: woody ? e.h : 0, matureW: woody ? e.w : 0,
        r: clamp(e.w / 2 + 0.5, 1, 6), len: 6,
        wildlife: e.wildlife, notes,
        sun: e.sun, water: e.water, zones: e.zones, tags: e.tags,
        photo: e.photo, photoCredit: e.photoCredit, inatId: e.inatId,
        // The family (known for iNaturalist plants) helps pick a flower shape; save the pick on the plant.
        flower: e.flower || guessFlower(e), crown: e.crown,
    };
}

/* Open the Add form filled in from a library entry. */
function addToGarden(e) {
    if (!S.gardenId || S.readOnly) return;
    S.libSel = null;
    S.sel = null;
    S.form = { mode: 'new', kind: 'plants', prefill: plantFromEntry(e) };
    scheduleUI();
}

/* A library entry made from an iNaturalist search result plus its local check. */
function entryFromInat(t, local) {
    const taxon = local?.taxon || {};
    const form = (local && local.form) || guessForm(t) || 'forb';
    const photo = taxon.photo || t.photo;
    const verdict = local?.verdict;
    return cleanLib({
        id: slug(t.sci),
        name: taxon.common || t.common || t.sci,
        sci: taxon.sci || t.sci,
        form,
        h: DEF_H[form], w: form === 'tree' ? 15 : form === 'shrub' ? 4 : 1.5,
        bloom: local?.bloom?.range || null,
        // Most plants lose their leaves or die back in winter; cacti don't. (South of the equator, flip it.)
        leaf: form === 'cactus' ? null : (S.meta?.place?.lat < 0 ? [10, 4] : [4, 10]),
        native: verdict ? verdict.code : 'unknown',
        nativeNote: verdict ? verdict.note : '',
        nativeFor: verdict ? placeKey(S.meta?.place) : '',
        family: taxon.family || (t.family && t.family !== '-' ? t.family : ''),
        flower: guessFlower({ sci: taxon.sci || t.sci, family: taxon.family, form }),
        inatId: t.id,
        photo: photo ? photo.medium : '', photoCredit: photo ? photo.credit : '',
        note: 'Growth form, size and colors are starting guesses. Check them before relying on them.',
    }, 'inat');
}

/* ---------- iNaturalist search ---------- */

function runInatSearch(q) {
    if (searchCtl) searchCtl.abort();
    searchCtl = new AbortController();
    LS.inat = { q, status: 'loading', results: [] };
    renderLibrary();
    searchTaxa(q, searchCtl.signal)
        .then((results) => {
            if (LS.inat.q !== q) return;
            for (const r of results) inatSeen.set(String(r.id), r);
            LS.inat = { q, status: 'done', results };
        })
        .catch((err) => {
            if (err.name === 'AbortError' || LS.inat.q !== q) return;
            LS.inat = { q, status: 'error', results: [] };
        })
        .finally(() => { if (LS.inat.q === q) renderLibrary(); });
}

function onSearchInput(value) {
    LS.q = value;
    renderLibrary();
    clearTimeout(searchTimer);
    const q = value.trim();
    if (q.length >= 3) {
        // Wait until typing pauses so we don't send a request per keystroke.
        searchTimer = setTimeout(() => runInatSearch(q), 450);
    } else {
        if (searchCtl) searchCtl.abort();
        LS.inat = { q: '', status: 'idle', results: [] };
    }
}

/* ---------- the Library tab ---------- */

/* Hardy in the garden's zone? (Unknown ranges pass.) */
function fitsZone(e) {
    const z = zoneNum(S.meta?.zone);
    return z === null || !e.zones || (Math.floor(z) >= e.zones[0] && Math.floor(z) <= e.zones[1]);
}

/* Does a growth form match the plant-type filter (All, Wildflowers, Grasses…)? */
function formFits(form, f) {
    if (f === 'forb') return ['forb', 'annual', 'iris'].includes(form);
    if (['grass', 'shrub', 'tree'].includes(f)) return form === f;
    if (f === 'vine') return ['vine', 'cactus'].includes(form);
    return true;
}

function libList() {
    const q = LS.q.trim().toLowerCase();
    const all = [
        ...S.library.catalog.map(e => ['cat', e]),
        ...[...S.library.saved.values()].map(e => ['sav', e]),
    ];
    return all.filter(([k, e]) => {
        const f = LS.filter;
        if (f === 'saved' && k !== 'sav') return false;
        if (!formFits(e.form, f)) return false;
        if (LS.month && !inRange(S.month, e.bloom)) return false;
        if (LS.native && !['county', 'adjacent', 'region', 'state'].includes(entryNative(e))) return false;
        if (LS.sun && !(e.sun || []).includes(LS.sun)) return false;
        if (LS.zone && !fitsZone(e)) return false;
        if (LS.tag && !(e.tags || []).includes(LS.tag)) return false;
        if (q && !`${e.name} ${e.sci} ${e.wildlife} ${(e.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
        return true;
    }).sort((a, b) => a[1].name.localeCompare(b[1].name));
}

function libRow(k, e) {
    const key = `${k}:${e.id}`, inGarden = gardenMatches(e).length, native = entryNative(e);
    return h('button', { class: 'row' + (S.libSel === key ? ' on' : ''), type: 'button', onclick: () => openLib(key) },
        e.photo ? h('img', { class: 'thumb', src: e.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : swatch(e.bloom ? e.bloomColor : e.foliage),
        h('span', { class: 'nm' }, e.name, h('small', { text: (e.sci || FORMS[e.form]) + (k === 'sav' ? ' · saved' : '') + (inGarden ? ' · in your garden' : '') })),
        h('span', { class: 'meta' }, e.bloom ? fmtRange(e.bloom) : 'no showy bloom',
            h('span', { class: 'nat' + (native === 'county' ? ' county' : ''), text: nativeShort(native, S.meta?.place) })));
}

function inatRow(t) {
    const key = `inat:${t.id}`;
    return h('button', { class: 'row' + (S.libSel === key ? ' on' : ''), type: 'button', onclick: () => openLib(key) },
        t.photo ? h('img', { class: 'thumb', src: t.photo.square, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : swatch('#8d8676'),
        h('span', { class: 'nm' }, t.common || t.sci, h('small', { text: t.common ? t.sci : t.rank })),
        h('span', { class: 'meta', text: t.rank === 'genus' ? 'genus' : '' }));
}

/* ---------- Natives near you ---------- */

/* Starter-list entries by scientific name, so "near you" plants can link to them. */
let catIndex = { n: -1, map: new Map() };
function catalogFor(sci) {
    if (catIndex.n !== S.library.catalog.length) {
        catIndex = { n: S.library.catalog.length, map: new Map(S.library.catalog.map(e => [sciKey(e.sci), e])) };
    }
    const k = sciKey(sci);
    return k ? catIndex.map.get(k) || null : null;
}

/* Growth form for a "near you" plant: the starter list's if it's there, else a guess from genus/family. */
function nearForm(p) {
    const cat = catalogFor(p.sci);
    if (cat) return cat.form;
    return guessForm({ genus: p.genus, family: p.family === '-' ? '' : p.family });
}

/*
 * Load the list for the garden's location. scope: 'county', 'state', or ''
 * to pick automatically (the county, or the state when the county has only
 * a few records). more = true loads the next page onto the current list.
 */
async function loadNear(scope, more = false) {
    const place = S.meta?.place;
    if (!place) return;
    const N = NEAR, forPlace = placeKey(place);
    if (nearCtl) nearCtl.abort();
    const ctl = nearCtl = new AbortController();
    if (more) N.status = 'more';
    else Object.assign(N, { forPlace, status: 'loading', plants: [], total: 0, page: 0, families: 'idle', note: '' });
    renderLibrary();

    // The list for one place: from this device if downloaded this week, else page 1 from iNaturalist.
    const firstPage = async (placeId) => readCached(placeId) || { page: 1, ...(await fetchNatives(placeId, 1, ctl.signal)) };

    try {
        if (!N.placeIds || N.placeIdsFor !== forPlace) {
            N.placeIds = await placeIdsFor(place);
            N.placeIdsFor = forPlace;
        }
        const ids = N.placeIds;
        let use = scope || (ids.county ? 'county' : 'state');
        if (!ids[use]) use = ids.county ? 'county' : 'state';
        if (!ids[use]) { N.status = 'noplace'; renderLibrary(); return; }

        let data;
        if (more) {
            const next = await fetchNatives(N.placeId, N.page + 1, ctl.signal);
            const seen = new Set(N.plants.map(p => p.id));
            data = { total: next.total, page: N.page + 1, plants: [...N.plants, ...next.plants.filter(p => !seen.has(p.id))] };
            use = N.scope;
        } else {
            data = await firstPage(ids[use]);
            // Few records in the county? Show the state, and say why (unless they picked the county).
            if (!scope && use === 'county' && data.total < 40 && ids.state) {
                N.note = `Only ${data.total} native plant${data.total === 1 ? ' has' : 's have'} been recorded in ${place.county || 'the county'} on iNaturalist so far, so this shows all of ${place.state || 'the state'}.`;
                use = 'state';
                data = await firstPage(ids.state);
            }
        }
        if (ctl !== nearCtl) return;
        Object.assign(N, { scope: use, placeId: ids[use], total: data.total, page: data.page, plants: data.plants, status: 'done' });
        writeCached(N.placeId, N);
        renderLibrary();

        // Look up families in the background, so the plant-type filters work.
        if (N.plants.some(p => !p.family)) {
            N.families = 'loading';
            await fillFamilies(N.plants, ctl.signal, () => { if (ctl === nearCtl) renderLibrary(); });
            N.families = 'done';
            writeCached(N.placeId, N);
            if (ctl === nearCtl) renderLibrary();
        }
    } catch (err) {
        if (err.name === 'AbortError' || ctl !== nearCtl) return;
        console.warn('Natives near you:', err);
        // Keep what's already shown if only the family lookup or "Load more" failed.
        if (N.plants.length) { N.status = 'done'; N.families = 'done'; }
        else N.status = 'error';
        renderLibrary();
    }
}

function nearRow(p) {
    const cat = catalogFor(p.sci);
    inatSeen.set(String(p.id), p);                 // so its iNaturalist entry can open
    const key = cat ? `cat:${cat.id}` : `inat:${p.id}`;
    const k = sciKey(p.sci);
    const inGarden = k && [...S.items.plants.values()].some(x => sciKey(x.sci) === k);
    const form = nearForm(p);
    // Show the plant type only when it's known (starter list) or worked out from its family.
    const sure = cat || (p.family && p.family !== '-');
    const type = sure && FORMS[form] ? FORMS[form].replace(' patch', '').replace(' ring', '') : '';
    const bits = [p.common ? p.sci : '', type, inGarden ? 'in your garden' : '', cat ? 'in the starter list' : ''].filter(Boolean);
    return h('button', { class: 'row' + (S.libSel === key ? ' on' : ''), type: 'button', onclick: () => openLib(key) },
        p.photo ? h('img', { class: 'thumb', src: p.photo.square, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : swatch('#8d8676'),
        h('span', { class: 'nm' }, p.common || p.sci, h('small', { text: bits.join(' · ') })),
        h('span', { class: 'meta', title: 'Observations on iNaturalist in this area', text: `${p.count.toLocaleString()} seen` }));
}

/* Fill the tab's parts for the "Natives near you" view. */
function renderNear(pane) {
    const place = S.meta?.place, N = NEAR;
    const list = pane.querySelector('#libList'), count = pane.querySelector('#libCount'), tog = pane.querySelector('#libTog');
    pane.querySelector('#libAbout').textContent = 'From iNaturalist: wild plants that people have photographed in this area and that iNaturalist lists as native here, most-recorded first. Garden plantings are left out. Some natives aren\'t marked native on iNaturalist yet, so they won\'t appear; search for them by name. Plant types are a guess from each plant\'s family until you open it.';
    if (!place) {
        tog.replaceChildren();
        count.textContent = '';
        list.replaceChildren(h('p', { class: 'empty', text: "Set this garden's location (click the garden name → Settings) to see the native plants recorded around it." }));
        return;
    }
    // Start loading the first time, and whenever the garden's location changes.
    if (N.forPlace !== placeKey(place)) { loadNear(''); return; }

    // Which area: the county or the whole state.
    tog.replaceChildren(...[['county', place.county], ['state', place.state]].filter(([, name]) => name).map(([k, name]) =>
        h('button', { type: 'button', 'aria-pressed': String(N.scope === k), disabled: N.status === 'loading', onclick: () => loadNear(k) }, k === 'county' && !/county|parish/i.test(name) ? `${name} County` : name)));

    if (N.status === 'loading') {
        count.textContent = 'Asking iNaturalist which natives have been recorded near you…';
        list.replaceChildren();
        return;
    }
    if (N.status === 'error' || N.status === 'noplace') {
        count.textContent = '';
        list.replaceChildren(h('p', { class: 'empty', text: N.status === 'noplace' ? "iNaturalist doesn't have this garden's state or county as a place, so there's no local list. Use the starter list, or search by name." : "Couldn't reach iNaturalist. Check your connection." }),
            N.status === 'error' ? h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => loadNear(N.scope) }) : null);
        return;
    }
    const q = LS.q.trim().toLowerCase();
    const sorting = N.families === 'loading' && LS.filter !== 'all';
    const shown = N.plants.filter(p => formFits(nearForm(p), LS.filter) && (!q || `${p.common} ${p.sci}`.toLowerCase().includes(q)));
    const where = N.scope === 'county' ? (place.county || 'the county') : (place.state || 'the state');
    count.textContent = `${shown.length} of ${N.plants.length.toLocaleString()} native plants recorded in ${where}` + (sorting ? ' · still sorting plant types…' : '');
    const kids = [];
    if (N.note) kids.push(h('p', { class: 'note', style: 'margin:0 0 8px', text: N.note }));
    kids.push(...(shown.length ? shown.map(nearRow) : [h('p', { class: 'empty', text: q ? 'None by that name in this list.' : 'None of this type in this list yet.' })]));
    if (N.page * PER_PAGE < N.total) {
        kids.push(h('button', { class: 'btn', type: 'button', style: 'margin-top:8px', text: N.status === 'more' ? 'Loading…' : 'Load more (less often recorded)', disabled: N.status === 'more', onclick: () => loadNear(N.scope, true) }));
    }
    list.replaceChildren(...kids);
}

/* ---------- the Library tab ---------- */

export function renderLibrary() {
    const pane = $('#pane-lib');
    if (!LS.source) LS.source = S.meta?.place ? 'near' : 'list';
    const near = LS.source === 'near';
    // Build the fixed parts once so the search box keeps focus while typing.
    if (!pane.querySelector('#libSearch')) {
        const search = h('input', {
            id: 'libSearch', class: 'search', type: 'search',
            placeholder: 'Search any plant: name, genus, or wildlife', 'aria-label': 'Search plants',
            oninput: (e) => onSearchInput(e.target.value),
        });
        pane.replaceChildren(
            h('div', { class: 'seg source', id: 'libSource', role: 'group', 'aria-label': 'Which plants' }),
            search,
            h('div', { class: 'seg', id: 'libSeg', role: 'group', 'aria-label': 'Plant type' }),
            h('div', { class: 'seg', id: 'libTog', role: 'group', 'aria-label': 'Filters', style: 'margin-top:0' }),
            h('p', { class: 'count-line', id: 'libCount' }),
            h('div', { class: 'rows', id: 'libList' }),
            h('div', { id: 'libInat' }),
            h('p', { class: 'note', id: 'libAbout' }));
    }
    pane.querySelector('#libSource').replaceChildren(...[['near', 'Natives near you'], ['list', 'Starter list']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(LS.source === k), onclick: () => { LS.source = k; savePref('libSource', k); if (k === 'near' && LS.filter === 'saved') LS.filter = 'all'; renderLibrary(); } }, label)));
    const types = [['all', 'All'], ['forb', 'Wildflowers'], ['grass', 'Grasses'], ['shrub', 'Shrubs'], ['tree', 'Trees'], ['vine', 'Vines & cacti']];
    if (!near) types.push(['saved', 'My library']);
    pane.querySelector('#libSeg').replaceChildren(...types.map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(LS.filter === k), onclick: () => { LS.filter = k; renderLibrary(); } }, label)));

    if (near) renderNear(pane);
    else renderStarter(pane);

    // iNaturalist results (only while searching).
    const box = pane.querySelector('#libInat');
    const I = LS.inat;
    if (LS.q.trim().length < 3) box.replaceChildren(LS.q.trim() ? h('p', { class: 'note', text: 'Type at least 3 letters to search iNaturalist too.' }) : '');
    else if (I.status === 'loading' || I.status === 'idle') box.replaceChildren(h('h3', { text: 'From iNaturalist' }), h('p', { class: 'empty', text: 'Searching…' }));
    else if (I.status === 'error') box.replaceChildren(h('h3', { text: 'From iNaturalist' }), h('p', { class: 'empty', text: "Couldn't reach iNaturalist. Check your connection." }));
    else box.replaceChildren(h('h3', { text: 'From iNaturalist' }),
        I.results.length ? h('div', { class: 'rows' }, I.results.map(inatRow)) : h('p', { class: 'empty', text: 'No plants by that name.' }));
}

/* Fill the tab's parts for the starter list (and My library). */
function renderStarter(pane) {
    const zone = S.meta?.zone;
    pane.querySelector('#libTog').replaceChildren(
        h('button', { type: 'button', 'aria-pressed': String(LS.month), onclick: () => { LS.month = !LS.month; renderLibrary(); } }, `Blooms in ${MSHORT[S.month - 1]}`),
        h('button', { type: 'button', 'aria-pressed': String(LS.native), onclick: () => { LS.native = !LS.native; renderLibrary(); } }, 'Native here'),
        zone ? h('button', { type: 'button', 'aria-pressed': String(LS.zone), onclick: () => { LS.zone = !LS.zone; renderLibrary(); } }, `Hardy in zone ${zone}`) : null,
        // The wildlife filter only shows while it's on (Garden Check turns it on); click to clear it.
        LS.tag ? h('button', { type: 'button', 'aria-pressed': 'true', title: 'Clear this filter', onclick: () => { LS.tag = ''; renderLibrary(); } }, `${TAGS[LS.tag]} ×`) : null,
        ...[['full', 'Full sun'], ['part', 'Part sun'], ['shade', 'Shade']].map(([k, label]) =>
            h('button', { type: 'button', 'aria-pressed': String(LS.sun === k), onclick: () => { LS.sun = LS.sun === k ? '' : k; renderLibrary(); } }, label)));

    const L = S.library;
    const list = libList();
    const total = L.catalog.length + L.saved.size;
    pane.querySelector('#libCount').textContent = L.failed ? "The starter list didn't load. Reload the page to try again."
        : !L.loaded ? 'Loading the starter list…' : `${list.length} of ${total} in the starter list and your library`;
    pane.querySelector('#libList').replaceChildren(...(list.length ? list.map(([k, e]) => libRow(k, e)) : [h('p', { class: 'empty', text: L.loaded ? 'No matches in the starter list.' : '' })]));
    pane.querySelector('#libAbout').textContent = L.about;
}

/* ---------- the detail panel for a library entry ---------- */

function head(eyebrow, title, sci) {
    return h('div', { class: 'dh' },
        h('div', {}, h('div', { class: 'eyebrow', text: eyebrow }), h('h2', { text: title }), sci ? h('div', { class: 'sci', text: sci }) : null),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: closeLib, text: '×' }));
}

/* Shown when an iNaturalist search result is opened. Runs the local check right away. */
function renderInatDetail(box, id) {
    const t = inatSeen.get(id);
    if (!t) { S.libSel = null; scheduleUI(); return; }
    const target = { inatId: t.id, sci: t.sci };
    const c = S.meta?.place ? getCheck(target) || runCheck(target) : null;
    const local = c && c.status === 'done' ? c.result : null;
    const taxon = local?.taxon;
    const photo = (taxon && taxon.photo) || t.photo;

    const kids = [head(`iNaturalist${taxon?.family ? ' · ' + taxon.family : ''}`, (taxon?.common || t.common || t.sci), t.sci)];
    if (photo) kids.push(photoFigure(photo.medium, photo.credit));
    const cb = checkBlock(target, { auto: true });
    if (cb) kids.push(cb);
    if (taxon?.wiki) {
        const text = taxon.wiki.length > 700 ? taxon.wiki.slice(0, 680).replace(/\s+\S*$/, '') + '…' : taxon.wiki;
        kids.push(h('p', { class: 'prose' }, text, ' ', taxon.wikiUrl ? h('a', { href: taxon.wikiUrl, target: '_blank', rel: 'noopener' }, 'Wikipedia') : null));
    }
    if (local?.form) kids.push(h('p', { class: 'note', text: `Growth form guess: ${FORMS[local.form]}${taxon?.family ? ` (from its family, ${taxon.family})` : ''}. You can change it when adding.` }));

    const entry = entryFromInat(t, local);
    const acts = [h('button', { class: 'btn primary', type: 'button', text: 'Add to garden', disabled: !S.gardenId || S.readOnly, onclick: () => addToGarden(entry) })];
    const already = S.library.saved.has(entry.id);
    if (!S.readOnly) acts.push(h('button', {
        class: 'btn', type: 'button', text: already ? 'Saved in my library' : 'Save to my library', disabled: already,
        onclick: async () => { await Store.saveLibrary({ ...entry, source: 'saved' }); toast(`Saved ${entry.name} to your library.`); S.libSel = `sav:${entry.id}`; scheduleUI(); },
    }));
    kids.push(h('div', { class: 'actions' }, acts));
    box.replaceChildren(...kids);
}

/* Called by ui/detail.js when S.libSel is set. */
export function renderLibDetail(box) {
    if (S.libSel.startsWith('inat:')) { renderInatDetail(box, S.libSel.slice(5)); return; }
    const e = getEntry(S.libSel);
    if (!e) { S.libSel = null; scheduleUI(); return; }
    const isSaved = S.libSel.startsWith('sav:');
    const native = entryNative(e);

    const kids = [head(`${isSaved ? 'My library' : 'Starter list'} · ${FORMS[e.form]}`, e.name, e.sci)];
    if (e.photo) kids.push(photoFigure(e.photo, e.photoCredit));
    kids.push(h('div', { class: 'chips' }, nativeChip(native)));

    const dl = h('dl', { class: 'facts' });
    dl.append(...fact('Mature size', `${e.h} ft tall × ${e.w} ft wide`));
    dl.append(...fact('Bloom', e.bloom ? swatch(e.bloomColor) : '', e.bloom && e.bloomColor2 ? swatch(e.bloomColor2) : '', e.bloom ? fmtRange(e.bloom) : 'No showy bloom'));
    if (e.fruit) dl.append(...fact('Fruit', swatch(e.fruitColor), fmtRange(e.fruit)));
    if (e.seed) dl.append(...fact('Seed heads', swatch(SEED_BROWN), fmtRange(e.seed)));
    dl.append(...fact('Leaves', e.leaf ? (e.leaf[0] === 1 && e.leaf[1] === 12 ? 'Semi-evergreen' : fmtRange(e.leaf)) : 'Evergreen'));
    dl.append(...traitFacts(e));
    kids.push(dl);
    const chips = tagChips(e.tags);
    if (chips) kids.push(chips);

    // A nativity note only makes sense for the place it was written for.
    if (e.nativeNote && native !== 'unknown') kids.push(h('p', { class: 'prose' }, h('b', { text: 'Nativity: ' }), e.nativeNote));
    else if (e.source === 'catalog' && S.meta?.place) kids.push(h('p', { class: 'note', text: 'This starter-list entry was researched for western Oklahoma. Use the check below for this garden.' }));
    if (e.wildlife) kids.push(h('p', { class: 'prose' }, h('b', { text: 'Wildlife: ' }), e.wildlife));
    if (e.cautions) kids.push(h('p', { class: 'prose' }, h('b', { text: 'Watch for: ' }), e.cautions));
    if (e.note) kids.push(h('p', { class: 'note', text: e.note }));

    const inGarden = gardenMatches(e);
    if (inGarden.length) {
        kids.push(h('p', { class: 'prose' }, `In your garden: ${inGarden.length} ${inGarden.length === 1 ? 'entry' : 'entries'}. `,
            h('button', { class: 'linkbtn', type: 'button', text: 'Show it', onclick: () => select(`plants:${inGarden[0].id}`, { fly: true }) })));
    }

    // Saved entries can take on what the check finds; starter-list entries stay as published.
    const save = (changes) => Store.saveLibrary({ ...e, ...changes });
    const cb = checkBlock({ sci: e.sci, inatId: e.inatId }, isSaved ? {
        currentNative: native, currentBloom: e.bloom, hasPhoto: !!e.photo,
        onUseNative: (v) => save({ native: v.code, nativeNote: v.note, nativeFor: placeKey(S.meta?.place) }),
        onUseBloom: (range) => save({ bloom: range }),
        onUsePhoto: (photo, inatId) => save({ photo: photo.medium, photoCredit: photo.credit, inatId }),
    } : {});
    if (cb) kids.push(cb);

    const acts = [h('button', { class: 'btn primary', type: 'button', text: 'Add to garden', disabled: !S.gardenId || S.readOnly, onclick: () => addToGarden(e) })];
    if (isSaved && !S.readOnly) acts.push(confirmButton('Remove from library', 'Confirm remove', () => { S.libSel = null; Store.deleteLibrary(e.id); }));
    kids.push(h('div', { class: 'actions' }, acts));
    box.replaceChildren(...kids);
}
