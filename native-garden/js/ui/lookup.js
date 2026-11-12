/*
 * ui/lookup.js
 * ---------------------------------------------------------------------------
 * The "For this garden" box shown on plants and library entries. It runs
 * checkPlant() (library/lookup.js) and shows:
 *   - a nativity verdict with the evidence behind it
 *   - a bar chart of flowering observations by month near the garden
 *   - buttons to copy those findings onto the plant ("Use Apr–Jun")
 *   - links to see the records on iNaturalist and GBIF
 *
 * Results are remembered for this visit (per garden location + plant), so
 * reopening a plant doesn't ask the APIs again.
 */
import { S, scheduleUI } from '../state.js';
import { checkPlant } from '../library/lookup.js';
import { taxonUrl, nearbyUrl } from '../library/inat.js';
import { recordsUrl } from '../library/gbif.js';
import { placeKey } from '../model.js';
import { h, MSHORT, fmtRange } from '../util.js';
import { nativeChip } from './common.js';

const checks = new Map();   // key → { status: 'loading' | 'done' | 'error', result }

/* target: { sci, inatId } */
function keyFor(target) {
    return `${placeKey(S.meta?.place)}|${target.inatId || (target.sci || '').trim().toLowerCase()}`;
}

export function getCheck(target) {
    return checks.get(keyFor(target)) || null;
}

/* Start a check (or return the one already running/finished). */
export function runCheck(target) {
    const key = keyFor(target);
    const existing = checks.get(key);
    if (existing && existing.status !== 'error') return existing;
    const entry = { status: 'loading', result: null };
    checks.set(key, entry);
    checkPlant(target, S.meta?.place || null)
        .then((result) => { entry.status = 'done'; entry.result = result; })
        .catch((err) => { console.warn(err); entry.status = 'error'; })
        .finally(() => scheduleUI());
    scheduleUI();
    return entry;
}

/* A small month-by-month bar chart. */
export function histogram(counts) {
    const max = Math.max(1, ...counts);
    return [
        h('div', { class: 'hist', 'aria-hidden': 'true' }, counts.map(v => h('i', { style: `height:${Math.round(v / max * 100)}%` }))),
        h('div', { class: 'hist-l', 'aria-hidden': 'true' }, MSHORT.map(m => h('span', { text: m[0] }))),
    ];
}

/*
 * The box itself. Options (all optional):
 *   auto                 start the check right away instead of showing a button
 *   onUseNative(verdict) show "Use this nativity" and call this when clicked
 *   onUseBloom(range)    show "Use Apr–Jun as bloom months"
 *   onUsePhoto(photo, taxonId)  show "Use the iNaturalist photo" (when hasPhoto is false)
 *   currentNative, currentBloom, hasPhoto   so buttons hide when there's nothing new
 */
export function checkBlock(target, opts = {}) {
    if (!target.sci && !target.inatId) return null;
    const place = S.meta?.place;
    const box = h('div', { class: 'check' }, h('h3', { text: 'For this garden' }));
    if (!place) {
        box.append(h('p', { class: 'note', text: "Add this garden's location (click the garden name → Settings) to check nativity and bloom times with iNaturalist and GBIF." }));
        return box;
    }
    let c = getCheck(target);
    if (!c && opts.auto) c = runCheck(target);
    const where = place.county || place.state || place.label;

    if (!c) {
        box.append(h('button', { class: 'btn', type: 'button', text: `Check iNaturalist & GBIF for ${where}`, onclick: () => runCheck(target) }));
        return box;
    }
    if (c.status === 'loading') {
        box.append(h('p', { class: 'note wait', text: 'Checking iNaturalist and GBIF…' }));
        return box;
    }
    if (c.status === 'error') {
        box.append(
            h('p', { class: 'note', text: "Couldn't reach iNaturalist or GBIF. Check your connection." }),
            h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => runCheck(target) }));
        return box;
    }

    const r = c.result;
    // Nativity
    box.append(h('div', { class: 'chips' }, nativeChip(r.verdict.code)));
    if (r.verdict.note) box.append(h('p', { class: 'prose', text: r.verdict.note }));
    if (opts.onUseNative && r.verdict.code !== 'unknown' && r.verdict.code !== opts.currentNative) {
        box.append(h('p', {}, h('button', { class: 'linkbtn', type: 'button', text: 'Use this nativity', onclick: () => opts.onUseNative(r.verdict) })));
    }
    // Bloom months
    if (r.bloom && r.bloom.total > 0) {
        box.append(...histogram(r.bloom.counts));
        box.append(h('p', { class: 'note', text: `${r.bloom.total.toLocaleString()} flowering observations within ${r.bloom.radius} km` + (r.bloom.range ? `, mostly ${fmtRange(r.bloom.range)}.` : '; too few to judge bloom months.') }));
        if (opts.onUseBloom && r.bloom.range && JSON.stringify(r.bloom.range) !== JSON.stringify(opts.currentBloom)) {
            box.append(h('p', {}, h('button', { class: 'linkbtn', type: 'button', text: `Use ${fmtRange(r.bloom.range)} as bloom months`, onclick: () => opts.onUseBloom(r.bloom.range) })));
        }
    } else if (r.taxon) {
        box.append(h('p', { class: 'note', text: 'No flowering observations near here on iNaturalist yet.' }));
    }
    // Photo
    if (opts.onUsePhoto && !opts.hasPhoto && r.taxon && r.taxon.photo) {
        box.append(h('p', {}, h('button', { class: 'linkbtn', type: 'button', text: 'Use the iNaturalist photo', onclick: () => opts.onUsePhoto(r.taxon.photo, r.taxon.id) })));
    }
    if (r.errors.length) box.append(h('p', { class: 'note', text: `Couldn't reach ${r.errors.join(' or ')} just now; some details are missing.` }));
    if (!r.taxon && !r.gbif) box.append(h('p', { class: 'note', text: "Neither service recognized that name. Check the scientific name's spelling." }));

    // Links to the evidence
    const links = h('div', { class: 'links' });
    if (r.taxon) {
        links.append(h('a', { href: taxonUrl(r.taxon.id), target: '_blank', rel: 'noopener' }, 'iNaturalist species page'));
        links.append(h('a', { href: nearbyUrl(r.taxon.id, place.lat, place.lng), target: '_blank', rel: 'noopener' }, 'Flowering observations near here'));
    }
    if (r.gbif && place.gadm.county) links.append(h('a', { href: recordsUrl(r.gbif.key, place.gadm.county), target: '_blank', rel: 'noopener' }, `GBIF records in ${place.county}`));
    if (links.children.length) box.append(links);
    return box;
}
