/*
 * flora/geometry.js
 * ---------------------------------------------------------------------------
 * The 3D shapes that plants are assembled from: petals, leaves, grass blades,
 * leaf cards, and complete flower heads of each type in shapes.js.
 *
 * Each shape is built once (the first time it's asked for) and cached. Every
 * plant then reuses it many times through InstancedMesh, which draws hundreds
 * of copies in one go, each with its own position, turn and size.
 *
 * Conventions, so the builders in plants.js know how to place things:
 *   - Flower heads face up (+Y) with their base at the origin. Round heads
 *     are 1 unit across, so scaling by the flower size in feet gives the real
 *     size. Tall heads (spike, bells, plume, grass) are 1 unit TALL instead.
 *   - Petals, leaves and blades are drawn along +X (petals, leaves) or +Y
 *     (blades) from the origin, so rotating them positions them around a stem.
 *
 * A head is two pieces: `petals` (bloom-colored) and `center` (the middle,
 * a stalk, or nothing), drawn as two meshes so each gets its own color.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rngFor } from '../util.js';

const cache = new Map();
function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
}

/* mergeGeometries needs every piece to have the same attributes; keep just position and normal. */
function prep(g) {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
}
function merge(list) {
    if (!list.length) return null;
    const g = mergeGeometries(list.map(prep));
    g.computeBoundingSphere();
    return g;
}

/*
 * sheet(): a curved strip, the basis of petals and leaves. It runs along +X
 * for `length`, `width` wide at its widest point (`tip` = how far along that
 * is, 0–1). Shaping:
 *   cup    edges curl up (a spoon)
 *   fold   creased along the middle (a V, like many leaves)
 *   arch   bows up in the middle
 *   droop  tip bends down
 */
function sheet({ length = 1, width = 0.3, tip = 0.55, cup = 0, fold = 0, arch = 0, droop = 0, base = 0.08, segL = 6, segW = 2 }) {
    const pos = [], idx = [];
    for (let i = 0; i <= segL; i++) {
        const u = i / segL;
        const s = u < tip ? (u / tip) * 0.5 : 0.5 + ((u - tip) / (1 - tip)) * 0.5;
        const w = width * Math.max(base, Math.pow(Math.sin(Math.PI * s), 0.75));
        for (let j = 0; j <= segW; j++) {
            const v = (j / segW) * 2 - 1;
            const y = cup * v * v * w * 0.6 + fold * Math.abs(v) * w * 0.35 + arch * (u - u * u) * length - droop * u * u * length;
            pos.push(u * length, y, (v * w) / 2);
        }
    }
    for (let i = 0; i < segL; i++) {
        for (let j = 0; j < segW; j++) {
            const a = i * (segW + 1) + j, b = a + segW + 1;
            idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

/*
 * n petals arranged around the vertical axis, starting r0 out from the
 * middle. tilt lifts them (positive) or lets them hang (negative).
 */
function radial({ n, length, width, tip = 0.55, cup = 0, droop = 0, tilt = 0, r0 = 0.06, y = 0, twist = 0 }) {
    const parts = [];
    for (let i = 0; i < n; i++) {
        const g = sheet({ length, width, tip, cup, droop });
        g.translate(r0, 0, 0);
        g.rotateZ(tilt);
        g.rotateY((i / n) * Math.PI * 2 + twist);
        g.translate(0, y, 0);
        parts.push(g);
    }
    return parts;
}

/* Many tiny florets (little 8-sided gems) at the given points. */
function florets(points, size, stretch = 1) {
    return points.map(([x, y, z, s = 1]) => {
        const g = new THREE.OctahedronGeometry(size * s, 0);
        g.scale(1, stretch, 1);
        g.translate(x, y, z);
        return g;
    });
}

/* A thin cylinder from point a to point b (stalks, pedicels, tubes). */
function rod(a, b, r0, r1 = r0, open = false, segs = 5) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B) || 0.001;
    const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, open);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.applyQuaternion(q);
    g.translate(A.x, A.y, A.z);
    return g;
}

/* A dome (or cap, or flat disc) of points, for clustered flowers. */
function domePoints(rnd, n, radius, height, minY = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius;
        const y = minY + height * Math.sqrt(Math.max(0, 1 - (d * d) / (radius * radius)));
        pts.push([Math.cos(a) * d, y, Math.sin(a) * d]);
    }
    return pts;
}

/* ---------- flower heads ---------- */

const BUILD = {
    daisy() {
        const petals = radial({ n: 16, length: 0.4, width: 0.1, tip: 0.6, droop: 0.08, tilt: 0.06, r0: 0.08 });
        const c = new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        c.scale(1, 0.55, 1);
        return { petals: merge(petals), center: merge([c]) };
    },
    cone() {
        const petals = radial({ n: 14, length: 0.38, width: 0.09, tip: 0.6, droop: 0.25, tilt: -0.45, r0: 0.11, y: 0.03 });
        const c = new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        c.scale(1, 1.25, 1);
        return { petals: merge(petals), center: merge([c]) };
    },
    column() {
        const petals = radial({ n: 6, length: 0.32, width: 0.14, tip: 0.5, droop: 0.4, tilt: -0.9, r0: 0.07, y: 0.05 });
        const c = new THREE.CylinderGeometry(0.07, 0.085, 0.42, 10);
        c.translate(0, 0.24, 0);
        const top = new THREE.SphereGeometry(0.07, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
        top.translate(0, 0.45, 0);
        return { petals: merge(petals), center: merge([c, top]) };
    },
    cup() {
        const petals = [
            ...radial({ n: 5, length: 0.42, width: 0.42, tip: 0.65, cup: 0.5, tilt: 0.65, r0: 0.03 }),
        ];
        const c = new THREE.SphereGeometry(0.06, 8, 5);
        c.translate(0, 0.05, 0);
        return { petals: merge(petals), center: merge([c]) };
    },
    star() {
        const petals = radial({ n: 5, length: 0.45, width: 0.22, tip: 0.5, cup: 0.1, tilt: 0.12, r0: 0.04 });
        const c = new THREE.SphereGeometry(0.05, 8, 4);
        return { petals: merge(petals), center: merge([c]) };
    },
    blossom() {
        const petals = radial({ n: 5, length: 0.45, width: 0.4, tip: 0.6, cup: 0.35, tilt: 0.35, r0: 0.04 });
        const c = new THREE.SphereGeometry(0.07, 6, 4);
        return { petals: merge(petals), center: merge([c]) };
    },
    bract() {
        const petals = radial({ n: 4, length: 0.45, width: 0.34, tip: 0.6, cup: 0.15, tilt: 0.1, r0: 0.05 });
        const rnd = rngFor('bract');
        return { petals: merge(petals), center: merge(florets(domePoints(rnd, 10, 0.07, 0.05), 0.025)) };
    },
    iris() {
        const falls = radial({ n: 3, length: 0.5, width: 0.36, tip: 0.6, cup: 0.15, droop: 0.55, tilt: 0.25, r0: 0.04, y: 0.1 });
        const standards = radial({ n: 3, length: 0.45, width: 0.3, tip: 0.55, cup: 0.7, tilt: 1.25, r0: 0.03, y: 0.1, twist: Math.PI / 3 });
        const stem = rod([0, -0.1, 0], [0, 0.12, 0], 0.03);
        return { petals: merge([...falls, ...standards]), center: merge([stem]) };
    },
    cluster() {
        const rnd = rngFor('cluster');
        const pts = domePoints(rnd, 34, 0.45, 0.22, 0.02);
        const stalks = pts.filter((_, i) => i % 3 === 0).map(([x, y, z]) => rod([0, 0, 0], [x * 0.9, y * 0.9, z * 0.9], 0.012));
        return { petals: merge(florets(pts, 0.085)), center: merge(stalks) };
    },
    flat() {
        const rnd = rngFor('flat');
        const pts = domePoints(rnd, 46, 0.48, 0.06, 0.08);
        const stalks = [];
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            stalks.push(rod([0, 0, 0], [Math.cos(a) * 0.3, 0.08, Math.sin(a) * 0.3], 0.012));
        }
        return { petals: merge(florets(pts, 0.065)), center: merge(stalks) };
    },
    globe() {
        const rnd = rngFor('globe');
        const pts = [];
        for (let i = 0; i < 70; i++) {
            const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
            pts.push([Math.cos(a) * s * 0.42, 0.45 + u * 0.42, Math.sin(a) * s * 0.42, 0.8 + rnd() * 0.4]);
        }
        const core = new THREE.SphereGeometry(0.34, 10, 8);
        core.translate(0, 0.45, 0);
        return { petals: merge(florets(pts, 0.07, 1.6)), center: merge([core]) };
    },
    pompom() {
        const rnd = rngFor('pompom');
        const tubes = [];
        for (let i = 0; i < 26; i++) {
            const u = 0.15 + rnd() * 0.85, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
            const d = [Math.cos(a) * s, u * 0.8, Math.sin(a) * s];
            tubes.push(rod([d[0] * 0.12, 0.1 + d[1] * 0.12, d[2] * 0.12], [d[0] * 0.48, 0.1 + d[1] * 0.48, d[2] * 0.48], 0.03, 0.018));
        }
        const core = new THREE.SphereGeometry(0.15, 10, 8);
        core.translate(0, 0.1, 0);
        return { petals: merge(tubes), center: merge([core]) };
    },
    spike() {
        // A column of florets, 1 unit tall, thickest near the bottom.
        const rnd = rngFor('spike');
        const pts = [];
        for (let i = 0; i < 70; i++) {
            const t = i / 70, a = i * 2.4 + rnd() * 0.5, r = 0.07 * (1 - t * 0.6) + 0.015;
            pts.push([Math.cos(a) * r, 0.05 + t * 0.93, Math.sin(a) * r, 1 - t * 0.35]);
        }
        return { petals: merge(florets(pts, 0.032, 1.3)), center: merge([rod([0, 0, 0], [0, 1, 0], 0.012, 0.006)]) };
    },
    bells() {
        // Bells hanging off a stalk, alternating sides, smaller toward the top.
        const parts = [];
        for (let i = 0; i < 12; i++) {
            const t = i / 12, a = i * 2.2, s = 1 - t * 0.45;
            const out = [Math.cos(a), Math.sin(a)];
            const bell = new THREE.CylinderGeometry(0.055 * s, 0.022 * s, 0.11 * s, 7, 1, true);
            bell.translate(0, -0.055 * s, 0);
            bell.rotateZ(-0.9);
            bell.rotateY(-a);
            bell.translate(out[0] * 0.05, 0.12 + t * 0.85, out[1] * 0.05);
            parts.push(bell);
        }
        return { petals: merge(parts), center: merge([rod([0, 0, 0], [0, 1, 0], 0.012, 0.007)]) };
    },
    tube() {
        // A whorl of trumpets pointing outward and down.
        const parts = [];
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            const t = new THREE.CylinderGeometry(0.075, 0.03, 0.48, 7, 1, true);
            t.translate(0, 0.24, 0);
            t.rotateZ(-1.75);
            t.rotateY(a);
            parts.push(t);
        }
        return { petals: merge(parts), center: merge([new THREE.SphereGeometry(0.06, 6, 4)]) };
    },
    plume() {
        // Arching sprays of tiny florets (goldenrod), about 1 unit tall.
        const rnd = rngFor('plume');
        const pts = [], stalks = [];
        for (let b = 0; b < 7; b++) {
            const a = (b / 7) * Math.PI * 2 + rnd(), y0 = 0.25 + b * 0.09, reach = 0.32 + rnd() * 0.12;
            let prev = [0, y0, 0];
            for (let k = 1; k <= 9; k++) {
                const t = k / 9, r = reach * t, y = y0 + Math.sin(t * Math.PI * 0.8) * 0.3 - t * t * 0.18;
                const p = [Math.cos(a) * r, y, Math.sin(a) * r];
                stalks.push(rod(prev, p, 0.008));
                prev = p;
                pts.push([p[0], p[1] + 0.02, p[2]], [p[0] + 0.02, p[1] + 0.04, p[2] - 0.015]);
            }
        }
        stalks.push(rod([0, 0, 0], [0, 0.9, 0], 0.012, 0.007));
        return { petals: merge(florets(pts, 0.028)), center: merge(stalks) };
    },
    grass() {
        // A loose grass panicle: a stalk with short branches of seed-like spikelets, 1 unit tall.
        const rnd = rngFor('grassplume');
        const pts = [], stalks = [rod([0, 0, 0], [0, 1, 0], 0.008, 0.004)];
        for (let b = 0; b < 12; b++) {
            const y0 = 0.2 + (b / 12) * 0.75, a = b * 2.5, len = 0.16 * (1 - b / 14) + 0.04;
            const end = [Math.cos(a) * len, y0 + len * 0.9, Math.sin(a) * len];
            stalks.push(rod([0, y0, 0], end, 0.004));
            for (let k = 1; k <= 3; k++) {
                const t = k / 3;
                pts.push([end[0] * t, y0 + (end[1] - y0) * t, end[2] * t, 0.8 + rnd() * 0.4]);
            }
        }
        return { petals: merge(florets(pts, 0.022, 2.2)), center: merge(stalks) };
    },
    catkin() {
        // Dangling strands (oak and walnut flowers).
        const parts = [];
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            parts.push(rod([Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], [Math.cos(a) * 0.14, -0.9, Math.sin(a) * 0.14], 0.035, 0.02));
        }
        return { petals: merge(parts), center: null };
    },
    none() {
        return { petals: null, center: null };
    },
};

/* The two geometries for a flower type: { petals, center }. */
export function headGeometry(type) {
    return cached(`head:${type}`, () => (BUILD[type] || BUILD.daisy)());
}

/* Tall head types are measured by length; the rest by width. */
export const TALL_HEADS = new Set(['spike', 'bells', 'plume', 'grass', 'catkin']);

/* ---------- leaves, blades, stems, cards ---------- */

/* A single leaf, 1 unit long along +X, gently arched and folded. */
export function leafGeometry(kind = 'oval') {
    return cached(`leaf:${kind}`, () => {
        if (kind === 'lance') return sheet({ length: 1, width: 0.26, tip: 0.35, fold: 0.5, arch: 0.18, droop: 0.28, segL: 6, segW: 2 });
        if (kind === 'round') return sheet({ length: 1, width: 0.75, tip: 0.5, fold: 0.25, arch: 0.1, droop: 0.15, segL: 5, segW: 2 });
        return sheet({ length: 1, width: 0.46, tip: 0.45, fold: 0.4, arch: 0.15, droop: 0.22, segL: 6, segW: 2 });
    });
}

/*
 * A grass blade (or iris/yucca sword leaf). Built 1 unit tall and 1 unit
 * wide at the base, curving toward +Z. Scale x for width and y/z for height.
 */
export function bladeGeometry(stiff = false) {
    return cached(`blade:${stiff}`, () => {
        const segs = stiff ? 3 : 6, pos = [], idx = [];
        for (let i = 0; i <= segs; i++) {
            const t = i / segs, w = 0.5 * Math.pow(1 - t, stiff ? 0.6 : 0.85) + 0.01;
            const z = (stiff ? 0.06 : 0.32) * t * t;
            pos.push(-w, t, z, w, t, z);
        }
        for (let i = 0; i < segs; i++) {
            const a = i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
    });
}

/* A leaf card: a 1×1 square (with texture coordinates for the leaf picture). */
export function cardGeometry() {
    return cached('card', () => new THREE.PlaneGeometry(1, 1));
}

/* Stems and branches: a slightly tapered 7-sided tube, 1 unit tall with its base at the origin. */
export function stemGeometry() {
    return cached('stem', () => new THREE.CylinderGeometry(0.72, 1, 1, 7, 1).translate(0, 0.5, 0));
}

/* A smooth ball (berries, cactus pads, seed heads). */
export function ballGeometry() {
    return cached('ball', () => new THREE.SphereGeometry(1, 10, 7));
}
