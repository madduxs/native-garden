/*
 * garden.js
 * ---------------------------------------------------------------------------
 * Keeps the 3D scene in step with the garden's data.
 *
 *   S.items      the data: Maps of plants, features and zones (state.js)
 *   recs         the 3D side: one record per item (builders.js makeRec)
 *
 * When data arrives or changes, call upsertItem() / removeItem() (or
 * syncItems() with a whole list) and the 3D model is built or rebuilt.
 * This module also handles the seasons (setMonth), growth over the years
 * (setYears), what's visible (planned items, mature-size shells), and selection.
 * The plant models themselves, and how they change through the year, live in
 * flora/plants.js.
 *
 * Saving is NOT done here; that's store/index.js. Typical flow:
 *   form submit → upsertItem() so the change shows instantly
 *              → Store.saveItem() to save it
 *              → the database echoes the change back → syncItems() sees
 *                nothing new and skips the rebuild.
 */
import { CSS2DObject, itemsRoot, zonesRoot, buildGround, seasonGround, requestRender, flyToRec } from './scene.js';
import { makeRec, buildFeature, buildZone, disposeRec, circleLine } from './builders.js';
import { buildPlant, seasonPlant, growPlant } from './flora/plants.js';
import { S, scheduleUI, emptyItems } from './state.js';
import { KINDS, CLEAN, toDoc, cleanMeta, inZone } from './model.js';
import { h } from './util.js';

/* "kind:id" → render record */
export const recs = new Map();

/* "Purple coneflower #2" */
export function displayName(it) { return it.tag ? `${it.name} ${it.tag}` : it.name; }

/* ---------- building and removing items ---------- */

/* Build the 3D record for an item and add it to the scene. */
function buildRec(kind, it) {
    const rec = makeRec(kind, it);
    if (kind === 'plants') buildPlant(rec);
    else if (kind === 'features') buildFeature(rec);
    else buildZone(rec);
    rec.group.position.set(it.x, 0, it.z);

    // Planned items are drawn see-through with a dashed blue ring.
    if (it.status === 'planned') {
        const ghostMat = rec.ghost?.children?.[0]?.material;
        for (const m of rec.mats) {
            if (m === ghostMat) continue;
            if (m.isMeshStandardMaterial) { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; }
        }
        rec.body.traverse(o => { o.castShadow = false; });
        const ring = circleLine(Math.max(1, rec.footR * 0.8), '#245a78', 0.9, true);
        ring.position.y = 0.07;
        rec.group.add(ring);
        rec.mats.push(ring.material);
    }

    // The floating name label (an HTML element positioned by CSS2DRenderer).
    const planned = it.status === 'planned';
    const cls = kind === 'zones' ? 'lbl zone' : 'lbl' + (planned ? ' planned' : '');
    const text = (planned ? 'Planned: ' : '') + displayName(it) + (it.count > 1 ? ` ×${it.count}` : '');
    const label = new CSS2DObject(h('div', { class: cls, text }));
    label.center.set(0.5, 1);     // anchor at the label's bottom middle
    label.position.set(0, rec.labelY, rec.labelZ || 0);   // beds set labelZ: just inside their north edge
    rec.group.add(label);
    rec.label = label;

    (kind === 'zones' ? zonesRoot : itemsRoot).add(rec.group);
    applyVisibility(rec);
    if (kind === 'plants') {
        seasonPlant(rec, S.month);
        growPlant(rec, S.years);
        rec.body.position.y = (it.y || 0) + groundAt(it.x, it.z);
    }
    return rec;
}

/*
 * Add or update an item from raw data. The data is cleaned first. If nothing
 * actually changed, nothing is rebuilt (rebuilding is the slow part).
 * `force` rebuilds even while the item is being dragged.
 */
export function upsertItem(kind, id, raw, { force = false } = {}) {
    if (!CLEAN[kind] || typeof id !== 'string') return;
    const it = CLEAN[kind](id, raw || {});
    const key = `${kind}:${id}`;
    if (S.dragKey === key && !force) return;          // don't yank an item out from under the mouse
    const prev = S.items[kind].get(id);
    if (prev && sameItem(prev, it) && recs.has(key)) return;
    S.items[kind].set(id, it);
    S.rev++;
    const old = recs.get(key);
    if (old) disposeRec(old);
    recs.set(key, buildRec(kind, it));
    if (kind === 'zones') applyGroundLevels();
    if (S.sel === key) refreshSelection();
    scheduleUI();
    requestRender();
}

/*
 * Raised beds lift the plants inside them. groundAt() is the height of the
 * ground at a point: the tallest raised bed it's in, or 0.
 */
export function groundAt(x, z) {
    let top = 0;
    for (const zn of S.items.zones.values()) if (zn.raised > top && inZone(zn, x, z)) top = zn.raised;
    return top;
}

/* Re-seat every plant after a bed was raised, lowered, moved or deleted. */
function applyGroundLevels() {
    for (const rec of recs.values()) {
        if (rec.kind === 'plants') rec.body.position.y = (rec.item.y || 0) + groundAt(rec.item.x, rec.item.z);
    }
}

function sameItem(a, b) { return JSON.stringify(toDoc(a)) === JSON.stringify(toDoc(b)); }

export function removeItem(kind, id) {
    const key = `${kind}:${id}`;
    S.items[kind].delete(id);
    S.rev++;
    const rec = recs.get(key);
    if (rec) { disposeRec(rec); recs.delete(key); }
    if (kind === 'zones') applyGroundLevels();
    if (S.sel === key) { S.sel = null; S.form = null; refreshSelection(); }
    scheduleUI();
    requestRender();
}

/*
 * Make the garden match a complete list of items from the database:
 * add/update everything in the list, remove anything that isn't in it.
 * list: [{ id, kind, ...fields }]
 */
export function syncItems(list) {
    const seen = new Set();
    for (const d of list) {
        if (!KINDS.includes(d.kind)) continue;
        seen.add(`${d.kind}:${d.id}`);
        upsertItem(d.kind, d.id, d);
    }
    for (const kind of KINDS) {
        for (const id of [...S.items[kind].keys()]) {
            if (!seen.has(`${kind}:${id}`)) removeItem(kind, id);
        }
    }
}

/* Remove everything (when closing a garden). */
export function clearItems() {
    for (const rec of recs.values()) disposeRec(rec);
    recs.clear();
    S.items = emptyItems();
    S.rev++;
    S.sel = null;
    S.form = null;
    selRing.parent?.remove(selRing);
    requestRender();
}

/* Apply a garden's settings: name, outline, location. */
export function applyMeta(raw) {
    S.meta = cleanMeta(raw);
    S.rev++;
    document.title = `${S.meta.name} · Native Garden`;
    buildGround();
    applySeason();
    scheduleUI();
}

/* ---------- seasons and growth ---------- */

export function applySeason() {
    seasonGround(S.month);
    for (const rec of recs.values()) if (rec.kind === 'plants') seasonPlant(rec, S.month);
    requestRender();
}

/* Change the month (wraps: 13 → 1, 0 → 12). */
export function setMonth(m) {
    S.month = ((m - 1 + 12) % 12) + 1;
    applySeason();
    scheduleUI();
}

/* Show the garden `years` from now: trees and shrubs grow toward their mature size. */
export function setYears(years) {
    S.years = years;
    for (const rec of recs.values()) if (rec.kind === 'plants') growPlant(rec, years);
    refreshSelection();
    scheduleUI();
}

/* ---------- visibility ---------- */

export function applyVisibility(rec) {
    rec.group.visible = S.planned || rec.item.status !== 'planned';
    if (rec.ghost) rec.ghost.visible = S.mature;
}

export function applyAllVisibility() {
    for (const rec of recs.values()) applyVisibility(rec);
    requestRender();
}

/* ---------- selection ---------- */

/* The gold ring under the selected item. */
const selRing = circleLine(1, '#a8740f', 1, false);
selRing.position.y = 0.1;

/* Highlight the selected item's label and ring (or bed outline). */
export function refreshSelection() {
    for (const rec of recs.values()) {
        const on = rec.key === S.sel;
        rec.label?.element.classList.toggle('sel', on);
        if (rec.kind === 'zones' && rec.parts.outline) rec.parts.outline.material.color.set(on ? '#a8740f' : rec.parts.edgeColor);
    }
    selRing.parent?.remove(selRing);
    const rec = S.sel && recs.get(S.sel);
    if (rec && rec.kind !== 'zones') {
        selRing.scale.setScalar(Math.max(1, rec.footR * (rec.grow ? rec.grow.sx : 1) + 0.4));
        rec.group.add(selRing);
    }
    requestRender();
}

/*
 * Select an item by key ("plants:abc") or pass null to clear. With fly: true
 * the camera glides over to it. Selecting closes any open form and library entry.
 */
export function select(key, { fly = false } = {}) {
    if (key !== S.sel) S.form = null;
    S.sel = key || null;
    S.libSel = null;
    refreshSelection();
    const rec = key && recs.get(key);
    if (rec && fly) flyToRec(rec);
    scheduleUI();
}

export function getRec(key) { return recs.get(key) || null; }
