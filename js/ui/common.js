/*
 * ui/common.js
 * ---------------------------------------------------------------------------
 * Little building blocks shared by the panels: color swatches, chips,
 * fact rows, form fields, and the bloom counts used by the month strip,
 * "This month" and the calendar.
 */
import { S } from '../state.js';
import { h, MSHORT, inRange } from '../util.js';
import { STATUS, SUN, WATER, TAGS, nativeLabel } from '../model.js';

/* A small colored square (or a grey dot for features). */
export function swatch(color, extra = '') {
    return h('span', { class: 'sw ' + extra, style: color ? `background:${color}` : null });
}

export function statusChip(s) {
    return h('span', { class: `chip dot s-${s}`, text: STATUS[s] || s });
}

export function nativeChip(code) {
    return h('span', { class: `chip n-${code}`, text: nativeLabel(code, S.meta?.place) });
}

/* One row of a facts list: <dt>label</dt><dd>value…</dd> */
export function fact(label, ...value) {
    return [h('dt', { text: label }), h('dd', {}, ...value)];
}

/*
 * Fact rows for growing needs: sun, water, hardiness zones. `t` is a plant's
 * traits (library/match.js traitsOf) or a library entry.
 */
export function traitFacts(t) {
    const out = [];
    if (t.sun && t.sun.length) out.push(...fact('Light', t.sun.map(k => SUN[k]).join(' to ')));
    if (t.water) out.push(...fact('Water', WATER[t.water]));
    if (t.zones) out.push(...fact('Zones', `USDA ${t.zones[0]}–${t.zones[1]}`));
    return out;
}

/* Little chips for the wildlife a plant supports. */
export function tagChips(tags) {
    if (!tags || !tags.length) return null;
    return h('div', { class: 'chips' }, tags.map(k => h('span', { class: `chip tag t-${k}`, text: TAGS[k] })));
}

/* A photo with its credit line underneath (photos from iNaturalist carry a license in the credit). */
export function photoFigure(src, credit, alt = '') {
    if (!src) return null;
    return h('figure', { class: 'photo' },
        h('img', { src, alt, loading: 'lazy', referrerpolicy: 'no-referrer' }),
        credit ? h('figcaption', { text: credit }) : null);
}

/*
 * A button that asks "are you sure?" by needing a second click.
 *   confirmButton('Delete', 'Confirm delete', () => ...)
 */
export function confirmButton(label, confirmLabel, onConfirm, cls = 'btn danger') {
    const b = h('button', { class: cls, type: 'button', text: label });
    b.addEventListener('click', () => {
        if (!b.classList.contains('confirm')) {
            b.classList.add('confirm');
            b.textContent = confirmLabel;
            return;
        }
        onConfirm();
    });
    return b;
}

/* ---------- form fields ---------- */

/* <label>Label <input></label>; cls 'full' makes it span both columns. */
export function field(label, input, cls) {
    return h('label', { class: cls || null }, label, input);
}

export function inp(name, value, type = 'text', extra = {}) {
    return h('input', { name, id: 'f-' + name, type, value: value ?? '', ...extra });
}

/* A <select> from [[value, label], ...] with `value` chosen. */
export function sel(name, value, options) {
    const s = h('select', { name, id: 'f-' + name });
    for (const [v, label] of options) {
        const o = h('option', { value: v, text: label });
        if (String(v) === String(value)) o.selected = true;
        s.append(o);
    }
    return s;
}

export const MONTH_OPTS = [['', '—'], ...MSHORT.map((m, i) => [i + 1, m])];

/* Two month dropdowns for a [from, to] range, named nameA and nameB. */
export function rangePair(name, r) {
    return h('div', { class: 'pair' }, sel(name + 'A', r ? r[0] : '', MONTH_OPTS), sel(name + 'B', r ? r[1] : '', MONTH_OPTS));
}

/* Read a rangePair back out of FormData; null if both are blank. */
export function readRange(fd, name) {
    const a = parseInt(fd.get(name + 'A'), 10), b = parseInt(fd.get(name + 'B'), 10);
    if (!a && !b) return null;
    return [a || b, b || a];
}

/* ---------- bloom counts ---------- */

/*
 * The same species planted in three places should count once, so plants are
 * grouped by scientific name (or common name if there's no usable one).
 */
export function speciesKey(it) {
    const sci = (it.sci || '').trim();
    return (sci && !/\bsp\.?$|not recorded|hybrid/i.test(sci) ? sci : it.name).toLowerCase();
}

/* For each month: how many species bloom, and how many have fruit or seed. */
export function bloomCounts(includePlanned) {
    const bloom = Array.from({ length: 12 }, () => new Set());
    const fruit = Array.from({ length: 12 }, () => new Set());
    for (const it of S.items.plants.values()) {
        if (!includePlanned && it.status === 'planned') continue;
        const k = speciesKey(it);
        for (let m = 1; m <= 12; m++) {
            if (inRange(m, it.bloom)) bloom[m - 1].add(k);
            if (inRange(m, it.fruit) || inRange(m, it.seed)) fruit[m - 1].add(k);
        }
    }
    return { bloom: bloom.map(s => s.size), fruit: fruit.map(s => s.size) };
}

/*
 * A "thin month": during the growing season, two or fewer species in bloom.
 * Pollinators need something flowering all season, so these are the gaps to fill.
 * (Growing season = March–October north of the equator, September–April south.)
 */
export function isThin(m, n) {
    if (!S.items.plants.size) return false;      // an empty garden isn't "thin", just new
    const lat = S.meta?.place?.lat ?? 35;
    const sm = lat < 0 ? ((m + 5) % 12) + 1 : m;
    return sm >= 3 && sm <= 10 && n <= 2;
}
