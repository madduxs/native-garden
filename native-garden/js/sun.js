/*
 * sun.js
 * ---------------------------------------------------------------------------
 * Where the sun is, and how many hours of direct sun each part of the
 * garden gets.
 *
 *   sunHoursAt(x, z, month, skipId)  hours of direct sun at one spot on an average day
 *   sunHoursGrid(month)              the same for the whole garden, on a grid
 *   setSunMap(on) / refreshSunMap()  the colored overlay on the ground
 *
 * How it works: for each spot and each half hour from sunrise to sunset, we
 * shoot an imaginary ray from the ground toward the sun and see whether it
 * hits anything that casts shade:
 *   - buildings, walls, hedges, fences: boxes (some, like pergolas, only partly block)
 *   - trees and large shrubs: egg-shaped canopies; bare winter branches block much less
 * Only these simple shapes are tested (not every leaf), so it's quick enough
 * to redo whenever something moves.
 *
 * (Where the sun is in the sky comes from sunpath.js.)
 *
 * Coordinates as everywhere in the app: feet, x east, z south, y up.
 */
import * as THREE from 'three';
import { S, scheduleUI } from './state.js';
import { scene, requestRender, bounds, insideOutline } from './scene.js';
import { inRange } from './util.js';
import { sunDirection } from './sunpath.js';
import { guessCrown } from './flora/shapes.js';
import { growthScale } from './flora/plants.js';

const RAD = Math.PI / 180;

/* The latitude used when a garden has no location yet (middle of the US). */
export function gardenLat() {
    return S.meta?.place?.lat ?? 36;
}

/* The sun's direction every half hour while it's more than 2° up. */
function daySteps(lat, month) {
    const steps = [];
    for (let h = 4; h <= 20; h += 0.5) {
        const d = sunDirection(lat, month, h);
        if (d.elevation > 2) steps.push(d);
    }
    return steps;
}

/* ---------- what casts shade ---------- */

/*
 * Turn the garden's features and woody plants into simple shapes:
 *   { kind: 'box', x, z, rot, hx, hz, y0, y1, block }   a (turned) box
 *   { kind: 'egg', x, y, z, rx, ry, block }              an ellipsoid canopy
 * `block` is how much light it stops (1 = all).
 */
const BOXES = {
    // type: (feature) => [half width, half depth, bottom, top, how much light it blocks]
    house: (f) => [f.w / 2, (f.d || f.w * 0.75) / 2, 0, (f.y || 10) + Math.min((f.d || f.w) * 0.3, 9) * 0.6, 1],
    garage: (f) => BOXES.house(f),
    shed: (f) => BOXES.house(f),
    greenhouse: (f) => [f.w / 2, (f.d || 8) / 2, 0, (f.y || 8) + 1.5, 0.3],
    pergola: (f) => [f.w / 2, (f.d || f.w) / 2, (f.y || 9) - 0.6, (f.y || 9) + 0.5, 0.45],
    gazebo: (f) => [f.w / 2, f.w / 2, f.y || 10, (f.y || 10) + f.w * 0.3 + 1, 1],
    wall: (f) => [f.len / 2, (f.w || 1) / 2, 0, f.y || 4, 1],
    hedge: (f) => [f.len / 2, (f.w || 4) / 2, 0, f.y || 6, 0.9],
    fence: (f) => [f.len / 2, 0.1, 0, 6, 0.35],
    boulder: (f) => [f.w / 2, (f.d || f.w * 0.8) / 2, 0, f.y || 2, 1],
};

function occluders(month, skipId) {
    const list = [];
    for (const f of S.items.features.values()) {
        const shape = BOXES[f.type];
        if (!shape || f.status === 'planned' && !S.planned) continue;
        const [hx, hz, y0, y1, block] = shape(f);
        list.push({ kind: 'box', id: f.id, x: f.x, z: f.z, rot: (f.rot || 0) * RAD, hx, hz, y0, y1, block });
    }
    for (const p of S.items.plants.values()) {
        if (p.id === skipId || !(p.form === 'tree' || p.form === 'shrub') || p.h < 2) continue;
        if (p.status === 'planned' && !S.planned) continue;
        const { sx, sy } = growthScale(p, S.years);
        const H = p.h * sy, W = (p.w || p.h * 0.7) * sx;
        const crown = guessCrown(p);
        let cy, ry, rx = W / 2;
        if (p.form === 'shrub' || crown === 'mound' || crown === 'upright') { cy = H * 0.48; ry = H / 2; }
        else if (crown === 'cone') { cy = H * 0.45; ry = H * 0.5; rx = W * 0.4; }
        else if (crown === 'spreading') { ry = (H * 0.72) * 0.42; cy = H - ry; }
        else { const trunk = H * 0.34; ry = (H - trunk) / 2; cy = trunk + ry; }
        // Bare branches let most light through; leafy canopies very little.
        const leafy = !p.leaf || inRange(month, p.leaf);
        const block = leafy ? (crown === 'cone' ? 0.92 : 0.85) : 0.25;
        const members = p.members && p.members.length ? p.members : [{ x: 0, z: 0 }];
        for (const m of members) list.push({ kind: 'egg', id: p.id, x: p.x + m.x * sx, y: cy, z: p.z + m.z * sx, rx, ry, block });
    }
    return list;
}

/* Does a ray from (ox, oy, oz) toward the sun pass through this shape? */
function hits(o, ox, oz, d, oy) {
    if (o.kind === 'egg') {
        // Squash space so the egg becomes a unit ball, then solve |p + t·d| = 1.
        const px = (ox - o.x) / o.rx, py = (oy - o.y) / o.ry, pz = (oz - o.z) / o.rx;
        const dx = d.x / o.rx, dy = d.y / o.ry, dz = d.z / o.rx;
        const a = dx * dx + dy * dy + dz * dz, b = 2 * (px * dx + py * dy + pz * dz), c = px * px + py * py + pz * pz - 1;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return false;
        return (-b + Math.sqrt(disc)) / (2 * a) > 0;       // the far side is in front of us
    }
    // Box: turn the ray into the box's own frame, then the classic "slab" test.
    const cos = Math.cos(o.rot), sin = Math.sin(o.rot);
    const rx = ox - o.x, rz = oz - o.z;
    const lx = rx * cos - rz * sin, lz = rx * sin + rz * cos;
    const ldx = d.x * cos - d.z * sin, ldz = d.x * sin + d.z * cos;
    let t0 = 0, t1 = Infinity;
    for (const [p, v, lo, hi] of [[lx, ldx, -o.hx, o.hx], [oy, d.y, o.y0, o.y1], [lz, ldz, -o.hz, o.hz]]) {
        if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return false; continue; }
        let a = (lo - p) / v, b = (hi - p) / v;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) return false;
    }
    return true;
}

/*
 * Hours of direct sun at one point, given the day's sun steps and the
 * shade-casting shapes. oy is the height of the point (0.1 = the ground).
 */
function hoursAt(x, z, steps, occ, oy = 0.1) {
    let hours = 0;
    for (const d of steps) {
        let light = 1;
        for (const o of occ) {
            // Each shape in the way takes away its share of what light is left.
            if (hits(o, x, z, d, oy)) {
                light *= 1 - o.block;
                if (light < 0.05) break;
            }
        }
        hours += light * 0.5;
    }
    return hours;
}

/* Hours of direct sun at one spot (skipId: leave out a plant's own canopy). */
export function sunHoursAt(x, z, month, skipId = null, oy = 0.1) {
    return hoursAt(x, z, daySteps(gardenLat(), month), occluders(month, skipId), oy);
}

/*
 * Average hours of direct sun a plant gets: measured where it stands (up to five
 * of a group's plants), at about half its height, leaving out
 * its own canopy. Trees are measured higher up, where their leaves will be.
 */
export function plantSunHours(p, month) {
    const steps = daySteps(gardenLat(), month), occ = occluders(month, p.id);
    const { sy } = growthScale(p, S.years);
    const H = p.h * sy;
    const oy = p.form === 'tree' ? Math.max(0.1, H * 0.6) : Math.max(0.1, H * 0.5);
    const pts = p.members && p.members.length ? p.members.slice(0, 5) : [{ x: 0, z: 0 }];
    let sum = 0;
    for (const m of pts) sum += hoursAt(p.x + m.x, p.z + m.z, steps, occ, oy);
    return sum / pts.length;
}

/* The month that best represents "the growing season" for sun ratings: July (January south of the equator). */
export function summerMonth() {
    return gardenLat() < 0 ? 1 : 7;
}

/* A sun rating from hours: full 6+, part 3–6, shade under 3. */
export function sunLevel(hours) {
    return hours >= 6 ? 'full' : hours >= 3 ? 'part' : 'shade';
}

/*
 * Hours of sun across the garden, on a grid of cells about 2 ft across
 * (bigger cells for big gardens, to keep it quick).
 */
export function sunHoursGrid(month) {
    const b = bounds();
    const cell = Math.max(1, Math.ceil(Math.max(b.w, b.d) / 70));
    const nx = Math.max(2, Math.ceil(b.w / cell)), nz = Math.max(2, Math.ceil(b.d / cell));
    const steps = daySteps(gardenLat(), month), occ = occluders(month, null);
    const hours = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            hours[j * nx + i] = hoursAt(b.minX + (i + 0.5) * cell, b.minZ + (j + 0.5) * cell, steps, occ);
        }
    }
    return { minX: b.minX, minZ: b.minZ, cell, nx, nz, hours, dayLength: steps.length * 0.5 };
}

/* ---------- the overlay ---------- */

/* Color for a number of sun hours: deep blue (shade) → teal → green → yellow → orange (full sun). */
const RAMP = [[0, [40, 60, 140]], [3, [40, 150, 160]], [4.5, [120, 190, 90]], [6, [240, 210, 60]], [9, [240, 130, 40]]];
function rampColor(h) {
    for (let i = 1; i < RAMP.length; i++) {
        if (h <= RAMP[i][0]) {
            const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i];
            const t = (h - h0) / (h1 - h0);
            return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
        }
    }
    return RAMP[RAMP.length - 1][1];
}

let overlay = null, lastKey = '', timer = 0;

/* What the map depends on; when this changes, recompute. */
function mapKey() {
    const items = [...S.items.features.values(), ...S.items.plants.values()]
        .filter(it => it.kind === 'features' || it.form === 'tree' || it.form === 'shrub')
        .map(it => `${it.id}:${it.x}:${it.z}:${it.h ?? it.y}:${it.w}:${it.d}:${it.len}:${it.rot}:${it.status}`).join('|');
    return `${S.month}|${S.years}|${S.planned}|${JSON.stringify(S.meta?.outline)}|${gardenLat()}|${items}`;
}

function buildOverlay() {
    const b = bounds();
    if (!(b.w > 0 && b.d > 0)) return null;
    const grid = sunHoursGrid(S.month);
    const data = new Uint8Array(grid.nx * grid.nz * 4);
    for (let k = 0; k < grid.hours.length; k++) {
        const [r, g, b] = rampColor(grid.hours[k]);
        data.set([r, g, b, 255], k * 4);
    }
    const tex = new THREE.DataTexture(data, grid.nx, grid.nz, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    // The garden's own outline, with texture coordinates running across its bounding box.
    const o = S.meta.outline;
    const geo = new THREE.ShapeGeometry(new THREE.Shape(o.map(p => new THREE.Vector2(p.x, -p.z)))).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
    const W = grid.nx * grid.cell, D = grid.nz * grid.cell;
    for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (pos.getX(i) - grid.minX) / W;
        uv[i * 2 + 1] = (pos.getZ(i) - grid.minZ) / D;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.12;
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    mesh.userData.grid = grid;
    return mesh;
}

function disposeOverlay() {
    if (!overlay) return;
    scene.remove(overlay);
    overlay.geometry.dispose();
    overlay.material.map.dispose();
    overlay.material.dispose();
    overlay = null;
}

/* Recompute the overlay if anything it depends on changed (called after every UI redraw). */
export function refreshSunMap() {
    if (!S.sunMap || !S.meta) { if (overlay) { disposeOverlay(); lastKey = ''; requestRender(); } return; }
    const key = mapKey();
    if (key === lastKey && overlay) return;
    // Wait a moment so dragging or scrubbing months doesn't recompute on every step.
    clearTimeout(timer);
    timer = setTimeout(() => {
        lastKey = key;
        disposeOverlay();
        overlay = buildOverlay();
        if (overlay) scene.add(overlay);
        requestRender();
        scheduleUI();                  // so the legend's summary line updates
    }, overlay ? 250 : 0);
}

export function setSunMap(on) {
    S.sunMap = on;
    refreshSunMap();
}

/*
 * For the legend: what share of the garden (inside its outline) gets full
 * sun, part sun and shade on the map's month, or null before the map is ready.
 */
export function sunSummary() {
    if (!overlay || !S.meta) return null;
    const g = overlay.userData.grid, out = { full: 0, part: 0, shade: 0, cells: 0, dayLength: g.dayLength };
    for (let j = 0; j < g.nz; j++) {
        for (let i = 0; i < g.nx; i++) {
            if (!insideOutline(g.minX + (i + 0.5) * g.cell, g.minZ + (j + 0.5) * g.cell, S.meta.outline)) continue;
            out[sunLevel(g.hours[j * g.nx + i])]++;
            out.cells++;
        }
    }
    return out.cells ? out : null;
}
