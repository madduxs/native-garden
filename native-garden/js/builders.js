/*
 * builders.js
 * ---------------------------------------------------------------------------
 * Makes the 3D models for features (ponds, feeders, fences...) and beds.
 * Plants have their own, more detailed builders in flora/plants.js.
 *
 * Each item gets a "record" (rec) from makeRec(): its three.js Group plus
 * bookkeeping (materials to free later, label height, how wide it is).
 * garden.js creates the record, calls a builder, and adds it to the scene.
 *
 * The features are simple low-poly models made of a few shared shapes
 * (scene.js GEO), scaled and placed. Want to change how something looks?
 * Find its case in buildFeature() and adjust the colors (hex strings) or
 * the numbers in addMesh(..., [x, y, z], [sx, sy, sz]).
 */
import { THREE, GEO } from './scene.js';
import { clamp, mixHex, rngFor } from './util.js';
import { groundTexture } from './flora/textures.js';

const UP = new THREE.Vector3(0, 1, 0);

/*
 * A matrix that stretches the unit cylinder (GEO.cyl) from point `from` to
 * point `to` with radius r. Used for posts, legs, wires and sticks.
 */
function cylMatrix(from, to, r) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length() || 0.001;
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    return new THREE.Matrix4().compose(from, q, new THREE.Vector3(r, len, r));
}

/* One InstancedMesh from a list of matrices (or null if the list is empty). */
function instanced(geo, mat, matrices) {
    if (!matrices.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
}

/*
 * A new, empty record for an item.
 *   group   placed at the item's x/z; everything for this item goes inside
 *   body    the model itself (separate so planned items can be faded)
 *   parts   seasonal pieces, filled in by the builders
 *   mats    every material made for this item, so we can free them later
 *   mk()    makes a flat-shaded material and remembers it in mats
 *   labelY  how high the name label floats; footR how wide the item is
 */
export function makeRec(kind, it) {
    const rec = {
        kind, item: it, key: `${kind}:${it.id}`,
        mats: [], geos: [], parts: {},
        group: new THREE.Group(), body: new THREE.Group(),
        label: null, ghost: null, labelY: 3, footR: 2,
    };
    // Features use a matte, slightly faceted look (flatShading) that suits wood, stone and metal.
    rec.mk = (color, opts = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.88, metalness: 0, ...opts });
        rec.mats.push(m);
        return m;
    };
    rec.group.userData.key = rec.key;   // lets a mouse click find which item it hit
    rec.group.add(rec.body);
    return rec;
}

/* A circle drawn as a line (selection rings, mature-size rings, round beds). */
export function circleLine(r, color, opacity, dashed) {
    const pts = [];
    for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.9, gapSize: 0.6 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const line = new THREE.Line(g, m);
    if (dashed) line.computeLineDistances();
    line.raycast = () => {};    // lines aren't clickable
    return line;
}

/* Add a mesh to group g with an optional position, scale and rotation (arrays of 3). */
function addMesh(g, geo, mat, pos, scale, rot) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
}

/* ---------- features ---------- */

/*
 * A gable roof: two slopes meeting at a ridge that runs east–west, plus the
 * triangular ends. Built as plain triangles so each face is evenly shaded.
 */
function gableRoof(w, d, rise, over = 0.8) {
    const x = w / 2 + over, z = d / 2 + over;
    const tri = [
        // north slope, south slope (two triangles each)
        -x, 0, -z, x, 0, -z, x, rise, 0, -x, 0, -z, x, rise, 0, -x, rise, 0,
        -x, rise, 0, x, rise, 0, x, 0, z, -x, rise, 0, x, 0, z, -x, 0, z,
        // gable ends
        -x, 0, -z, -x, rise, 0, -x, 0, z, x, 0, -z, x, 0, z, x, rise, 0,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    g.computeVertexNormals();
    return g;
}

/*
 * Build a feature. Each type is its own little model made of boxes,
 * cylinders and stones. `top` sets how high the label floats and `foot`
 * how wide the selection ring is.
 */
export function buildFeature(rec) {
    const it = rec.item, g = rec.body, rng = rngFor(it.id), mk = rec.mk;
    let top = 3, foot = 2;
    const stone = () => mk(mixHex('#a39d90', '#c9c3b4', rng()));   // each stone a slightly different grey

    switch (it.type) {
        case 'fence': {
            // Posts every ~8 ft and four rails. rot 0 runs east–west, 90 north–south.
            const L = it.len, wood = mk('#8a7660');
            const n = Math.max(2, Math.round(L / 8) + 1);
            for (let i = 0; i < n; i++) addMesh(g, GEO.boxBase, wood, [-L / 2 + i * L / (n - 1), 0, 0], [0.35, 6, 0.35]);
            for (const y of [1.0, 2.6, 4.2, 5.6]) addMesh(g, GEO.boxBase, wood, [0, y, 0], [L, 0.45, 0.1]);
            g.rotation.y = it.rot * Math.PI / 180;
            top = 6.5; foot = 3;
            break;
        }
        case 'pond': {
            // A slightly wobbly oval of water, ringed with stones, with lily pads.
            const w = it.w, d = it.d || it.w;
            const n = 32, pts = [];
            for (let i = 0; i < n; i++) {
                const a = i / n * Math.PI * 2;
                const wob = 1 + 0.07 * Math.sin(a * 3 + 1.3) + 0.04 * Math.sin(a * 5 + 0.4);
                pts.push([Math.cos(a) * w / 2 * wob, Math.sin(a) * d / 2 * wob]);
            }
            const waterGeo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2);
            // Low roughness makes the water mirror the sky (the scene's environment light).
            const waterMat = new THREE.MeshStandardMaterial({ color: '#2f5c72', roughness: 0.06, metalness: 0.1, side: THREE.DoubleSide });
            rec.mats.push(waterMat);
            rec.geos.push(waterGeo);
            const water = new THREE.Mesh(waterGeo, waterMat);
            water.position.y = 0.05;
            water.receiveShadow = true;
            g.add(water);
            const rimN = Math.max(12, Math.round((w + d) * 2));
            for (let i = 0; i < rimN; i++) {
                const a = i / rimN * Math.PI * 2, wob = 1.06 + rng() * 0.08, s = 0.3 + rng() * 0.3;
                addMesh(g, GEO.ico0, stone(), [Math.cos(a) * w / 2 * wob, s * 0.35, Math.sin(a) * d / 2 * wob], [s, s * 0.65, s], [0, rng() * 6, 0]);
            }
            const leafy = mk('#83a64e');
            const nPads = Math.round(clamp(w * d * 0.4, 4, 40));
            for (let i = 0; i < nPads; i++) {
                const a = rng() * 6.28, r = Math.sqrt(rng()) * 0.75;
                addMesh(g, GEO.ico0, leafy, [Math.cos(a) * w / 2 * r, 0.1, Math.sin(a) * d / 2 * r], [0.24, 0.06, 0.24]);
            }
            // A stream with a little waterfall at its head. rot is a compass bearing (0 = north).
            const b = (it.rot || 0) * Math.PI / 180, dir = new THREE.Vector3(Math.sin(b), 0, -Math.cos(b));
            if (it.stream > 0) {
                const L = it.stream;
                // Distance from the pond's center to its edge in that direction.
                const edge = 1 / Math.sqrt(Math.pow(Math.sin(b) / (w / 2), 2) + Math.pow(Math.cos(b) / (d / 2), 2));
                const sub = new THREE.Group();
                sub.position.copy(dir.clone().multiplyScalar(edge * 0.92));
                sub.rotation.y = -b;
                g.add(sub);
                const run = new THREE.Mesh(GEO.boxBase, mk('#4a7a90'));
                run.scale.set(1.1, 0.05, L);
                run.position.set(0, 0.02, -L / 2);
                sub.add(run);
                for (let zz = 0; zz < L; zz += 0.8) {
                    for (const side of [-1, 1]) addMesh(sub, GEO.ico0, stone(), [side * (0.8 + rng() * 0.25), 0.12, -zz], [0.32, 0.2, 0.32], [0, rng() * 6, 0]);
                }
                [[0.75, 0.35], [0.6, 0.9], [0.5, 1.35]].forEach(([s, y]) => addMesh(sub, GEO.ico0, stone(), [(rng() - 0.5) * 0.6, y, -L - 0.5], [s, s * 0.75, s]));
            } else {
                [[0.45, 0.35], [0.38, 0.75], [0.3, 1.1]].forEach(([s, y]) => addMesh(g, GEO.ico0, stone(), [dir.x * (w / 2 + 0.3), y, dir.z * (d / 2 + 0.3)], [s, s * 0.8, s]));
            }
            top = 2; foot = Math.max(w, d) / 2 + 0.8;
            break;
        }
        case 'feeder': {
            const metal = mk('#2f3431');
            if (it.onTree) {
                // Hanging from a branch on a wire.
                const y = it.y || 6;
                const wire = new THREE.Mesh(GEO.cyl, metal);
                wire.applyMatrix4(cylMatrix(new THREE.Vector3(1.4, y, 0), new THREE.Vector3(1.4, y + 1.6, 0), 0.02));
                g.add(wire);
                addMesh(g, GEO.ico0, mk('#3d5a4a'), [1.4, y, 0], [0.32, 0.14, 0.32]);
                addMesh(g, GEO.cyl, mk('#c8b17a'), [1.4, y - 1.3, 0], [0.22, 1.3, 0.22]);
                addMesh(g, GEO.cylHi, mk('#3d5a4a'), [1.4, y - 1.4, 0], [0.42, 0.06, 0.42]);
                top = y + 2; foot = 2;
                break;
            }
            // On a pole with an arm and a baffle.
            addMesh(g, GEO.cyl, metal, [0, 0, 0], [0.06, 6.2, 0.06]);
            const arm = new THREE.Mesh(GEO.cyl, metal);
            arm.applyMatrix4(cylMatrix(new THREE.Vector3(0, 6.1, 0), new THREE.Vector3(1.1, 6.2, 0), 0.04));
            g.add(arm);
            addMesh(g, GEO.cyl, mk('#c8b17a'), [1.1, 4.4, 0], [0.22, 1.3, 0.22]);
            addMesh(g, GEO.ico0, mk('#3d5a4a'), [1.1, 5.8, 0], [0.3, 0.14, 0.3]);
            addMesh(g, GEO.boxBase, mk('#7a5f45'), [0, 3.4, 0], [1.4, 0.12, 1.4]);
            top = 6.8; foot = 1.6;
            break;
        }
        case 'nestbox': {
            const big = it.sub === 'owl';
            const W = big ? 1.0 : 0.6, H = big ? 1.5 : 0.95, D = big ? 1.0 : 0.65, y = it.y || 5;
            const wood = mk(it.sub === 'bluebird' ? '#a07c56' : it.sub === 'owl' ? '#7a5a3c' : '#8f6d4b');
            if (!it.onTree) addMesh(g, GEO.cyl, mk('#55524c'), [0, 0, 0], [0.07, y, 0.07]);
            addMesh(g, GEO.boxBase, wood, [0, y, 0], [W, H, D]);
            addMesh(g, GEO.boxBase, mk('#5d4632'), [0, y + H, 0.05], [W + 0.25, 0.08, D + 0.35], [-0.18, 0, 0]);
            addMesh(g, GEO.cyl, mk('#1b1a18'), [0, y + H * 0.68, D / 2], [big ? 0.16 : 0.07, 0.04, big ? 0.16 : 0.07], [Math.PI / 2, 0, 0]);
            top = y + H + 1; foot = 1.2;
            break;
        }
        case 'planter': {
            const bark = new THREE.MeshStandardMaterial({ color: '#6a5038', flatShading: true, roughness: 0.95, side: THREE.DoubleSide });
            rec.mats.push(bark);
            const m = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.15, 2.4, 11, 1, true).translate(0, 1.2, 0), bark);
            m.castShadow = true;
            g.add(m);
            rec.geos.push(m.geometry);
            addMesh(g, GEO.cylHi, mk('#4a3a2a'), [0, 2.15, 0], [1.85, 0.05, 1.85]);
            top = 4.5; foot = 2.6;
            break;
        }
        case 'hibernaculum': {
            // A crib of logs in three crossed layers, with a few pale rocks.
            const log = mk('#6d5640'), logs = [];
            for (let i = 0; i < 9; i++) {
                const layer = Math.floor(i / 3), along = layer % 2 === 0;
                const len = 4 + rng() * 2, r = 0.32 + rng() * 0.18, y = 0.35 + layer * 0.62, off = (i % 3 - 1) * 1.1;
                const a = along ? new THREE.Vector3(-len / 2, y, off) : new THREE.Vector3(off, y, -len / 2);
                const b = along ? new THREE.Vector3(len / 2, y, off) : new THREE.Vector3(off, y, len / 2);
                logs.push(cylMatrix(a, b, r));
            }
            const lm = instanced(GEO.cyl, log, logs);
            lm.castShadow = true;
            g.add(lm);
            const rock = mk('#e3dfd3');
            [[-1.2, 2.0], [1.3, 2.1], [0, 2.4]].forEach(([x, z]) => addMesh(g, GEO.ico0, rock, [x, 0.3, z], [0.8, 0.28, 0.6], [0, rng(), 0]));
            top = 3; foot = 3.6;
            break;
        }
        case 'seep': {
            addMesh(g, GEO.cylHi, mk('#cfbb8c'), [0, 0, 0], [2.3, 0.07, 2.3]);
            addMesh(g, GEO.cylHi, mk('#8a7552'), [0, 0, 0], [1.2, 0.09, 1.2]);
            addMesh(g, GEO.cyl, mk('#e6e5df'), [1.7, 0, -0.8], [0.12, 1.1, 0.12]);
            top = 1.6; foot = 2.6;
            break;
        }
        case 'brushpile': {
            // A tangle of sticks `len` feet long.
            const sticks = [];
            const L = it.len || 7, n = Math.round(clamp(L * 5, 24, 120));
            for (let i = 0; i < n; i++) {
                const a = new THREE.Vector3((rng() - 0.5) * L, rng() * 2.2, (rng() - 0.5) * 4);
                const b = a.clone().add(new THREE.Vector3((rng() - 0.5) * 5, (rng() - 0.3) * 1.4, (rng() - 0.5) * 5));
                b.y = clamp(b.y, 0.1, 3.2);
                sticks.push(cylMatrix(a, b, 0.07 + rng() * 0.09));
            }
            const m = instanced(GEO.cyl, mk('#6f5c48'), sticks);
            m.castShadow = true;
            g.add(m);
            g.rotation.y = (it.rot || 0) * Math.PI / 180;
            top = 3.6; foot = Math.max(4, L / 2 + 1);
            break;
        }
        case 'snag': {
            const grey = mk('#8b857a');
            addMesh(g, GEO.cyl, grey, [0, 0, 0], [0.38, 11, 0.38]);
            [[6, 0.4, 2.2], [8.2, 2.5, 1.8], [9.8, 4.6, 1.4]].forEach(([y, a, l]) => {
                const m = new THREE.Mesh(GEO.cyl, grey);
                m.applyMatrix4(cylMatrix(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * l, y + l * 0.5, Math.sin(a) * l), 0.12));
                m.castShadow = true;
                g.add(m);
            });
            top = 12; foot = 1.5;
            break;
        }
        case 'dripper': {
            addMesh(g, GEO.cylHi, mk('#a39e92'), [0, 0, 0], [1.4, 0.32, 1.4]);
            addMesh(g, GEO.cylHi, mk('#5f8ea3'), [0, 0.32, 0], [1.15, 0.02, 1.15]);
            const metal = mk('#3a3d3a');
            addMesh(g, GEO.cyl, metal, [1.6, 0, 0], [0.04, 3.2, 0.04]);
            const arm = new THREE.Mesh(GEO.cyl, metal);
            arm.applyMatrix4(cylMatrix(new THREE.Vector3(1.6, 3.2, 0), new THREE.Vector3(0.1, 3.2, 0), 0.03));
            g.add(arm);
            top = 3.8; foot = 1.8;
            break;
        }
        case 'birdseep': {
            const n = 9;
            for (let i = 0; i < n; i++) {
                const a = i / n * Math.PI * 2;
                addMesh(g, GEO.ico0, stone(), [Math.cos(a) * 1.85, 0.08, Math.sin(a) * 1.85], [0.75, 0.16, 0.55], [0, a, 0]);
            }
            addMesh(g, GEO.cylHi, mk('#5f8ea3'), [0, 0, 0], [1.3, 0.05, 1.3]);
            top = 1.6; foot = 2.4;
            break;
        }
        case 'martin': {
            // A tall pole with a cross of arms and 12 white gourds.
            const al = mk('#c9cbc8');
            addMesh(g, GEO.cyl, al, [0, 0, 0], [0.1, 14, 0.1]);
            addMesh(g, GEO.cyl, mk('#3a3d3a'), [0, 3.2, 0], [0.38, 1.8, 0.38]);
            for (const a of [0, Math.PI / 2]) {
                const m = new THREE.Mesh(GEO.cyl, al);
                m.applyMatrix4(cylMatrix(new THREE.Vector3(-Math.cos(a) * 2.8, 13.4, -Math.sin(a) * 2.8), new THREE.Vector3(Math.cos(a) * 2.8, 13.4, Math.sin(a) * 2.8), 0.05));
                g.add(m);
            }
            const gourd = mk('#f1efe8');
            for (let i = 0; i < 12; i++) {
                const a = i / 12 * Math.PI * 2, r = i % 2 ? 2.6 : 1.7;
                addMesh(g, GEO.ico1, gourd, [Math.cos(a) * r, 12.4, Math.sin(a) * r], [0.42, 0.55, 0.42]);
            }
            top = 15; foot = 3.2;
            break;
        }
        case 'windmill': {
            // A tapering lattice tower (height = y) with a 16-blade wheel and a tail vane.
            const H = it.y || 16, steel = mk('#8f9290'), parts = [];
            const base = Math.max(1, H * 0.09), topW = 0.35;
            const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
            for (const [sx, sz] of corners) parts.push(cylMatrix(new THREE.Vector3(sx * base, 0, sz * base), new THREE.Vector3(sx * topW, H, sz * topW), 0.06));
            for (let k = 1; k <= 3; k++) {
                const y = H * k / 4, r = base + (topW - base) * k / 4;
                for (let i = 0; i < 4; i++) {
                    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
                    parts.push(cylMatrix(new THREE.Vector3(ax * r, y, az * r), new THREE.Vector3(bx * r, y, bz * r), 0.035));
                }
            }
            const tower = instanced(GEO.cyl, steel, parts);
            tower.castShadow = true;
            g.add(tower);
            const hub = new THREE.Group();
            hub.position.set(0, H + 0.4, 0.6);
            g.add(hub);
            const bladeMat = mk('#b9bcb8'), blades = [];
            const R = Math.max(1.5, H * 0.16);
            for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI * 2;
                blades.push(cylMatrix(new THREE.Vector3(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25, 0), new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0), 0.09));
            }
            const wheel = instanced(GEO.cyl, bladeMat, blades);
            wheel.castShadow = true;
            hub.add(wheel);
            addMesh(hub, GEO.ico0, steel, [0, 0, 0], [0.3, 0.3, 0.3]);
            addMesh(g, GEO.boxBase, bladeMat, [0, H, -1.6], [0.06, 1.1, 2.2]);
            top = H + R + 0.8; foot = Math.max(1.6, base + 0.6);
            break;
        }
        case 'house':
        case 'garage':
        case 'shed': {
            // Walls, a gable roof, and a door and windows on the south (+z) side.
            const W = it.w, D = it.d || it.w * 0.75, H = it.y || 10;
            const shed = it.type === 'shed', garage = it.type === 'garage';
            addMesh(g, GEO.boxBase, mk(shed ? '#8a6a4a' : '#d9d2c4'), [0, 0, 0], [W, H, D]);
            const rise = Math.min(D * 0.3, 9);
            const roofGeo = gableRoof(W, D, rise, shed ? 0.4 : 1);
            rec.geos.push(roofGeo);
            const roofMat = mk(shed ? '#5a5a58' : '#5b4a44', { side: THREE.DoubleSide });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = H;
            roof.castShadow = true;
            roof.receiveShadow = true;
            g.add(roof);
            const dark = mk('#3a342e'), glass = mk('#9fb8c4', { roughness: 0.2 });
            if (garage) addMesh(g, GEO.boxBase, mk('#bdb6a8'), [0, 0, D / 2 + 0.05], [Math.min(W * 0.7, 16), Math.min(H * 0.75, 8), 0.12]);
            else addMesh(g, GEO.boxBase, dark, [W * 0.15, 0, D / 2 + 0.05], [3, Math.min(7, H * 0.8), 0.12]);
            if (!shed) {
                for (const [x, side] of [[-W * 0.28, 1], [W * 0.38, 1], [-W * 0.25, -1], [W * 0.25, -1]]) {
                    if (garage && side === 1) continue;
                    addMesh(g, GEO.boxBase, glass, [x, H * 0.38, side * (D / 2 + 0.05)], [3.2, Math.min(4, H * 0.35), 0.12]);
                }
            }
            g.rotation.y = it.rot * Math.PI / 180;
            top = H + rise + 1.5; foot = Math.hypot(W, D) / 2;
            break;
        }
        case 'greenhouse': {
            const W = it.w, D = it.d || 8, H = it.y || 8;
            const frame = mk('#e8e8e2'), panes = mk('#cfe6ee', { transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false });
            const box = addMesh(g, GEO.boxBase, panes, [0, 0, 0], [W, H, D]);
            box.castShadow = false;
            const rise = D * 0.35;
            const roofGeo = gableRoof(W, D, rise, 0.1);
            rec.geos.push(roofGeo);
            const roof = new THREE.Mesh(roofGeo, mk('#cfe6ee', { transparent: true, opacity: 0.28, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
            roof.position.y = H;
            g.add(roof);
            for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addMesh(g, GEO.boxBase, frame, [x * W / 2, 0, z * D / 2], [0.25, H, 0.25]);
            for (let x = -W / 2 + 2; x < W / 2; x += 2) for (const z of [-1, 1]) addMesh(g, GEO.boxBase, frame, [x, 0, z * D / 2], [0.12, H, 0.12]);
            addMesh(g, GEO.boxBase, frame, [0, H + rise, 0], [W, 0.15, 0.15]);
            g.rotation.y = it.rot * Math.PI / 180;
            top = H + rise + 1.5; foot = Math.hypot(W, D) / 2;
            break;
        }
        case 'pergola': {
            // Four posts, two beams, and rafters across the top.
            const W = it.w, D = it.d || it.w, H = it.y || 9, wood = mk('#8a6a4a');
            for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addMesh(g, GEO.boxBase, wood, [x * (W / 2 - 0.5), 0, z * (D / 2 - 0.5)], [0.5, H, 0.5]);
            for (const z of [-1, 1]) addMesh(g, GEO.boxBase, wood, [0, H - 0.6, z * (D / 2 - 0.5)], [W + 1, 0.6, 0.25]);
            for (let x = -W / 2; x <= W / 2 + 0.01; x += 1.5) addMesh(g, GEO.boxBase, wood, [x, H, 0], [0.2, 0.5, D + 1.5]);
            g.rotation.y = it.rot * Math.PI / 180;
            top = H + 1.5; foot = Math.hypot(W, D) / 2;
            break;
        }
        case 'gazebo': {
            const R = it.w / 2, H = it.y || 10, wood = mk('#c8c0b0');
            addMesh(g, GEO.cylHi, mk('#9a8a74'), [0, 0, 0], [R + 0.3, 0.4, R + 0.3]);
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                addMesh(g, GEO.boxBase, wood, [Math.cos(a) * (R - 0.4), 0.4, Math.sin(a) * (R - 0.4)], [0.35, H - 0.4, 0.35]);
            }
            const roof = new THREE.Mesh(new THREE.ConeGeometry(R + 1.2, R * 0.6 + 1, 8), mk('#5b4a44'));
            rec.geos.push(roof.geometry);
            roof.position.y = H + (R * 0.6 + 1) / 2;
            roof.rotation.y = Math.PI / 8;
            roof.castShadow = true;
            g.add(roof);
            top = H + R * 0.6 + 2; foot = R + 1;
            break;
        }
        case 'deck': {
            // A low platform with board lines on top.
            const W = it.w, D = it.d || it.w * 0.75, H = it.y || 1.5;
            addMesh(g, GEO.boxBase, mk('#9a7a58'), [0, 0, 0], [W, H, D]);
            const lines = [];
            for (let z = -D / 2 + 0.5; z < D / 2; z += 0.5) lines.push(new THREE.Matrix4().compose(new THREE.Vector3(0, H + 0.005, z), new THREE.Quaternion(), new THREE.Vector3(W, 0.01, 0.04)));
            const lm = instanced(GEO.boxBase, mk('#5e4a36'), lines);
            if (lm) g.add(lm);
            g.rotation.y = it.rot * Math.PI / 180;
            top = H + 1.5; foot = Math.hypot(W, D) / 2;
            break;
        }
        case 'wall': {
            const L = it.len, H = it.y || 4, T = it.w || 1;
            addMesh(g, GEO.boxBase, mk('#9a948a'), [0, 0, 0], [L, H, T]);
            addMesh(g, GEO.boxBase, mk('#87817a'), [0, H, 0], [L + 0.2, 0.25, T + 0.2]);
            g.rotation.y = it.rot * Math.PI / 180;
            top = H + 1.5; foot = L / 2;
            break;
        }
        case 'hedge': {
            // A row of overlapping leafy mounds.
            const L = it.len, H = it.y || 6, T = it.w || 4, leaf = mk('#3f5f34');
            const n = Math.max(2, Math.ceil(L / 2.5));
            for (let i = 0; i < n; i++) {
                const x = -L / 2 + (i + 0.5) * (L / n);
                addMesh(g, GEO.ico1, leaf, [x + (rng() - 0.5) * 0.6, H * 0.5, (rng() - 0.5) * 0.4], [L / n * 0.75 + 0.6, H * 0.52, T / 2 * (0.9 + rng() * 0.2)]);
            }
            g.rotation.y = it.rot * Math.PI / 180;
            top = H + 1.5; foot = L / 2;
            break;
        }
        case 'boulder': {
            const W = it.w, D = it.d || it.w * 0.8, H = it.y || W * 0.6;
            addMesh(g, GEO.ico0, stone(), [0, H * 0.32, 0], [W / 2, H / 2, D / 2], [rng(), rng() * 6, rng() * 0.3]);
            top = H + 1; foot = Math.max(W, D) / 2 + 0.3;
            break;
        }
        case 'pot': {
            const R = it.w / 2, H = it.y || 2;
            const pot = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.75, H, 16).translate(0, H / 2, 0), mk('#b0603a'));
            rec.geos.push(pot.geometry);
            pot.castShadow = true;
            g.add(pot);
            addMesh(g, GEO.cylHi, mk('#4a3a2a'), [0, H - 0.12, 0], [R * 0.92, 0.1, R * 0.92]);
            top = H + 1.5; foot = R + 0.5;
            break;
        }
        case 'bench': {
            const L = it.len || 5, wood = mk('#8a6a4a');
            addMesh(g, GEO.boxBase, wood, [0, 1.4, 0], [L, 0.15, 1.3]);
            addMesh(g, GEO.boxBase, wood, [0, 1.55, -0.55], [L, 1.2, 0.12]);
            for (const x of [-1, 1]) addMesh(g, GEO.boxBase, mk('#3a3632'), [x * (L / 2 - 0.4), 0, 0], [0.15, 1.4, 1.1]);
            g.rotation.y = it.rot * Math.PI / 180;
            top = 3.2; foot = L / 2;
            break;
        }
        default: {
            // 'other' (or an unknown type): a simple marker post.
            addMesh(g, GEO.cyl, mk('#8d8676'), [0, 0, 0], [0.4, 1.4, 0.4]);
            top = 2.4; foot = 1.2;
        }
    }
    rec.labelY = top;
    rec.footR = foot;
}

/* ---------- beds / zones ---------- */

/*
 * How each bed surface looks: [texture, base color, how much of the bed's own
 * color to blend in, tile size in feet]. 'tint' is the old see-through look.
 */
const SURFACE_LOOK = {
    mulch: ['mulch', '#7a6248', 0.3, 4], soil: ['soil', '#8a7050', 0.2, 4], gravel: ['gravel', '#b0aca2', 0.1, 3],
    pavers: ['pavers', '#a0644a', 0.08, 4], flagstone: ['flagstone', '#a89c8a', 0.1, 6], lawn: ['grass', '#6f8f3c', 0.1, 6],
    tint: [null, null, 1, 4],
};

/* A bed's corner points, relative to its middle: rectangle, freeform, or a many-sided circle. */
export function zonePoints(it) {
    if (it.shape === 'poly') return it.points;
    if (it.shape === 'circle') {
        const pts = [];
        for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push({ x: Math.cos(a) * it.r, z: Math.sin(a) * it.r }); }
        return pts;
    }
    const w = it.w / 2, d = it.d / 2;
    return [{ x: -w, z: -d }, { x: w, z: -d }, { x: w, z: d }, { x: -w, z: d }];
}

/*
 * A bed, path or surface: its shape filled with the chosen surface, a
 * darker outline, and (if raised) board or stone sides.
 *
 * Every shape is built with ShapeGeometry, whose texture coordinates are in
 * feet, so `repeat = 1 / tile` gives the same texture scale on any bed.
 */
export function buildZone(rec) {
    const it = rec.item, g = rec.body;
    const pts = zonePoints(it);
    const [texKind, base, blend, tile] = SURFACE_LOOK[it.surface] || SURFACE_LOOK.mulch;
    const top = it.raised || 0;
    // Overlapping beds would flicker at the same height, so each gets a hair of its own.
    const lift = 0.02 + (rngFor(it.id)() * 10 | 0) * 0.003;

    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    let fill;
    if (texKind) {
        const tex = groundTexture(texKind).clone();
        tex.repeat.set(1 / tile, 1 / tile);
        tex.needsUpdate = true;
        rec.textures = [tex];
        fill = new THREE.MeshStandardMaterial({ map: tex, color: mixHex(base, it.color, blend), roughness: 1 });
    } else {
        fill = new THREE.MeshBasicMaterial({ color: it.color, transparent: true, opacity: 0.32, depthWrite: false });
    }
    rec.mats.push(fill);
    const plane = new THREE.Mesh(geo, fill);
    plane.position.y = top + lift;
    plane.receiveShadow = true;
    g.add(plane);

    // Raised beds: a board (or stone, for hard surfaces) along each edge.
    if (top > 0) {
        const stone = ['gravel', 'flagstone', 'pavers'].includes(it.surface);
        const sideMat = rec.mk(stone ? '#9a948a' : '#7a5a3e');
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            const len = Math.hypot(q.x - p.x, q.z - p.z);
            const m = addMesh(g, GEO.boxBase, sideMat, [(p.x + q.x) / 2, 0, (p.z + q.z) / 2], [len + 0.17, top, stone ? 0.5 : 0.17]);
            m.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
        }
    }

    const edgeColor = mixHex(it.color, '#1d2520', 0.35);
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 0, p.z))),
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 }));
    outline.raycast = () => {};
    outline.position.y = top + lift + 0.03;
    g.add(outline);
    rec.mats.push(outline.material);
    rec.geos.push(geo, outline.geometry);
    rec.parts.outline = outline;
    rec.parts.edgeColor = edgeColor;
    rec.labelY = top + 0.3;
    let minZ = Infinity, reach = 0;
    for (const p of pts) { minZ = Math.min(minZ, p.z); reach = Math.max(reach, Math.hypot(p.x, p.z)); }
    rec.labelZ = minZ + 1.2;              // labels sit just inside the north edge
    rec.footR = reach;
}

/* Free a record's GPU memory when an item is deleted or rebuilt. */
export function disposeRec(rec) {
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const m of rec.mats) m.dispose();
    for (const g of rec.geos) g.dispose();
    for (const t of rec.textures || []) t.dispose();
    const shared = new Set(Object.values(GEO));
    rec.group.traverse(o => {
        if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
        if (o.isCSS2DObject && o.element) o.element.remove();   // remove the HTML label too
    });
}
