/*
 * flora/plants.js
 * ---------------------------------------------------------------------------
 * Builds the 3D model of a plant and changes it through the seasons.
 *
 *   buildPlant(rec)        make the model (called once per plant, by garden.js)
 *   seasonPlant(rec, m)    show the right leaves, flowers, seed heads and fruit for month m
 *   growPlant(rec, years)  grow trees and shrubs toward their mature size
 *
 * How a model is put together
 * ---------------------------
 * A plant is a handful of InstancedMeshes, each drawing one shape many times:
 * stems, leaves, petals, flower centers, fruit, leaf cards. While building, we
 * collect a list of positions (4×4 matrices) and colors for each shape in a
 * Batch, then turn each Batch into one InstancedMesh at the end. A patch of 30
 * coneflowers is ~5 draws, not 30 × 20.
 *
 * Every builder uses rngFor(plant id), so a plant looks the same every visit.
 *
 * Growth forms:
 *   forb / annual   stems with leaves, flower heads on top        buildForb()
 *   grass           clumps of curving blades plus seed stalks      buildGrass()
 *   tree / shrub    branches, leaf-card canopy, blossoms, fruit    buildWoody() / buildConifer() / buildRosette()
 *   vine            leaves and flowers spread along a fence        buildVine()
 *   iris            fans of sword leaves around a ring             buildIris()
 *   cactus          pads, joints or globes                         buildCactus()
 *
 * The parts each builder leaves in rec.parts are what seasonPlant() switches
 * on and off.
 */
import * as THREE from 'three';
import { QUALITY } from '../scene.js';
import { circleLine } from '../builders.js';
import { S } from '../state.js';
import { clamp, mixHex, rngFor, inRange, prevM } from '../util.js';
import { DORMANT, SEED_BROWN } from '../model.js';
import { FLOWERS, guessFlower, guessCrown, flowerSizeFt, centerColor, genusOf } from './shapes.js';
import { headGeometry, TALL_HEADS, leafGeometry, bladeGeometry, cardGeometry, stemGeometry, ballGeometry } from './geometry.js';
import { leafCard } from './textures.js';
import { windify, windDepth } from './wind.js';

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const qAxis = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/* ---------- small helpers ---------- */

/* Collects instances of one shape: their matrices and (slightly varied) colors. */
class Batch {
    constructor() { this.m = []; this.c = []; }
    add(matrix, color) { this.m.push(matrix); this.c.push(color || new THREE.Color(1, 1, 1)); }
    get size() { return this.m.length; }
}

function compose(pos, quat, s) {
    const scale = typeof s === 'number' ? V(s, s, s) : s;
    return new THREE.Matrix4().compose(pos, quat, scale);
}

/* A matrix that stretches the stem shape from point a to point b, radius r. */
function between(a, b, r) {
    const dir = b.clone().sub(a);
    const len = dir.length() || 0.001;
    return compose(a, new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()), V(r, len, r));
}

/* A near-white color for per-instance variation (it multiplies the material color). */
function jitter(rng, amount = 0.12) {
    const b = 1 - amount + rng() * amount * 1.6;
    return new THREE.Color(b * (1 + (rng() - 0.5) * amount * 0.4), b, b * (1 + (rng() - 0.5) * amount * 0.4));
}

/* A random point in an ellipse on the ground. */
function inEllipse(rng, rx, rz) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
    return [Math.cos(a) * rx * d, Math.sin(a) * rz * d];
}

/* A direction that's mostly `dir`, wobbled by up to `amount`. */
function wobble(rng, dir, amount) {
    return dir.clone().add(V((rng() - 0.5) * amount, (rng() - 0.5) * amount * 0.5, (rng() - 0.5) * amount)).normalize();
}

/*
 * A material for plant parts. Options:
 *   wind   sway strength (see flora/wind.js)
 *   map    a leaf-card texture (see-through parts cut out with alphaTest)
 *   double draw both sides (petals, leaves, blades)
 *   glow   a little self-lighting so flowers read from far away
 */
function material(rec, color, { wind = 0, map = null, double = false, glow = 0, rough = 0.78 } = {}) {
    const m = new THREE.MeshStandardMaterial({
        color, roughness: rough, metalness: 0,
        side: double ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (map) { m.map = map; m.alphaTest = 0.5; }
    if (glow) m.emissive = new THREE.Color(color).multiplyScalar(glow);
    if (wind) windify(m, wind);
    m.userData.base = new THREE.Color(color);
    rec.mats.push(m);
    return m;
}

/* Turn a Batch into an InstancedMesh (or null if it's empty). */
function meshFrom(geo, mat, batch, { wind = 0, map = null, shadow = true } = {}) {
    if (!geo || !batch.size) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, batch.size);
    batch.m.forEach((mx, i) => mesh.setMatrixAt(i, mx));
    batch.c.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    if (wind) mesh.customDepthMaterial = windDepth(wind, map);
    mesh.userData.total = batch.size;
    return mesh;
}

/* How many things to draw: phones and older computers get fewer. */
const D = () => QUALITY.density;

/*
 * Flowers and stems drawn true to size nearly vanish when you look at a whole
 * garden on a screen, so they're drawn a bit larger than life. Set these to 1
 * for exact sizes.
 */
const FLOWER_BOOST = 1.45;
const STEM_BOOST = 1.6;

/* ---------- flower heads ---------- */

/*
 * A set of flower heads of one type for one plant. Two bloom colors are
 * split into two batches (alternating), so each can have its own material.
 */
function headSet(it, type) {
    const spec = FLOWERS[type];
    return {
        type, spec,
        size: flowerSizeFt(it, type) * FLOWER_BOOST,
        tall: TALL_HEADS.has(type),
        petals: it.bloomColor2 ? [new Batch(), new Batch()] : [new Batch()],
        center: new Batch(),
        n: 0,
    };
}

/* Add one head at `pos`, facing `dir`. */
function addHead(hs, rng, pos, dir, scale = 1) {
    if (hs.type === 'none' || hs.size <= 0) return;
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    q.multiply(qAxis(UP, rng() * Math.PI * 2));           // spin each head on its own axis
    const s = hs.size * scale * (0.85 + rng() * 0.3);
    const m = compose(pos, q, s);
    hs.petals[hs.n % hs.petals.length].add(m, jitter(rng, 0.1));
    hs.center.add(m, jitter(rng, 0.08));
    hs.n++;
}

/* Build the meshes for a head set and remember them in rec.parts.heads. */
function finishHeads(rec, hs, group, wind) {
    if (!hs.n) return;
    const it = rec.item, geo = headGeometry(hs.type);
    const colors = [it.bloomColor, it.bloomColor2 || it.bloomColor];
    const petals = hs.petals.map((b, k) => {
        const mat = material(rec, colors[k], { wind, double: true, glow: 0.1, rough: 0.6 });
        const mesh = meshFrom(geo.petals, mat, b, { wind });
        if (mesh) group.add(mesh);
        return mesh;
    }).filter(Boolean);
    let center = null;
    if (geo.center) {
        const mat = material(rec, centerColor(it, hs.type), { wind, rough: 0.9 });
        center = meshFrom(geo.center, mat, hs.center, { wind });
        if (center) group.add(center);
    }
    rec.parts.heads.push({ type: hs.type, spec: hs.spec, petals, center });
}

/* ---------- forbs (wildflowers) and annuals ---------- */

/* Narrow leaves for daisies, goldenrods and the like; round for mallows; oval otherwise. */
function leafKindFor(it, type) {
    const g = genusOf(it.sci);
    if (['Liatris', 'Solidago', 'Symphyotrichum', 'Helianthus', 'Asclepias', 'Vernonia', 'Coreopsis', 'Tradescantia', 'Penstemon'].includes(g)) return 'lance';
    if (type === 'cup' || ['Callirhoe', 'Sphaeralcea', 'Ipomoea'].includes(g)) return 'round';
    if (type === 'spike' || type === 'plume' || type === 'daisy') return 'lance';
    return 'oval';
}

function buildForb(rec, rng, group) {
    const it = rec.item, P = rec.parts;
    const type = guessFlower(it);
    const hs = headSet(it, type);
    const rx = it.r, rz = it.rz || it.r;
    const area = Math.PI * rx * rz;
    // About 5 stems per square foot, like a well-established clump.
    const n = Math.round(clamp(area * 5.5 * D(), 5, 90 * D()));
    const stems = new Batch(), leaves = new Batch();
    const leafLen = clamp(it.h * 0.2, 0.18, 0.75);
    const small = !hs.tall && hs.size < 0.16 && type !== 'globe';

    for (let i = 0; i < n; i++) {
        const [px, pz] = inEllipse(rng, rx, rz);
        const hh = it.h * (0.72 + rng() * 0.38);
        const dir = wobble(rng, UP, 0.35);
        const stemLen = Math.max(0.15, hh - (hs.tall ? hs.size * 0.92 : hs.size * 0.15));
        const base = V(px, 0, pz), top = base.clone().addScaledVector(dir, stemLen);
        stems.add(between(base, top, clamp(hh * 0.01, 0.012, 0.03) * STEM_BOOST), jitter(rng, 0.1));

        // A couple of big leaves at the base, spreading outward: together they make the leafy mound.
        for (let k = 0; k < 2; k++) {
            const q = qAxis(UP, rng() * Math.PI * 2).multiply(qAxis(Z, 0.12 + rng() * 0.3));
            leaves.add(compose(base.clone().add(V(0, 0.03 + rng() * 0.12, 0)), q, leafLen * (1.1 + rng() * 0.4)), jitter(rng, 0.14));
        }
        // Leaves spiral up the stem (137.5° apart, like real plants), smaller near the top.
        const nl = Math.round(clamp(stemLen * 4, 4, 10) * (D() < 1 ? 0.7 : 1));
        for (let k = 0; k < nl; k++) {
            const t = 0.06 + 0.72 * (k / nl);
            const p = base.clone().addScaledVector(dir, stemLen * t);
            const len = leafLen * (1 - 0.45 * t) * (0.8 + rng() * 0.4);
            const q = qAxis(UP, k * 2.4 + rng() * 0.6).multiply(qAxis(Z, 0.3 + rng() * 0.4));
            leaves.add(compose(p, q, len), jitter(rng, 0.12));
        }

        // Flower heads: one on top, or a few on short branches for small-flowered plants.
        if (type === 'none') continue;
        const perStem = small ? 3 + Math.floor(rng() * 3) : 1;
        for (let k = 0; k < perStem; k++) {
            let pos = top, hdir = hs.tall ? dir : wobble(rng, dir.clone().add(V(0, 0, 0.15)), 0.7);
            if (perStem > 1) {
                const a = rng() * Math.PI * 2, r = hs.size * (1.2 + rng());
                pos = top.clone().add(V(Math.cos(a) * r, -rng() * hs.size * 2, Math.sin(a) * r));
                stems.add(between(top.clone().addScaledVector(dir, -hs.size * 3), pos, 0.008), jitter(rng));
                hdir = wobble(rng, V(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), 0.3);
            }
            addHead(hs, rng, pos, hdir);
        }
    }

    P.stemMat = material(rec, mixHex(it.foliage, '#7a8a50', 0.3), { wind: 1, rough: 0.85 });
    P.leafMats.push(material(rec, it.foliage, { wind: 1, double: true }));
    P.stems = meshFrom(stemGeometry(), P.stemMat, stems, { wind: 1 });
    P.leaves = meshFrom(leafGeometry(leafKindFor(it, type)), P.leafMats[0], leaves, { wind: 1 });
    for (const m of [P.stems, P.leaves]) if (m) group.add(m);
    finishHeads(rec, hs, group, 1);
    return Math.max(rx, rz) + 0.5;
}

/* ---------- grasses and sedges ---------- */

function buildGrass(rec, rng, group) {
    const it = rec.item, P = rec.parts;
    const rx = it.r, rz = it.rz || it.r;
    const area = Math.PI * rx * rz;
    const clumps = Math.round(clamp(area * 2.2 * D(), 3, 70 * D()));
    const perClump = Math.round(clamp(22 + it.h * 8, 24, 60) * (D() < 1 ? 0.6 : 1));
    const blades = new Batch();
    const hs = headSet(it, guessFlower(it) === 'none' ? 'none' : 'grass');
    hs.size = clamp(it.h * 0.25, 0.12, 1.1);
    const stalks = new Batch();
    const width = clamp(it.h * 0.02, 0.025, 0.06);         // a little wider than life, so blades read on screen

    for (let c = 0; c < clumps; c++) {
        const [cx, cz] = inEllipse(rng, rx, rz);
        const cr = clamp(it.h * 0.1, 0.08, 0.4);
        for (let b = 0; b < perClump; b++) {
            const a = rng() * Math.PI * 2, d = rng() * cr;
            const bh = it.h * (0.42 + rng() * 0.38);
            // Blades curve toward +Z; lean them outward, then turn to a random direction.
            const q = qAxis(UP, a).multiply(qAxis(X_AXIS, 0.08 + rng() * 0.45));
            blades.add(compose(V(cx + Math.cos(a) * d, 0, cz + Math.sin(a) * d), q, V(width * (0.8 + rng() * 0.4), bh, bh)), jitter(rng, 0.14));
        }
        // Seed stalks rise above the leaves.
        const ns = 3 + Math.floor(rng() * 5);
        for (let s = 0; s < ns; s++) {
            const dir = wobble(rng, UP, 0.4);
            const len = it.h * (0.85 + rng() * 0.2) - hs.size * 0.9;
            const base = V(cx + (rng() - 0.5) * cr, 0, cz + (rng() - 0.5) * cr);
            const top = base.clone().addScaledVector(dir, Math.max(0.1, len));
            stalks.add(between(base, top, 0.008 * STEM_BOOST), jitter(rng));
            addHead(hs, rng, top, dir);
        }
    }

    P.leafMats.push(material(rec, it.foliage, { wind: 1.3, double: true, rough: 0.7 }));
    P.blades = meshFrom(bladeGeometry(false), P.leafMats[0], blades, { wind: 1.3 });
    P.stemMat = material(rec, mixHex(it.foliage, '#a89a70', 0.4), { wind: 1.3 });
    P.stems = meshFrom(stemGeometry(), P.stemMat, stalks, { wind: 1.3 });
    for (const m of [P.blades, P.stems]) if (m) group.add(m);
    finishHeads(rec, hs, group, 1.3);
    return Math.max(rx, rz) + 0.4;
}

/* ---------- trees and shrubs ---------- */

/* Leaf picture: feathery for small-leaflet trees, needles for conifers, broad otherwise. */
function cardKind(it, crown) {
    if (crown === 'cone') return 'needle';
    return ['Gleditsia', 'Gymnocladus', 'Sapindus', 'Robinia', 'Prosopis', 'Mimosa', 'Albizia', 'Amorpha', 'Acacia'].includes(genusOf(it.sci)) ? 'fine' : 'broad';
}

/* Fruit size in feet: small berries by default, a few genera bigger. */
function fruitSize(it, rx, ry) {
    const g = genusOf(it.sci);
    const special = { Maclura: 0.22, Juglans: 0.12, Prunus: 0.06, Quercus: 0.045, Malus: 0.1, Diospyros: 0.1, Rhus: 0.03 };
    return special[g] || clamp(Math.min(rx, ry) * 0.012, 0.02, 0.07);
}

/*
 * One tree or shrub (a "member": entries can hold several). Everything goes
 * into the shared batches in `acc` so all members draw together.
 *
 * Skeleton: a trunk (trees), main limbs reaching for points on the canopy's
 * outer shell, and twigs off each limb. Then leaf cards fill the canopy:
 * most clustered around twig tips, the rest scattered through the outer shell.
 */
function buildWoody(rec, rng, acc, member, isTree, crown) {
    const it = rec.item;
    const H = Math.max(0.8, it.h), W = Math.max(0.6, it.w || H * 0.7);
    let trunkH, ry, cy, rx = W / 2;
    switch (crown) {
        case 'spreading': trunkH = H * 0.28; ry = (H - trunkH) * 0.42; cy = H - ry; break;
        case 'vase': trunkH = H * 0.3; ry = (H - trunkH) / 2; cy = trunkH + ry; break;
        case 'column': trunkH = H * 0.12; ry = (H - trunkH) / 2; cy = trunkH + ry; rx = Math.min(rx, H * 0.18); break;
        case 'upright': trunkH = 0; ry = H * 0.5; cy = H * 0.55; break;
        case 'mound': trunkH = 0; ry = H * 0.5; cy = H * 0.46; break;
        default: trunkH = isTree ? H * 0.34 : 0; ry = (H - trunkH) / 2; cy = trunkH + ry;
    }
    const o = V(member.x, 0, member.z);
    const center = V(o.x, cy, o.z);
    const trunkR = isTree ? clamp(H * 0.022, 0.06, 1.4) : clamp(H * 0.02, 0.03, 0.12);
    const minY = isTree ? trunkH * 0.85 : 0.15;

    // A point on (or inside, with f < 1) the canopy's outer shell. az = compass angle, el = height angle.
    const shell = (az, el, f = 1) => V(o.x + Math.cos(az) * Math.cos(el) * rx * f, Math.max(minY, cy + Math.sin(el) * ry * f), o.z + Math.sin(az) * Math.cos(el) * rx * f);
    const elRange = { round: [0.1, 0.85], spreading: [-0.1, 0.5], vase: [0.35, 0.95], column: [0.3, 1.0], upright: [0.55, 1.3], mound: [0.15, 1.2] }[crown] || [0.1, 0.85];

    const tips = [];
    let trunkTop = o.clone();
    if (isTree) {
        trunkTop = o.clone().add(V((rng() - 0.5) * H * 0.03, trunkH, (rng() - 0.5) * H * 0.03));
        acc.branches.add(between(o, trunkTop, trunkR), jitter(rng, 0.06));
    }
    const nLimbs = isTree ? 6 + Math.floor(rng() * 3) : 5 + Math.floor(rng() * 4);
    for (let i = 0; i < nLimbs; i++) {
        const az = (i / nLimbs) * Math.PI * 2 + rng() * 0.6;
        const el = elRange[0] + rng() * (elRange[1] - elRange[0]);
        const start = isTree ? o.clone().add(V(0, trunkH * (0.75 + rng() * 0.3), 0))
            : o.clone().add(V((rng() - 0.5) * rx * 0.25, 0, (rng() - 0.5) * rx * 0.25));
        const end = shell(az, el, 0.8 + rng() * 0.1);
        const mid = start.clone().lerp(end, 0.5).add(V((rng() - 0.5) * rx * 0.15, ry * 0.08, (rng() - 0.5) * rx * 0.15));
        const r0 = isTree ? trunkR * 0.55 : trunkR;
        acc.branches.add(between(start, mid, r0), jitter(rng, 0.06));
        acc.branches.add(between(mid, end, r0 * 0.68), jitter(rng, 0.06));
        tips.push(end);
        const nTwigs = isTree ? 3 : 2;
        for (let k = 0; k < nTwigs; k++) {
            const from = mid.clone().lerp(end, 0.3 + rng() * 0.7);
            const to = shell(az + (rng() - 0.5) * 1.3, el + (rng() - 0.5) * 0.8, 0.92 + rng() * 0.12);
            acc.branches.add(between(from, to, r0 * 0.28), jitter(rng, 0.06));
            tips.push(to);
            acc.segments.push([from, to]);
        }
        acc.segments.push([mid, end]);
    }

    // Leaf cards. Count scales with the canopy's surface area.
    const card = clamp(Math.min(rx, ry) * 0.42, 0.35, 4.5);
    const surface = 4 * Math.PI * ((2 * rx * rx + ry * ry) / 3);
    const nCards = Math.round(clamp(surface / (card * card * 0.17), 40, 1300) * D());
    for (let i = 0; i < nCards; i++) {
        let p;
        if (rng() < 0.6) {
            const t = tips[Math.floor(rng() * tips.length)];
            p = t.clone().add(V((rng() - 0.5) * card * 1.6, (rng() - 0.4) * card * 1.2, (rng() - 0.5) * card * 1.6));
        } else {
            p = shell(rng() * Math.PI * 2, -0.6 + rng() * 1.9, 0.65 + rng() * 0.38);
        }
        p.y = Math.max(p.y, minY);
        // Face mostly outward from the canopy middle, then spin randomly.
        const out = p.clone().sub(center).divide(V(rx, ry, rx)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(Z, wobble(rng, out, 1.4)).multiply(qAxis(Z, rng() * Math.PI * 2));
        acc.cards.add(compose(p, q, card * (0.75 + rng() * 0.5)), jitter(rng, 0.16));
        acc.cardSpots.push([p, out]);
    }
    acc.tips.push(...tips);
    acc.shape = { rx, ry, cy, trunkH };
    return Math.hypot(member.x, member.z) + rx + 0.4;
}

/* Conifers: a straight trunk, whorls of branches, needle cards on a cone. */
function buildConifer(rec, rng, acc, member) {
    const it = rec.item;
    const H = Math.max(1, it.h), W = Math.max(0.6, it.w || H * 0.45);
    const o = V(member.x, 0, member.z);
    const y0 = H * 0.06;
    const radiusAt = (y) => (W / 2) * Math.pow(Math.max(0, 1 - (y - y0) / (H - y0)), 0.85) + 0.15;
    acc.branches.add(between(o, o.clone().add(V(0, H, 0)), clamp(H * 0.016, 0.05, 0.8)), jitter(rng, 0.05));
    const whorls = Math.round(clamp(H / 1.2, 5, 22));
    for (let w = 0; w < whorls; w++) {
        const y = y0 + (H - y0) * (w / whorls), R = radiusAt(y);
        for (let b = 0; b < 5; b++) {
            const a = b * 1.26 + w * 0.7 + rng() * 0.4;
            const from = o.clone().add(V(0, y, 0)), to = o.clone().add(V(Math.cos(a) * R, y - R * 0.2, Math.sin(a) * R));
            acc.branches.add(between(from, to, clamp(H * 0.0035, 0.015, 0.12)), jitter(rng, 0.05));
            acc.tips.push(to);
        }
    }
    const card = clamp(W * 0.2, 0.35, 3.5);
    const nCards = Math.round(clamp((Math.PI * (W / 2) * H) / (card * card * 0.14), 60, 1200) * D());
    for (let i = 0; i < nCards; i++) {
        const y = y0 + (H - y0) * Math.pow(rng(), 0.8), a = rng() * Math.PI * 2, R = radiusAt(y) * (0.6 + rng() * 0.45);
        const p = o.clone().add(V(Math.cos(a) * R, y, Math.sin(a) * R));
        const out = V(Math.cos(a), -0.25, Math.sin(a)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(Z, wobble(rng, out, 1.0)).multiply(qAxis(Z, rng() * Math.PI * 2));
        acc.cards.add(compose(p, q, card * (0.75 + rng() * 0.5)), jitter(rng, 0.12));
        acc.cardSpots.push([p, out]);
    }
    return Math.hypot(member.x, member.z) + W / 2 + 0.4;
}

/* Yucca and kin: a ball of stiff sword leaves, with a flower stalk. */
function buildRosette(rec, rng, acc, member, hs) {
    const it = rec.item;
    const H = Math.max(1, it.h), o = V(member.x, 0, member.z);
    const leafH = H * 0.5;
    const n = Math.round(clamp(H * 30, 40, 110) * D());
    for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, el = 0.25 + rng() * 1.25;          // 0.25 = sprawling, 1.5 = upright
        const q = qAxis(UP, a).multiply(qAxis(X_AXIS, Math.PI / 2 - el));
        const len = leafH * (0.65 + rng() * 0.45);
        acc.swords.add(compose(o.clone().add(V((rng() - 0.5) * 0.15, 0.05, (rng() - 0.5) * 0.15)), q, V(0.05, len, len)), jitter(rng, 0.1));
    }
    const top = o.clone().add(V(0, Math.max(leafH, H - hs.size * 0.9), 0));
    acc.stalks.add(between(o, top, 0.04), jitter(rng));
    addHead(hs, rng, top, UP);
    return Math.hypot(member.x, member.z) + leafH * 0.7;
}

function buildTreeOrShrub(rec, rng, group) {
    const it = rec.item, P = rec.parts;
    const isTree = it.form === 'tree';
    const crown = guessCrown(it);
    const type = guessFlower(it);
    const hs = headSet(it, type);
    const acc = { branches: new Batch(), cards: new Batch(), swords: new Batch(), stalks: new Batch(), tips: [], segments: [], cardSpots: [], shape: null };
    const members = it.members.length ? it.members : [{ x: 0, z: 0 }];
    let foot = 1;
    for (const m of members) {
        if (crown === 'rosette') foot = Math.max(foot, buildRosette(rec, rng, acc, m, hs));
        else if (crown === 'cone') foot = Math.max(foot, buildConifer(rec, rng, acc, m));
        else foot = Math.max(foot, buildWoody(rec, rng, acc, m, isTree, crown));
    }

    // Flowers. Small blossoms cover the canopy and run along the outer branches
    // (redbuds and plums bloom on bare wood); bigger heads sit at twig tips.
    if (crown !== 'rosette' && type !== 'none' && it.bloom) {
        const spots = acc.cardSpots;
        if (type === 'blossom') {
            const n = Math.round(clamp(spots.length * 1.4, 20, 600));
            for (let i = 0; i < n; i++) {
                if (i % 3 === 0 && acc.segments.length) {
                    const [a, b] = acc.segments[Math.floor(rng() * acc.segments.length)];
                    addHead(hs, rng, a.clone().lerp(b, 0.3 + rng() * 0.7), wobble(rng, UP, 1.6));
                } else if (spots.length) {
                    const [p, out] = spots[Math.floor(rng() * spots.length)];
                    addHead(hs, rng, p.clone().addScaledVector(out, 0.15), wobble(rng, out.clone().add(UP), 0.8));
                }
            }
        } else {
            const n = Math.round(clamp(spots.length * (hs.tall ? 0.35 : 0.3), 6, 220));
            for (let i = 0; i < n && spots.length; i++) {
                const [p, out] = spots[Math.floor(rng() * spots.length)];
                const dir = type === 'catkin' ? UP : wobble(rng, out.clone().add(V(0, 1.2, 0)), 0.6);
                addHead(hs, rng, p.clone().addScaledVector(out, hs.size * 0.3), dir);
            }
        }
    }

    // Fruit: little clusters near the outside of the canopy; pods hang down.
    const fruit = new Batch();
    if (it.fruit && acc.cardSpots.length) {
        const sh = acc.shape || { rx: 1, ry: 1 };
        const fs = fruitSize(it, sh.rx, sh.ry);
        const n = Math.round(clamp(acc.cardSpots.length * 0.35, 8, 160));
        for (let i = 0; i < n; i++) {
            const [p, out] = acc.cardSpots[Math.floor(rng() * acc.cardSpots.length)];
            const base = p.clone().addScaledVector(out, 0.1);
            if (it.fruitShape === 'pod') {
                fruit.add(compose(base.add(V(0, -fs * 6, 0)), qAxis(UP, rng() * 6), V(fs * 0.9, fs * 6, fs * 0.3)), jitter(rng, 0.1));
            } else {
                for (let k = 0; k < 3; k++) {
                    fruit.add(compose(base.clone().add(V((rng() - 0.5) * fs * 3, -rng() * fs * 2, (rng() - 0.5) * fs * 3)), new THREE.Quaternion(), fs * (0.85 + rng() * 0.3)), jitter(rng, 0.1));
                }
            }
        }
    }

    const sway = isTree ? 0.22 : 0.5;
    const cardTex = leafCard(cardKind(it, crown));
    P.barkMat = material(rec, isTree ? '#5b4a3b' : '#6b5947', { wind: sway, rough: 0.95 });
    P.branches = meshFrom(stemGeometry(), P.barkMat, acc.branches, { wind: sway });
    const leafMat = material(rec, it.foliage, { wind: sway, map: cardTex, double: true, rough: 0.75 });
    P.leafMats.push(leafMat);
    P.cards = meshFrom(cardGeometry(), leafMat, acc.cards, { wind: sway, map: cardTex });
    if (acc.swords.size) {
        const swordMat = material(rec, it.foliage, { wind: 0.4, double: true, rough: 0.6 });
        P.leafMats.push(swordMat);
        P.swords = meshFrom(bladeGeometry(true), swordMat, acc.swords, { wind: 0.4 });
        P.stemMat = material(rec, '#7a7a52', { wind: 0.4 });
        P.stems = meshFrom(stemGeometry(), P.stemMat, acc.stalks, { wind: 0.4 });
    }
    P.fruitMat = material(rec, it.fruitColor, { wind: sway, rough: 0.45 });
    P.fruit = meshFrom(ballGeometry(), P.fruitMat, fruit, { wind: sway });
    for (const m of [P.branches, P.cards, P.swords, P.stems, P.fruit]) if (m) group.add(m);
    finishHeads(rec, hs, group, sway);

    // A mulch ring around young trees.
    if (isTree && (it.status === 'planned' || it.status === 'new')) {
        const mulch = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.06, 24), material(rec, '#6e5638'));
        rec.geos.push(mulch.geometry);
        mulch.receiveShadow = true;
        group.add(mulch);
    }
    return foot;
}

/* ---------- vines ---------- */

/* Leaves and flowers spread over a strip of fence `len` feet long (turned by rot). */
function buildVine(rec, rng, group) {
    const it = rec.item, P = rec.parts;
    const L = it.len, H = Math.max(1.5, it.h);
    const type = guessFlower(it);
    const hs = headSet(it, type);
    const leaves = new Batch(), stems = new Batch(), fruit = new Batch();
    const n = Math.round(clamp(L * H * 2.4, 20, 500) * D());
    const leafLen = clamp(H * 0.06, 0.18, 0.5);
    // Leaves lie flat against the fence: turn the leaf to face +Z, then spin it in that plane.
    for (let i = 0; i < n; i++) {
        const p = V(-L / 2 + rng() * L, 0.5 + Math.pow(rng(), 0.8) * (H - 0.5), 0.25 + rng() * 0.25);
        const q = qAxis(X_AXIS, -Math.PI / 2 + (rng() - 0.5) * 0.8).premultiply(qAxis(Z, rng() * Math.PI * 2));
        leaves.add(compose(p, q, leafLen * (0.75 + rng() * 0.5)), jitter(rng, 0.14));
    }
    // A few long wandering stems.
    for (let s = 0; s < 4; s++) {
        let prev = V(-L / 2 + rng() * L * 0.2, 0, 0.22);
        for (let k = 1; k <= 10; k++) {
            const next = V(-L / 2 + (k / 10) * L, clamp(prev.y + (rng() - 0.35) * H * 0.35, 0.3, H), 0.22 + rng() * 0.1);
            stems.add(between(prev, next, 0.025), jitter(rng));
            prev = next;
        }
    }
    if (type !== 'none' && it.bloom) {
        const nf = Math.round(clamp(L * H * 0.9, 6, 240) * D());
        for (let i = 0; i < nf; i++) {
            addHead(hs, rng, V(-L / 2 + rng() * L, 0.8 + rng() * (H - 0.8), 0.45 + rng() * 0.15), wobble(rng, V(0, 0.6, 1), 0.7));
        }
    }
    if (it.fruit) {
        const fs = 0.04;
        for (let i = 0; i < Math.round(clamp(L * H * 0.6, 6, 160)); i++) {
            fruit.add(compose(V(-L / 2 + rng() * L, 0.6 + rng() * (H - 0.6), 0.45), new THREE.Quaternion(), fs), jitter(rng));
        }
    }
    P.leafMats.push(material(rec, it.foliage, { wind: 0.7, double: true }));
    P.leaves = meshFrom(leafGeometry('oval'), P.leafMats[0], leaves, { wind: 0.7 });
    P.stemMat = material(rec, '#6b5947', { wind: 0.7 });
    P.stems = meshFrom(stemGeometry(), P.stemMat, stems, { wind: 0.7 });
    P.fruitMat = material(rec, it.fruitColor, { wind: 0.7, rough: 0.45 });
    P.fruit = meshFrom(ballGeometry(), P.fruitMat, fruit, { wind: 0.7 });
    for (const m of [P.leaves, P.stems, P.fruit]) if (m) group.add(m);
    finishHeads(rec, hs, group, 0.7);
    group.rotation.y = (it.rot || 0) * Math.PI / 180;
    return L / 2;
}

/* ---------- iris ---------- */

/* Fans of sword leaves around a ring `r` feet across, with a flower stalk per fan. */
function buildIris(rec, rng, group) {
    const it = rec.item, P = rec.parts;
    const R = it.r, fans = Math.max(8, Math.round(2 * Math.PI * R / 1.2));
    const hs = headSet(it, guessFlower(it));
    const swords = new Batch(), stalks = new Batch();
    for (let f = 0; f < fans; f++) {
        const a = (f / fans) * Math.PI * 2 + rng() * 0.2;
        const base = V(Math.cos(a) * R, 0, Math.sin(a) * R);
        const fanAz = rng() * Math.PI;
        for (let j = 0; j < 6; j++) {
            const spread = (j - 2.5) * 0.16;
            const len = it.h * (0.55 + rng() * 0.3) * (1 - Math.abs(spread) * 0.8);
            const q = qAxis(UP, fanAz).multiply(qAxis(Z, spread));
            swords.add(compose(base.clone().add(V((rng() - 0.5) * 0.1, 0, (rng() - 0.5) * 0.1)), q, V(0.13, len, len * 0.3)), jitter(rng, 0.1));
        }
        const top = base.clone().add(V(0, it.h * (0.95 + rng() * 0.2), 0));
        stalks.add(between(base, top, 0.025), jitter(rng));
        addHead(hs, rng, top, wobble(rng, UP, 0.3));
    }
    P.leafMats.push(material(rec, it.foliage, { wind: 0.5, double: true, rough: 0.6 }));
    P.leaves = meshFrom(bladeGeometry(true), P.leafMats[0], swords, { wind: 0.5 });
    P.stemMat = material(rec, mixHex(it.foliage, '#8a9a60', 0.3), { wind: 0.5 });
    P.stems = meshFrom(stemGeometry(), P.stemMat, stalks, { wind: 0.5 });
    for (const m of [P.leaves, P.stems]) if (m) group.add(m);
    finishHeads(rec, hs, group, 0.5);
    return R + 0.8;
}

/* ---------- cacti ---------- */

/*
 * Three kinds: prickly pear pads (the default), cholla (branching jointed
 * cylinders, genus Cylindropuntia), and small globes (Escobaria and kin).
 */
function buildCactus(rec, rng, group) {
    const it = rec.item, P = rec.parts;
    const g = genusOf(it.sci);
    const kind = g === 'Cylindropuntia' ? 'cholla' : ['Escobaria', 'Echinocereus', 'Mammillaria', 'Coryphantha', 'Pediocactus'].includes(g) ? 'globe' : 'pad';
    const hs = headSet(it, guessFlower(it));
    const body = new Batch(), fruit = new Batch(), joints = new Batch();
    const rx = it.r, rz = it.rz || it.r;
    const tops = [];
    if (kind === 'pad') {
        const n = Math.round(clamp(Math.PI * rx * rz * 0.9, 3, 30));
        for (let i = 0; i < n; i++) {
            const [px, pz] = inEllipse(rng, rx, rz);
            const stack = 2 + Math.floor(rng() * 3);
            let y = 0.35;
            for (let k = 0; k < stack; k++) {
                const p = V(px + (rng() - 0.5) * 0.5, y, pz + (rng() - 0.5) * 0.5);
                const q = qAxis(UP, rng() * 6.28).multiply(qAxis(Z, (rng() - 0.5) * 0.6));
                body.add(compose(p, q, V(0.42, 0.52, 0.1)), jitter(rng, 0.1));
                y += 0.45;
                if (k === stack - 1) tops.push([p.clone().add(V(0, 0.48, 0)), q]);
            }
        }
    } else if (kind === 'cholla') {
        const n = Math.max(1, Math.round(rx * rz));
        for (let i = 0; i < n; i++) {
            const [px, pz] = inEllipse(rng, rx * 0.6, rz * 0.6);
            const grow = (from, dir, depth) => {
                const len = 0.55 + rng() * 0.25, to = from.clone().addScaledVector(dir, len);
                joints.add(between(from, to, 0.11), jitter(rng, 0.08));
                if (depth === 0 || to.y > it.h) { tops.push([to, new THREE.Quaternion()]); return; }
                const k = 1 + Math.floor(rng() * 2);
                for (let j = 0; j < k; j++) grow(to, wobble(rng, dir.clone().add(V(0, 0.6, 0)), 1.6), depth - 1);
            };
            grow(V(px, 0, pz), UP, Math.round(clamp(it.h / 0.9, 2, 6)));
        }
    } else {
        const n = Math.round(clamp(Math.PI * rx * rz * 6, 2, 20));
        for (let i = 0; i < n; i++) {
            const [px, pz] = inEllipse(rng, rx, rz), s = 0.1 + rng() * 0.08;
            body.add(compose(V(px, s * 0.8, pz), new THREE.Quaternion(), V(s, s * 1.1, s)), jitter(rng, 0.08));
            tops.push([V(px, s * 1.8, pz), new THREE.Quaternion()]);
        }
    }
    for (const [p] of tops) {
        if (it.bloom && rng() < 0.75) addHead(hs, rng, p, wobble(rng, UP, 0.5));
        if (it.fruit && rng() < 0.6) fruit.add(compose(p.clone().add(V((rng() - 0.5) * 0.2, 0.05, (rng() - 0.5) * 0.2)), new THREE.Quaternion(), V(0.07, 0.1, 0.07)), jitter(rng));
    }
    P.leafMats.push(material(rec, it.foliage, { rough: 0.55 }));
    P.body = meshFrom(ballGeometry(), P.leafMats[0], body);
    P.joints = meshFrom(stemGeometry(), P.leafMats[0], joints);
    P.fruitMat = material(rec, it.fruitColor, { rough: 0.5 });
    P.fruit = meshFrom(ballGeometry(), P.fruitMat, fruit);
    for (const m of [P.body, P.joints, P.fruit]) if (m) group.add(m);
    finishHeads(rec, hs, group, 0);
    return Math.max(rx, rz) + 0.6;
}

/* ---------- the entry point ---------- */

export function buildPlant(rec) {
    const it = rec.item, g = rec.body;
    rec.parts = { kind: it.form, heads: [], leafMats: [] };
    const rng = rngFor(it.id);
    g.position.y = it.y || 0;
    let foot;
    switch (it.form) {
        case 'tree':
        case 'shrub': foot = buildTreeOrShrub(rec, rng, g); break;
        case 'grass': foot = buildGrass(rec, rng, g); break;
        case 'vine': foot = buildVine(rec, rng, g); break;
        case 'iris': foot = buildIris(rec, rng, g); break;
        case 'cactus': foot = buildCactus(rec, rng, g); break;
        default: foot = buildForb(rec, rng, g);
    }
    rec.labelY = (it.y || 0) + it.h + 1.2;
    rec.footR = foot;

    // Mature-size "ghost": a see-through blue shell showing how big a tree or shrub will get.
    if ((it.form === 'tree' || it.form === 'shrub') && it.matureH > 0 && it.matureW > 0) {
        const ghost = new THREE.Group();
        const isTree = it.form === 'tree', H = it.matureH, W = it.matureW;
        const trunkH = isTree ? H * 0.34 : 0;
        const shellMat = new THREE.MeshBasicMaterial({ color: '#2b5f80', transparent: true, opacity: 0.1, depthWrite: false });
        const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), shellMat);
        shell.position.y = isTree ? trunkH + (H - trunkH) / 2 : H / 2;
        shell.scale.set(W / 2, isTree ? (H - trunkH) / 2 : H / 2, W / 2);
        rec.mats.push(shellMat);
        rec.geos.push(shell.geometry);
        ghost.add(shell);
        const ring = circleLine(W / 2, '#2b5f80', 0.75, true);
        ring.position.y = 0.08;
        ghost.add(ring);
        rec.mats.push(ring.material);
        ghost.traverse(o => { o.raycast = () => {}; });
        ghost.visible = S.mature;
        rec.ghost = ghost;
        rec.group.add(ghost);
    }
}

/* ---------- seasons ---------- */

/*
 * Leaf color for month m: fresh green when leaves come out, fall color in the
 * month they drop (and a blend the month before), a touch of winter bronze
 * for evergreens in Dec–Feb.
 */
export function foliageColor(it, m) {
    const base = it.foliage;
    const evergreen = !it.leaf || (it.leaf[0] === 1 && it.leaf[1] === 12);
    if (evergreen) return [12, 1, 2].includes(m) ? mixHex(base, '#6b5a48', 0.3) : base;
    const [on, off] = it.leaf;
    const fall = it.fall || mixHex(base, DORMANT, 0.6);
    if (m === off) return fall;
    if (m === prevM(off) && prevM(off) !== on) return mixHex(base, fall, 0.4);
    if (m === on) return mixHex(base, '#a9c95a', 0.4);
    return base;
}

/* Months in a range, in order (handles ranges that wrap past December). */
function monthsOf(r) {
    const out = [];
    for (let m = r[0]; ; m = m === 12 ? 1 : m + 1) {
        out.push(m);
        if (m === r[1] || out.length > 12) break;
    }
    return out;
}

/* How much of a plant is in flower: building up in the first month, fading in the last. */
function bloomFraction(m, r) {
    if (!r || !inRange(m, r)) return 0;
    const months = monthsOf(r);
    if (months.length === 1) return 1;
    const i = months.indexOf(m);
    if (i === 0) return 0.45;
    if (i === months.length - 1) return 0.55;
    return 1;
}

/* Deciduous canopies are thinner the month leaves come out and the month they drop. */
function leafFraction(it, m) {
    if (!it.leaf || (it.leaf[0] === 1 && it.leaf[1] === 12)) return 1;
    if (m === it.leaf[0]) return 0.55;
    if (m === it.leaf[1]) return 0.6;
    return 1;
}

function setShown(mesh, on, fraction = 1) {
    if (!mesh) return;
    mesh.visible = on;
    mesh.count = on ? Math.max(1, Math.ceil(mesh.userData.total * fraction)) : 0;
}

/* Show the right parts of one plant for month m. */
export function seasonPlant(rec, m) {
    const it = rec.item, P = rec.parts;
    if (!P || !P.leafMats) return;
    const evergreen = !it.leaf || (it.leaf[0] === 1 && it.leaf[1] === 12);
    const inLeaf = !it.leaf || inRange(m, it.leaf);
    const blooming = !!it.bloom && inRange(m, it.bloom);
    const fruiting = !!it.fruit && inRange(m, it.fruit);
    const seeding = !!it.seed && inRange(m, it.seed);
    const leafColor = foliageColor(it, m);
    for (const mat of P.leafMats) mat.color.set(leafColor);

    // Trees and shrubs: the canopy thins and disappears with the leaves.
    if (P.cards) setShown(P.cards, inLeaf, leafFraction(it, m));

    // Wildflowers, iris: leaves die back when dormant. Stems stay standing only to hold seed heads.
    // Annuals vanish entirely once their seed heads are gone.
    if (['forb', 'annual', 'iris', 'vine'].includes(it.form)) {
        const dormant = !inLeaf && !evergreen;
        if (P.leaves) P.leaves.visible = !dormant;
        if (P.stems) {
            P.stems.visible = !dormant || seeding || (it.form === 'iris') || (it.form === 'vine');
            P.stemMat.color.set(dormant ? DORMANT : P.stemMat.userData.base);
        }
    }
    // Grasses stand all winter, straw-colored.
    if (it.form === 'grass' && P.blades) {
        P.blades.material.color.set(inLeaf ? leafColor : mixHex(it.fall || DORMANT, DORMANT, 0.45));
        if (P.stems) P.stemMat.color.set(inLeaf ? P.stemMat.userData.base : DORMANT);
    }

    // Flowers, then seed heads.
    const frac = bloomFraction(m, it.bloom);
    const seedColor = it.form === 'grass' ? mixHex(it.bloomColor, '#d8c8a0', 0.65) : SEED_BROWN;
    for (const H of P.heads) {
        let petals = false, center = false, petalSeed = false, centerSeed = false, f = 1;
        if (blooming) { petals = center = true; f = frac; }
        else if (seeding && H.spec.seed === 'center') { center = true; centerSeed = true; }
        else if (seeding && H.spec.seed === 'head') { petals = center = true; petalSeed = true; }
        for (const mesh of H.petals) {
            setShown(mesh, petals, f);
            mesh.material.color.set(petalSeed ? seedColor : mesh.material.userData.base);
            mesh.material.emissive.set(petalSeed ? new THREE.Color(0, 0, 0) : mesh.material.userData.base.clone().multiplyScalar(0.1));
        }
        if (H.center) {
            setShown(H.center, center, f);
            H.center.material.color.set(centerSeed ? mixHex(SEED_BROWN, '#1e140c', 0.4) : H.center.material.userData.base);
        }
    }
    if (P.fruit) setShown(P.fruit, fruiting);
    if (P.stems && it.form === 'grass') P.stems.visible = blooming || seeding;
}

/* ---------- growing over the years ---------- */

/*
 * Trees and shrubs approach their mature size along a curve: quick at first,
 * slowing as they near full size (shrubs reach most of it in ~4 years,
 * trees in ~10–20). Scales the model rather than rebuilding it.
 */
/* How much bigger (sideways sx, upward sy) a tree or shrub is `years` from now. */
export function growthScale(it, years) {
    if (!(it.form === 'tree' || it.form === 'shrub') || !(it.matureH > it.h) || years <= 0) return { sx: 1, sy: 1 };
    const tau = it.form === 'tree' ? 9 : 3.5;
    const k = 1 - Math.exp(-years / tau);
    const w0 = it.w || it.h * 0.7;
    return {
        sy: (it.h + (it.matureH - it.h) * k) / it.h,
        sx: (w0 + (Math.max(it.matureW, w0) - w0) * k) / w0,
    };
}

export function growPlant(rec, years) {
    const { sx, sy } = growthScale(rec.item, years);
    rec.body.scale.set(sx, sy, sx);
    if (rec.label) rec.label.position.y = rec.labelY * sy;
    rec.grow = { sx, sy };
}
