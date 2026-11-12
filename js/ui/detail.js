/*
 * ui/detail.js
 * ---------------------------------------------------------------------------
 * The panel on the right. It shows one of three things:
 *   1. the Add / Edit form           when S.form is set
 *   2. a plant library entry         when S.libSel is set (drawn by ui/library.js)
 *   3. the selected item's details   when S.sel is set
 * and hides when none of those are set.
 */
import { S, scheduleUI } from '../state.js';
import { select, upsertItem, removeItem, getRec, displayName } from '../garden.js';
import { flyToRec, viewCenter } from '../scene.js';
import { Store } from '../store/index.js';
import { $, h, fmtRange, toast, newId } from '../util.js';
import { FORMS, FTYPES, STATUS, NATIVE_CODES, WATER, SUN, TAGS, SEED_BROWN, CLEAN, toDoc, cleanPlant, cleanFeature, cleanZone, nativeLabel, SHAPES, SURFACES } from '../model.js';
import { swatch, statusChip, nativeChip, fact, field, inp, sel, rangePair, readRange, photoFigure, confirmButton, traitFacts, tagChips } from './common.js';
import { renderLibDetail, openLib } from './library.js';
import { libMatch, traitsOf } from '../library/match.js';
import { checkBlock } from './lookup.js';
import { FLOWERS, CROWNS, guessFlower, guessCrown } from '../flora/shapes.js';
import { toggleEdit } from './toolbar.js';
import { checkNote } from './gardencheck.js';

/* Feature types drawn as buildings (they have width, depth and height). */
const BUILDING = ['house', 'garage', 'shed', 'greenhouse', 'pergola', 'gazebo'];

function showPanel(on) {
    const box = $('#detail');
    box.hidden = !on;
    document.body.classList.toggle('has-detail', on);
    if (!on) box.replaceChildren();
    return box;
}

export function renderDetail() {
    if (S.form && S.gardenId && !S.readOnly) { renderForm(); return; }
    if (S.libSel) { renderLibDetail(showPanel(true)); return; }
    const rec = S.sel && getRec(S.sel);
    if (!rec) { showPanel(false); return; }
    renderItem(showPanel(true), rec);
}

/* ---------- item details ---------- */

/* Save a changed item: rebuild it now, then send it to storage. */
function commit(it) {
    upsertItem(it.kind, it.id, toDoc(it), { force: true });
    Store.saveItem(it);
}

/* "From the plant library": extra facts when the plant matches a library entry. */
function libBox(e, it) {
    const key = e.source === 'catalog' ? `cat:${e.id}` : `sav:${e.id}`;
    const box = h('div', { class: 'libbox' }, h('h3', { text: 'From the plant library' }));
    if (e.wildlife && !(it.wildlife || '').includes(e.wildlife.slice(0, 30))) box.append(h('p', {}, h('b', { text: 'Wildlife: ' }), e.wildlife));
    if (e.cautions && !(it.notes || '').includes(e.cautions.slice(0, 30))) box.append(h('p', {}, h('b', { text: 'Watch for: ' }), e.cautions));
    box.append(h('button', { class: 'linkbtn', type: 'button', text: 'Open in the library', onclick: () => openLib(key) }));
    return box;
}

function renderItem(box, rec) {
    const it = rec.item, kind = rec.kind;
    const eyebrow = kind === 'plants' ? FORMS[it.form] : kind === 'features' ? FTYPES[it.type] : SURFACES[it.surface] === SURFACES.tint ? 'Bed / area' : `Bed / area · ${SURFACES[it.surface]}`;
    const kids = [];
    kids.push(h('div', { class: 'dh' },
        h('div', {},
            h('div', { class: 'eyebrow', text: eyebrow }),
            h('h2', { text: displayName(it) + (it.count > 1 ? ` ×${it.count}` : '') }),
            it.sci ? h('div', { class: 'sci', text: it.sci }) : null),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', onclick: () => select(null), text: '×' })));
    if (kind === 'plants' && it.photo) kids.push(photoFigure(it.photo, it.photoCredit));

    const chips = [];
    if (it.status) chips.push(statusChip(it.status));
    if (kind === 'plants') chips.push(nativeChip(it.native));
    if (chips.length) kids.push(h('div', { class: 'chips' }, chips));

    const dl = h('dl', { class: 'facts' });
    if (kind === 'plants') {
        dl.append(...fact('Bloom', it.bloom ? swatch(it.bloomColor) : '', it.bloomColor2 && it.bloom ? swatch(it.bloomColor2) : '', fmtRange(it.bloom)));
        if (it.fruit) dl.append(...fact('Fruit', swatch(it.fruitColor), fmtRange(it.fruit)));
        if (it.seed) dl.append(...fact('Seed heads', swatch(SEED_BROWN), fmtRange(it.seed)));
        dl.append(...fact('Leaves', it.leaf ? (it.leaf[0] === 1 && it.leaf[1] === 12 ? 'Semi-evergreen' : fmtRange(it.leaf)) : 'Evergreen'));
        if (['tree', 'shrub', 'vine'].includes(it.form)) {
            const now = it.form === 'vine' ? `${it.len} ft run on the fence` : `${it.h} ft tall now`;
            dl.append(...fact('Size', now + (it.matureH ? ` · mature ${it.matureH} × ${it.matureW} ft` : '')));
        } else {
            dl.append(...fact('Patch', `${(it.r * 2).toFixed(0)}${it.rz ? ` × ${(it.rz * 2).toFixed(0)}` : ''} ft across · ${it.h} ft tall`));
        }
        dl.append(...traitFacts(traitsOf(it)));
        if (it.planted) dl.append(...fact('Planted', it.planted));
        if (it.source) dl.append(...fact('Source', it.source));
    } else if (kind === 'features') {
        if (it.type === 'nestbox') dl.append(...fact('Mounted', `${it.y} ft up${it.onTree ? ', on a tree' : ', on a pole'}`));
        if (it.type === 'feeder' && it.onTree) dl.append(...fact('Mounted', `hangs from a tree, ${it.y || 6} ft up`));
        if (it.type === 'windmill') dl.append(...fact('Height', `${it.y || 16} ft`));
        if (it.type === 'fence') dl.append(...fact('Length', `${it.len} ft`));
        if (it.type === 'pond') dl.append(...fact('Surface', `${it.w} × ${it.d || it.w} ft${it.stream ? ` · ${it.stream} ft stream` : ''}`));
        if (BUILDING.includes(it.type)) dl.append(...fact('Size', `${it.w} × ${it.d || it.w} ft, ${it.y} ft tall`));
        if (['wall', 'hedge'].includes(it.type)) dl.append(...fact('Size', `${it.len} ft long, ${it.y} ft tall`));
    } else {
        dl.append(...fact('Size', it.shape === 'circle' ? `${it.r * 2} ft across` : it.shape === 'poly' ? `${it.points.length} corners` : `${it.w} × ${it.d} ft`));
        if (it.raised) dl.append(...fact('Raised', `${it.raised} ft`));
    }
    dl.append(...fact('Position', h('span', { class: 'mono', text: `x ${it.x.toFixed(1)} · z ${it.z.toFixed(1)} ft` })));
    kids.push(dl);

    if (kind === 'plants') {
        const tc = tagChips(traitsOf(it).tags);
        if (tc) kids.push(tc);
        const cn = checkNote(it);          // summer sun here, and any Garden Check issues
        if (cn) kids.push(cn);
    }
    if (it.notes) kids.push(h('p', { class: 'prose', text: it.notes }));
    if (it.wildlife) kids.push(h('p', { class: 'prose' }, h('b', { text: 'Wildlife: ' }), it.wildlife));

    if (kind === 'plants') {
        const e = libMatch(it);
        if (e) kids.push(libBox(e, it));
        const cb = checkBlock({ sci: it.sci, inatId: it.inatId }, S.readOnly ? {} : {
            currentNative: it.native, currentBloom: it.bloom, hasPhoto: !!it.photo,
            onUseNative: (v) => { commit({ ...it, native: v.code }); toast('Nativity updated.'); },
            onUseBloom: (range) => { commit({ ...it, bloom: range }); toast(`Bloom months set to ${fmtRange(range)}.`); },
            onUsePhoto: (photo, inatId) => { commit({ ...it, photo: photo.medium, photoCredit: photo.credit, inatId }); },
        });
        if (cb) kids.push(cb);
    }

    // A shared garden (read-only) gets just "Zoom to".
    kids.push(h('div', { class: 'actions' },
        S.readOnly ? null : h('button', { class: 'btn primary', type: 'button', text: 'Edit', onclick: () => { S.form = { mode: 'edit', kind, id: it.id }; scheduleUI(); } }),
        h('button', { class: 'btn', type: 'button', text: 'Zoom to', onclick: () => flyToRec(rec) }),
        S.readOnly ? null : confirmButton('Delete', 'Confirm delete', () => {
            removeItem(kind, it.id);
            Store.deleteItem(kind, it.id);
            toast(`Deleted ${displayName(it)}.`);
        })));
    box.replaceChildren(...kids);
}

/* ---------- the Add / Edit form ---------- */

/*
 * One form for all three kinds. For a new entry, "Type of entry" switches
 * between plant, feature and bed. The less common fields sit in a fold-out
 * <details> section so the form doesn't look overwhelming.
 */
function renderForm() {
    const box = showPanel(true);
    const { mode, kind } = S.form;
    const existing = mode === 'edit' ? S.items[kind].get(S.form.id) : null;
    if (mode === 'edit' && !existing) { S.form = null; scheduleUI(); return; }
    const prefill = S.form.prefill || { name: '', status: 'planned' };
    const base = existing || (kind === 'plants' ? cleanPlant('new', prefill) : kind === 'features' ? cleanFeature('new', prefill) : cleanZone('new', prefill));
    const place = S.meta?.place;

    const f = h('form', { class: 'form', id: 'itemForm' });
    if (mode === 'new' && !S.form.prefill) {
        const kindPick = field('Type of entry', sel('kind', kind, [['plants', 'Plant'], ['features', 'Feature or structure'], ['zones', 'Bed, path or surface']]), 'full');
        kindPick.querySelector('select').addEventListener('change', (e) => { S.form = { mode: 'new', kind: e.target.value }; renderForm(); });
        f.append(kindPick);
    }
    f.append(field('Name', inp('name', base.name, 'text', { required: true, maxlength: 80 }), 'full'));

    if (kind === 'plants') {
        f.append(
            field('Scientific name', inp('sci', base.sci), 'full'),
            field('Growth form', sel('form', base.form, Object.entries(FORMS))),
            field('Status', sel('status', base.status, Object.entries(STATUS).filter(([s]) => s !== 'inprogress'))),
            field('Native status', sel('native', base.native, NATIVE_CODES.map(c => [c, nativeLabel(c, place)])), 'full'),
            field('Bloom from / to', rangePair('bloom', base.bloom)),
            field('Bloom color', inp('bloomColor', base.bloomColor, 'color')),
            // "Automatic" shows what the app would pick, so people know what they're overriding.
            field('Flower shape (3D)', sel('flower', base.flower, [['', `Automatic: ${FLOWERS[guessFlower({ ...base, flower: '' })].label}`], ...Object.entries(FLOWERS).map(([k, v]) => [k, v.label])]), 'full'),
            field('Height now (ft)', inp('h', base.h, 'number', { step: 'any', min: '0.2' })),
            field('Width now (ft)', inp('w', base.w || '', 'number', { step: 'any', min: '0' })),
            field('Mature height (ft)', inp('matureH', base.matureH || '', 'number', { step: 'any', min: '0' })),
            field('Mature width (ft)', inp('matureW', base.matureW || '', 'number', { step: 'any', min: '0' })),
            field('How many plants', inp('count', base.count, 'number', { step: '1', min: '1' })),
            field('Patch radius (ft)', inp('r', base.r, 'number', { step: 'any', min: '0.3' })),
            field('Notes', h('textarea', { name: 'notes', id: 'f-notes', text: base.notes }), 'full'),
        );
        // Growing needs. Blank means "use the plant library's values for this species".
        const lib = libMatch(base);
        const checks = (name, table, chosen) => h('div', { class: 'checks' }, Object.entries(table).map(([k, label]) => {
            const box = h('input', { type: 'checkbox', name, value: k });
            box.checked = chosen.includes(k);
            return h('label', { class: 'check' }, box, label);
        }));
        const ZONE_OPTS = [['', '—'], ...Array.from({ length: 13 }, (_, i) => [i + 1, String(i + 1)])];
        f.append(h('details', { open: !lib && !base.sun.length }, h('summary', { text: 'Light, water, zones and wildlife' }),
            h('div', { class: 'form' },
                lib ? h('p', { class: 'note full', text: 'Leave these blank to use the plant library’s values for this species.' }) : null,
                field('Light it likes', checks('sun', SUN, base.sun), 'full'),
                field('Water', sel('water', base.water, [['', lib && lib.water ? `From library: ${WATER[lib.water]}` : '—'], ...Object.entries(WATER)])),
                field('Hardy in zones (coldest / warmest)', h('div', { class: 'pair' }, sel('zoneA', base.zones ? base.zones[0] : '', ZONE_OPTS), sel('zoneB', base.zones ? base.zones[1] : '', ZONE_OPTS))),
                field('Wildlife it supports', checks('tags', TAGS, base.tags), 'full'))));
        f.append(h('details', {}, h('summary', { text: 'Leaves, fruit, colors and more' }),
            h('div', { class: 'form' },
                field('Leaves from / to', rangePair('leaf', base.leaf)),
                field('Leaf color', inp('foliage', base.foliage, 'color')),
                field('Fall color', inp('fall', base.fall || '#c98a32', 'color')),
                field('Second bloom color', inp('bloomColor2', base.bloomColor2 || base.bloomColor, 'color')),
                field('Fruit from / to', rangePair('fruit', base.fruit)),
                field('Fruit color', inp('fruitColor', base.fruitColor, 'color')),
                field('Seed heads from / to', rangePair('seed', base.seed)),
                field('Flower size (inches, blank = usual)', inp('flowerSize', base.flowerSize || '', 'number', { step: 'any', min: '0' })),
                field('Tree / shrub shape', sel('crown', base.crown, [['', `Automatic: ${CROWNS[guessCrown({ ...base, crown: '' })]}`], ...Object.entries(CROWNS)])),
                field('Patch depth N–S (ft, blank = round)', inp('rz', base.rz || '', 'number', { step: 'any', min: '0' })),
                field('Vine run on fence (ft)', inp('len', base.len, 'number', { step: 'any', min: '1' })),
                field('Vine direction (°)', inp('rot', base.rot, 'number', { step: 'any' })),
                field('Planted', inp('planted', base.planted, 'text', { placeholder: 'e.g. Nov 2026' })),
                field('Source', inp('source', base.source, 'text', { placeholder: 'nursery, seed swap…' })),
                field('Wildlife value', h('textarea', { name: 'wildlife', id: 'f-wildlife', text: base.wildlife }), 'full'))));
    } else if (kind === 'features') {
        const typeSel = sel('type', base.type, Object.entries(FTYPES));
        // A new feature's sizes start from its type's defaults (a house is bigger than a pot).
        if (mode === 'new') typeSel.addEventListener('change', () => { S.form = { mode: 'new', kind, prefill: { type: typeSel.value, name: f.querySelector('#f-name').value } }; renderForm(); });
        const t = base.type;
        const sized = ['pond', 'boulder', 'pot', 'deck', ...BUILDING].includes(t), long = ['fence', 'wall', 'hedge', 'brushpile', 'bench'].includes(t);
        f.append(
            field('Kind', typeSel),
            field('Status', sel('status', base.status, Object.entries(STATUS).filter(([s]) => s !== 'new'))),
            field(BUILDING.includes(t) || ['wall', 'hedge', 'deck', 'boulder', 'pot'].includes(t) ? 'Height (ft)' : 'Mounting height (ft)', inp('y', base.y || '', 'number', { step: 'any', min: '0' })),
            ['feeder', 'nestbox'].includes(t) ? field('On a tree', sel('onTree', base.onTree ? '1' : '0', [['0', 'No (pole or ground)'], ['1', 'Yes']])) : null,
            field('Notes', h('textarea', { name: 'notes', id: 'f-notes', text: base.notes }), 'full'),
            h('details', { open: sized || long }, h('summary', { text: 'Size and direction' }),
                h('div', { class: 'form' },
                    field('Width, east–west (ft)', inp('w', base.w, 'number', { step: 'any', min: '0.5' })),
                    field('Depth, north–south (ft)', inp('d', base.d || base.w, 'number', { step: 'any', min: '0.5' })),
                    field('Length (ft)', inp('len', base.len, 'number', { step: 'any', min: '1' })),
                    t === 'pond' ? field('Stream length (ft)', inp('stream', base.stream || '', 'number', { step: 'any', min: '0' })) : null,
                    field('Turn (°)', inp('rot', base.rot, 'number', { step: 'any' })),
                    h('p', { class: 'note full', text: 'Turn: 0 lines a building, fence, wall or hedge up east–west; 90 turns it north–south. For a pond, it’s the compass direction its stream runs (0 = north, 90 = east). Width and depth are measured before turning.' }))));
    } else {
        f.append(
            field('Shape', sel('shape', base.shape, Object.entries(SHAPES)), 'full'),
            field('Surface', sel('surface', base.surface, Object.entries(SURFACES))),
            field('Raised bed height (ft, 0 = flush)', inp('raised', base.raised || '', 'number', { step: 'any', min: '0', max: '6' })),
            field('Width, east–west (ft)', inp('w', base.w, 'number', { step: 'any', min: '1' })),
            field('Depth, north–south (ft)', inp('d', base.d, 'number', { step: 'any', min: '1' })),
            field('Radius if circle (ft)', inp('r', base.r, 'number', { step: 'any', min: '0.5' })),
            field('Color', inp('color', base.color, 'color')),
            base.shape === 'poly' ? h('p', { class: 'note full', text: 'Freeform: turn on Edit layout, select this bed, and drag its gold corners. Double-click an edge to add a corner, or a corner to remove it.' }) : null,
            field('Notes', h('textarea', { name: 'notes', id: 'f-notes', text: base.notes }), 'full'));
    }
    if (mode === 'edit') {
        f.append(field('Position x (ft east)', inp('x', base.x, 'number', { step: 'any' })), field('Position z (ft south)', inp('z', base.z, 'number', { step: 'any' })));
    }

    const close = () => { S.form = null; scheduleUI(); };
    f.append(h('div', { class: 'actions full' },
        h('button', { class: 'btn primary', type: 'submit', text: mode === 'new' ? 'Add to garden' : 'Save' }),
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close })));
    f.addEventListener('submit', (ev) => { ev.preventDefault(); submitForm(new FormData(f), base); });

    box.replaceChildren(
        h('div', { class: 'dh' },
            h('div', {}, h('div', { class: 'eyebrow', text: mode === 'new' ? 'New entry' : 'Edit' }), h('h2', { text: mode === 'new' ? 'Add to the garden' : displayName(base) })),
            h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: close, text: '×' })),
        mode === 'new' ? h('p', { class: 'prose muted', text: 'It lands in the middle of your view. Then drag it into place (Edit layout turns on by itself).' }) : null,
        f);
    const first = box.querySelector('#f-name');
    if (first && mode === 'new' && !base.name) first.focus();
}

/* Read the form, clean the result, show it and save it. */
function submitForm(fd, base) {
    const { mode, kind } = S.form;
    const raw = { ...toDoc(base) };            // start from everything the item already had (photo, members…)
    const g = (k) => fd.get(k);
    const n = (k, d) => (g(k) === '' || g(k) === null ? d : Number(g(k)));
    raw.name = String(g('name') || '').trim() || base.name || 'Unnamed';
    if (fd.has('notes')) raw.notes = String(g('notes') || '');
    if (kind === 'plants') {
        Object.assign(raw, {
            sci: String(g('sci') || '').trim(), form: g('form'), status: g('status'), native: g('native'),
            bloom: readRange(fd, 'bloom'), bloomColor: g('bloomColor'),
            h: n('h', base.h), w: n('w', 0), matureH: n('matureH', 0), matureW: n('matureW', 0), count: n('count', 1),
            r: n('r', base.r), rz: n('rz', 0),
            leaf: readRange(fd, 'leaf'), foliage: g('foliage'), fall: g('fall'),
            fruit: readRange(fd, 'fruit'), fruitColor: g('fruitColor'), seed: readRange(fd, 'seed'),
            len: n('len', base.len), rot: n('rot', 0),
            flower: g('flower') || '', flowerSize: n('flowerSize', 0), crown: g('crown') || '',
            sun: fd.getAll('sun'), tags: fd.getAll('tags'), water: g('water') || '',
            zones: g('zoneA') && g('zoneB') ? [Number(g('zoneA')), Number(g('zoneB'))].sort((a, b) => a - b) : null,
            planted: String(g('planted') || ''), source: String(g('source') || ''), wildlife: String(g('wildlife') || ''),
        });
        const c2 = g('bloomColor2');
        raw.bloomColor2 = c2 && c2 !== raw.bloomColor ? c2 : '';
    } else if (kind === 'features') {
        Object.assign(raw, {
            type: g('type'), status: g('status'), y: n('y', 0), onTree: g('onTree') === '1',
            w: n('w', base.w), d: n('d', 0), stream: n('stream', 0), len: n('len', base.len), rot: n('rot', 0),
        });
        if (raw.type === 'nestbox' && !raw.y) raw.y = 6;
    } else {
        Object.assign(raw, {
            shape: g('shape'), surface: g('surface'), raised: n('raised', 0), color: g('color'),
            w: n('w', base.w), d: n('d', base.d), r: n('r', base.r),
        });
        // Switching to freeform starts from the rectangle; changing size keeps the corners in proportion.
        if (raw.shape === 'poly' && base.shape === 'poly' && (raw.w !== base.w || raw.d !== base.d)) {
            raw.points = base.points.map(p => ({ x: p.x * raw.w / base.w, z: p.z * raw.d / base.d }));
        }
    }

    let id = base.id;
    if (mode === 'edit') {
        raw.x = n('x', base.x);
        raw.z = n('z', base.z);
    } else {
        id = newId(raw.name);
        Object.assign(raw, viewCenter());
    }
    const it = CLEAN[kind](id, raw);
    upsertItem(kind, id, toDoc(it), { force: true });
    Store.saveItem(S.items[kind].get(id));
    S.form = null;
    select(`${kind}:${id}`, { fly: mode === 'new' });
    if (mode === 'new' && !S.edit) toggleEdit(true);
    toast(mode === 'new' ? `Added ${raw.name}. Drag it into place.` : 'Saved.');
}
