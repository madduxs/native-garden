/*
 * scene.js
 * ---------------------------------------------------------------------------
 * The 3D world: the renderer, camera, lights, the ground, and the camera
 * views (3D, Plan, Eye level). It doesn't know about individual plants;
 * builders.js makes those and garden.js adds them to `itemsRoot`.
 *
 * Three.js in two minutes:
 *   - A Scene is a tree of objects (Groups and Meshes).
 *   - A Mesh = a Geometry (the shape) + a Material (the color/surface).
 *   - A Camera looks at the scene; the Renderer draws what it sees onto
 *     a <canvas>.
 *   - Objects have .position, .rotation and .scale. A Group moves everything
 *     inside it together.
 *   - Units here are FEET. Y is up. X runs east, Z runs south.
 *
 * We only redraw when something changed (requestRender), which keeps phones
 * cool and batteries happy. The exception is wind: while plants sway, the
 * loop draws about 30 times a second.
 *
 * Lighting: a sky (three.js's Sky shader, a physical model of daylight)
 * doubles as the "environment" light, so everything is lit softly by the sky
 * color from all directions, plus a sun that casts shadows. Tone mapping
 * (ACES Filmic) squeezes the bright sky and dark shadows into what a screen
 * can show, the way a camera does.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { S } from './state.js';
import { $, h, clamp, mixHex, rngFor, reduceMotion } from './util.js';
import { KINDS, outlineBounds } from './model.js';
import { groundTexture } from './flora/textures.js';
import { sunDirection } from './sunpath.js';
import { bladeGeometry } from './flora/geometry.js';
import { wind, windify } from './flora/wind.js';

export { THREE, CSS2DObject };

/* ---------- how much detail this device gets ---------- */

/*
 * Phones and computers with few processor cores get fewer leaves and flowers,
 * smaller shadow maps and no wind by default. Change `density` here to trade
 * looks for speed everywhere (1 = full detail).
 */
const lowEnd = window.innerWidth <= 760 || (navigator.hardwareConcurrency || 4) <= 4 || /Mobi|Android/i.test(navigator.userAgent);
export const QUALITY = lowEnd
    ? { name: 'low', density: 0.55, shadow: 1024, pixelRatio: 1.5 }
    : { name: 'high', density: 1, shadow: 2048, pixelRatio: 2 };
if (S.wind === null) S.wind = !lowEnd && !reduceMotion;

/* ---------- renderer, labels, scene, camera ---------- */

const stage = $('#stage');

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
stage.appendChild(renderer.domElement);

/* Plant names are ordinary HTML elements that CSS2DRenderer keeps positioned over the 3D scene. */
export const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'labels' + (S.labels ? '' : ' off');
stage.appendChild(labelRenderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#c3d2d9', 220, 520);     // far things fade into the haze near the horizon
scene.environmentIntensity = 0.38;                  // how strongly the sky lights things from all around

/* 42° field of view; near/far clipping planes in feet. */
export const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.3, 4000);

/* A little extra light from the sky above and the ground below, plus a "sun" that casts shadows. */
const hemi = new THREE.HemisphereLight('#dfe9f0', '#6b5a40', 0.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

/*
 * The sky. A second copy in its own little scene is photographed into an
 * "environment map" (PMREM) whenever the sun moves, which is what lights the
 * plants softly from every direction.
 */
const sky = new Sky();
sky.scale.setScalar(3000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 6;          // haze
skyU.rayleigh.value = 1.3;         // blueness
skyU.mieCoefficient.value = 0.004;
skyU.mieDirectionalG.value = 0.82; // glow around the sun
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.material = sky.material;
envSky.scale.setScalar(900);
envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget = null;
function updateSky(sunDir) {
    skyU.sunPosition.value.copy(sunDir);
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = envTarget.texture;
}

/*
 * Shared shapes. Every plant reuses these few geometries, scaled and placed,
 * instead of making new ones; that keeps memory use low. Most are "unit"
 * shapes (size 1) so .scale sets their size in feet directly.
 * `.translate(0, 0.5, 0)` moves a shape so it sits ON the ground instead of
 * being centered on it.
 */
export const GEO = {
    cyl: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),     // 6-sided: stems, posts
    cylHi: new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0),  // smoother: discs, mulch
    ico0: new THREE.IcosahedronGeometry(1, 0),                             // chunky: flowers, stones
    ico1: new THREE.IcosahedronGeometry(1, 1),                             // rounder: leaf clumps
    ico2: new THREE.IcosahedronGeometry(1, 2),                             // smooth: mature-size shells
    cone: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0),           // grass blades, wildflower stems
    box: new THREE.BoxGeometry(1, 1, 1),
    boxBase: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),         // boards and boxes that sit on the ground
};

/* Plants and features go in itemsRoot; beds go in zonesRoot (so clicks can prefer plants). */
export const itemsRoot = new THREE.Group();
export const zonesRoot = new THREE.Group();
scene.add(itemsRoot, zonesRoot);

/* ---------- the ground ---------- */

const groundRoot = new THREE.Group();
scene.add(groundRoot);

/*
 * The land around the garden: one big flat plane (1×1, scaled to size in
 * fitScene) with a grassy texture tinted by season.
 */
const grassTex = groundTexture('grass');
const pastureMat = new THREE.MeshStandardMaterial({ color: '#b3a274', map: grassTex, roughness: 1 });
const pasture = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), pastureMat);
pasture.position.y = -0.02;       // a hair below the garden so they don't flicker against each other
pasture.receiveShadow = true;
groundRoot.add(pasture);

/*
 * The garden's own ground, cut to its outline: soil. ShapeGeometry's texture
 * coordinates are in feet, so repeat 0.25 makes the soil texture tile every 4 ft.
 */
const soilTex = groundTexture('soil').clone();
soilTex.repeat.set(0.25, 0.25);
soilTex.needsUpdate = true;
const gardenMat = new THREE.MeshStandardMaterial({ color: '#a3906a', map: soilTex, roughness: 1, side: THREE.DoubleSide });
const gardenGround = new THREE.Mesh(new THREE.BufferGeometry(), gardenMat);
gardenGround.receiveShadow = true;
gardenGround.raycast = () => {};  // clicks pass through the ground to whatever we test next
groundRoot.add(gardenGround);

const gridMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28 });
const borderMat = new THREE.LineBasicMaterial({ color: '#4a3f2e', transparent: true, opacity: 0.75 });
const handleMat = new THREE.MeshBasicMaterial({ color: '#a8740f' });
let grid = null, border = null, northLabel = null;

/* Edit mode shows gold corner handles and side lengths; they live in editRoot. */
const editRoot = new THREE.Group();
editRoot.visible = false;
groundRoot.add(editRoot);
export const handleMeshes = [];   // the corner handles, for click testing in interact.js

/* The garden outline's bounding box (see outlineBounds in model.js). */
export function bounds() {
    return outlineBounds(S.meta ? S.meta.outline : [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }]);
}

/*
 * Where does the line x = v (axis 'x') or z = v (axis 'z') cross the inside of
 * the outline? Returns [start, end] pieces. Used to draw the 10-ft grid only
 * inside odd-shaped gardens. (Classic "even–odd" polygon scan.)
 */
function clipLine(poly, axis, v) {
    const hits = [];
    for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        const a1 = axis === 'x' ? p1.x : p1.z, a2 = axis === 'x' ? p2.x : p2.z;
        if ((a1 <= v && a2 > v) || (a2 <= v && a1 > v)) {
            const t = (v - a1) / (a2 - a1);
            hits.push(axis === 'x' ? p1.z + t * (p2.z - p1.z) : p1.x + t * (p2.x - p1.x));
        }
    }
    hits.sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i + 1 < hits.length; i += 2) segments.push([hits[i], hits[i + 1]]);
    return segments;
}

/* Is the point (x, z) inside the outline? (Count edge crossings: odd = inside.) */
export function insideOutline(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}

/*
 * A band of meadow grass around the garden: thousands of blades in one
 * InstancedMesh (one draw), thinning out with distance. Purely scenery.
 */
const meadowMat = windify(new THREE.MeshStandardMaterial({ color: '#9aa05a', roughness: 0.9, side: THREE.DoubleSide }), 1.3);
let meadow = null;
function buildMeadow(b, outline) {
    if (meadow) { groundRoot.remove(meadow); meadow.dispose(); }
    const rng = rngFor('meadow');
    const band = 26;
    const x0 = b.minX - band, x1 = b.maxX + band, z0 = b.minZ - band, z1 = b.maxZ + band;
    const target = Math.round(clamp(((x1 - x0) * (z1 - z0) - b.w * b.d) * 0.6 * QUALITY.density, 1500, 16000));
    const mats = [];
    const UPV = new THREE.Vector3(0, 1, 0), XV = new THREE.Vector3(1, 0, 0);
    for (let tries = 0; mats.length < target && tries < target * 4; tries++) {
        const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0);
        const dist = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
        if (dist === 0 && insideOutline(x, z, outline)) continue;
        if (rng() < dist / band) continue;
        const ht = 0.35 + rng() * 0.9;
        const q = new THREE.Quaternion().setFromAxisAngle(UPV, rng() * Math.PI * 2).multiply(new THREE.Quaternion().setFromAxisAngle(XV, 0.1 + rng() * 0.6));
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(0.06, ht, ht)));
    }
    meadow = new THREE.InstancedMesh(bladeGeometry(false), meadowMat, mats.length);
    mats.forEach((m, i) => {
        meadow.setMatrixAt(i, m);
        const v = 0.75 + rng() * 0.45;
        meadow.setColorAt(i, new THREE.Color(v, v * (0.95 + rng() * 0.1), v * 0.9));
    });
    meadow.receiveShadow = true;
    meadow.raycast = () => {};
    meadow.computeBoundingSphere();
    groundRoot.add(meadow);
}

/*
 * (Re)build the ground from the current outline: the dirt shape, the 10-ft grid,
 * the border line, the "N ↑" marker, and the edit handles. Called when a garden
 * opens and whenever a corner is moved.
 */
export function buildGround() {
    if (!S.meta) return;
    const o = S.meta.outline, b = bounds();

    // THREE.Shape works in 2D (x, y). We draw in (x, -z) then tip it flat onto the ground.
    const shape = new THREE.Shape(o.map(p => new THREE.Vector2(p.x, -p.z)));
    gardenGround.geometry.dispose();
    gardenGround.geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);

    if (grid) { groundRoot.remove(grid); grid.geometry.dispose(); }
    if (border) { groundRoot.remove(border); border.geometry.dispose(); }
    const pts = [];
    for (let x = Math.ceil(b.minX / 10) * 10; x <= b.maxX + 0.01; x += 10) {
        for (const [z1, z2] of clipLine(o, 'x', x)) pts.push(x, 0.04, z1, x, 0.04, z2);
    }
    for (let z = Math.ceil(b.minZ / 10) * 10; z <= b.maxZ + 0.01; z += 10) {
        for (const [x1, x2] of clipLine(o, 'z', z)) pts.push(x1, 0.04, z, x2, 0.04, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.raycast = () => {};
    groundRoot.add(grid);

    border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(o.map(p => new THREE.Vector3(p.x, 0.06, p.z))), borderMat);
    border.raycast = () => {};
    groundRoot.add(border);

    if (northLabel) groundRoot.remove(northLabel);
    northLabel = new CSS2DObject(h('div', { class: 'lbl axis', text: 'N ↑' }));
    northLabel.position.set(b.cx, 0.2, b.minZ - 5);
    groundRoot.add(northLabel);

    // Edit-mode handles at each corner, and each side's length in feet.
    for (const child of [...editRoot.children]) editRoot.remove(child);
    handleMeshes.length = 0;
    o.forEach((p, i) => {
        const m = new THREE.Mesh(GEO.ico1, handleMat);
        m.position.set(p.x, 0.35, p.z);
        m.scale.setScalar(0.75);
        m.userData.vertex = i;            // which corner this is
        editRoot.add(m);
        handleMeshes.push(m);
        const q = o[(i + 1) % o.length];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        const tag = new CSS2DObject(h('div', { class: 'lbl axis', text: `${len.toFixed(len < 10 ? 1 : 0)} ft` }));
        tag.position.set((p.x + q.x) / 2, 0.3, (p.z + q.z) / 2);
        editRoot.add(tag);
    });

    buildMeadow(b, o);
    fitScene(b);
}

/*
 * Gardens come in all sizes, so scale the surroundings to match: the pasture,
 * the fog distance, the shadow area and how far the camera may zoom out.
 */
function fitScene(b) {
    const size = Math.max(b.w, b.d, 40);
    const pw = Math.max(520, size * 5), pd = Math.max(420, size * 4);
    pasture.scale.set(pw, 1, pd);
    pasture.position.set(b.cx, -0.02, b.cz);
    grassTex.repeat.set(pw / 10, pd / 10);          // one grass tile per 10 ft
    scene.fog.near = Math.max(220, size * 2.2);
    scene.fog.far = Math.max(520, size * 5.2);
    const ext = Math.max(60, Math.hypot(b.w, b.d) * 0.7);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: Math.max(500, size * 6) });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(b.cx, 0, b.cz);
    controls.maxDistance = Math.max(420, size * 4.2);
    sun.userData.dist = Math.max(220, size * 2.2);
    seasonGround(S.month);
}

/* Pasture color through the year, Jan → Dec (northern hemisphere). */
const PASTURE = ['#b8a479', '#b6a378', '#ada56f', '#9fa863', '#8b9c55', '#869a52', '#8d9a55', '#949a58', '#979b5b', '#a49e64', '#b1a172', '#b6a377'];

/*
 * Season the ground for month m: grass color, and where the sun is for the
 * garden's latitude at the chosen time of day (S.hour, "sun time"; see
 * sunpath.js). Higher in summer, lower in winter, so shadows change through
 * the year. South of the equator the seasons flip.
 */
let skyKey = '';
export function seasonGround(m) {
    const lat = S.meta?.place?.lat ?? 36;
    const seasonal = lat < 0 ? ((m + 5) % 12) : m - 1;
    pastureMat.color.set(PASTURE[seasonal]);
    meadowMat.color.set(mixHex(PASTURE[seasonal], '#5e6a30', 0.25));
    gardenMat.color.set(mixHex(PASTURE[seasonal], '#9c7a5c', 0.55));
    const dir = sunDirection(lat, m, S.hour);
    // Before sunrise or after sunset, keep a low sun just above the horizon
    // (so the garden doesn't go black) and dim it.
    const minEl = 3 * Math.PI / 180;
    let el = dir.elevation * Math.PI / 180;
    const set = el < minEl;
    if (set) el = minEl;
    const az = dir.azimuth * Math.PI / 180;
    const D = sun.userData.dist || 220;
    const t = sun.target.position;
    sun.position.set(
        t.x + Math.sin(az) * Math.cos(el) * D,
        Math.sin(el) * D,
        t.z - Math.cos(az) * Math.cos(el) * D,
    );
    // Low sun is weaker and warmer; high sun is strong and whiter.
    const high = Math.sin(el);
    sun.intensity = set ? 0.6 : 1.4 + high * 1.8;
    sun.color.set(mixHex('#ffb877', '#fff1dc', Math.min(1, high * 2.2)));
    // Re-photograph the sky only when the sun has actually moved.
    const key = `${m}|${lat.toFixed(1)}|${S.hour}`;
    if (key !== skyKey) {
        skyKey = key;
        updateSky(sun.position.clone().sub(t).normalize());
    }
    requestRender();
}

/* Edit mode: brighter grid, corner handles visible. */
export function setEditVisuals(on) {
    gridMat.opacity = on ? 0.55 : 0.28;
    editRoot.visible = on;
    requestRender();
}

export function setLabelsVisible(on) {
    labelRenderer.domElement.classList.toggle('off', !on);
    requestRender();
}

/* ---------- camera and views ---------- */

/*
 * OrbitControls lets people drag to orbit, pinch/scroll to zoom, and
 * right-drag (or two-finger drag) to pan.
 */
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;            // a little glide after letting go
controls.dampingFactor = 0.09;
controls.maxPolarAngle = Math.PI / 2 - 0.04;   // never look up from under the ground
controls.minDistance = 3;
controls.maxDistance = 420;
controls.screenSpacePanning = false;      // panning slides along the ground
controls.addEventListener('change', () => requestRender());

/*
 * The side panel and top bar cover part of the canvas. setViewOffset shifts
 * the picture so the garden is centered in the part you can actually see.
 */
const obstruct = { left: 0, top: 0, bottom: 0 };
export function measureObstruct() {
    const W = window.innerWidth, H = window.innerHeight;
    const topbar = $('#topbar'), side = $('#side'), toolbar = $('#toolbar');
    const appVisible = !document.body.classList.contains('no-garden');   // panels are hidden when no garden is open
    obstruct.top = appVisible && topbar ? topbar.getBoundingClientRect().bottom : 0;
    if (!appVisible) { obstruct.left = 0; obstruct.bottom = 0; }
    else if (W > 760) { obstruct.left = side ? side.getBoundingClientRect().right : 0; obstruct.bottom = 64; }
    else { obstruct.left = 0; obstruct.bottom = Math.max(60, H - (toolbar ? toolbar.getBoundingClientRect().top : H) + 6); }
    const dx = obstruct.left / 2, dy = (obstruct.top - obstruct.bottom) / 2;
    camera.setViewOffset(W, H, -dx, -dy, W, H);
    camera.updateProjectionMatrix();
    requestRender();
}

/* The size of the uncovered part of the screen, in pixels. */
function freeArea() {
    return {
        w: Math.max(160, window.innerWidth - obstruct.left - 16),
        h: Math.max(120, window.innerHeight - obstruct.top - obstruct.bottom),
    };
}

/* The area the camera should frame: the outline plus anything placed outside it. */
function viewBounds() {
    let { minX, maxX, minZ, maxZ } = bounds();
    for (const kind of KINDS) {
        for (const it of S.items[kind].values()) {
            minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x);
            minZ = Math.min(minZ, it.z); maxZ = Math.max(maxZ, it.z);
        }
    }
    return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/* Where the camera sits and what it looks at, for each named view. */
function viewPose(view) {
    const b = viewBounds();
    const W = Math.max(20, b.w), D = Math.max(20, b.d);
    const fa = freeArea(), aspect = fa.w / fa.h;
    // Back off further on tall, narrow screens (phones) so the whole garden fits.
    const k = (aspect < 1 ? 1.7 : aspect < 1.4 ? 1.2 : 1) * Math.max(W / 100, D / 50, 0.6) * 1.15;
    if (view === 'plan') {
        // Straight down, high enough that the garden fills the open area.
        const vfov = camera.fov * Math.PI / 180;
        const feetPerPixel = Math.max(D * 1.12 / fa.h, W * 1.06 / fa.w);
        const dist = feetPerPixel * window.innerHeight / (2 * Math.tan(vfov / 2));
        return { pos: new THREE.Vector3(b.cx, dist, b.cz + 0.01), target: new THREE.Vector3(b.cx, 0, b.cz) };
    }
    if (view === 'eye') {
        // Standing at the south edge, eyes 5.5 ft up, looking north into the garden.
        return { pos: new THREE.Vector3(b.cx + 4, 5.5, b.maxZ + 16), target: new THREE.Vector3(b.cx, 4, b.minZ + D * 0.35) };
    }
    // 3D: up and to the southeast, looking down at the middle.
    return { pos: new THREE.Vector3(b.cx + 46 * k, 56 * k, b.cz + 82 * k), target: new THREE.Vector3(b.cx, 2, b.cz) };
}

/* Switch camera view. In Plan view, dragging pans instead of rotating. */
export function setView(view, instant = false) {
    S.view = view;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    controls.enableRotate = view !== 'plan';
    controls.mouseButtons.LEFT = view === 'plan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = view === 'plan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    const p = viewPose(view);
    animateCam(p.pos, p.target, instant);
}

/* Glide the camera to a new spot over 0.7 s (or jump, if asked or if motion is reduced). */
let anim = null;
export function animateCam(pos, target, instant = false) {
    if (instant || reduceMotion) {
        anim = null;
        camera.position.copy(pos);
        controls.target.copy(target);
        controls.update();
        requestRender();
        return;
    }
    anim = { p0: camera.position.clone(), t0: controls.target.clone(), pos, target, start: performance.now(), ms: 700 };
}

/* Fly in to look at one item (rec comes from garden.js). */
export function flyToRec(rec) {
    const it = rec.item;
    const r = Math.max(6, rec.footR * 2.6, (rec.labelY || 4) * 1.6);
    const target = new THREE.Vector3(it.x, Math.min(rec.labelY * 0.4, 8), it.z);
    if (S.view === 'plan') {
        animateCam(new THREE.Vector3(it.x, Math.max(r * 2.2, 30), it.z + 0.01), new THREE.Vector3(it.x, 0, it.z));
        return;
    }
    const dir = camera.position.clone().sub(controls.target);   // keep looking from the same side
    if (dir.lengthSq() < 1) dir.set(0, 1, 1);
    dir.normalize();
    if (dir.y < 0.3) { dir.y = 0.3; dir.normalize(); }
    animateCam(target.clone().add(dir.multiplyScalar(r * 2.2)), target);
}

/* The ground point in the middle of the view (new items land here). */
export function viewCenter() {
    const b = bounds();
    const snap = (v) => Math.round(v * 2) / 2;      // to the nearest half foot
    return { x: snap(clamp(controls.target.x, b.minX, b.maxX)), z: snap(clamp(controls.target.z, b.minZ, b.maxZ)) };
}

/* ---------- drawing ---------- */

let needsRender = true;
let lastWind = 0;

/* Ask for one redraw on the next frame. Cheap to call often. */
export function requestRender() { needsRender = true; }

/* Wind on/off (the Wind button). */
export function setWind(on) {
    S.wind = on;
    wind.uniforms.uWind.value = on ? 1 : 0;
    requestRender();
}

/*
 * The animation loop runs every frame (~60 times a second) but only draws
 * when something changed: a camera glide, OrbitControls still settling, or
 * a requestRender() call.
 */
function loop(now) {
    requestAnimationFrame(loop);
    let changed = false;
    if (anim) {
        const t = clamp((now - anim.start) / anim.ms, 0, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // slow–fast–slow
        camera.position.lerpVectors(anim.p0, anim.pos, ease);
        controls.target.lerpVectors(anim.t0, anim.target, ease);
        if (t >= 1) anim = null;
        changed = true;
    }
    if (controls.update()) changed = true;
    // While the wind blows, advance its clock and redraw about 30 times a second.
    if (S.wind && !document.hidden && now - lastWind >= 33) {
        wind.uniforms.uTime.value += Math.min(0.1, (now - lastWind) / 1000);
        lastWind = now;
        changed = true;
    }
    if (needsRender || changed) {
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
        needsRender = false;
    }
}

export function startLoop() {
    wind.uniforms.uWind.value = S.wind ? 1 : 0;
    requestAnimationFrame(loop);
}

/* Keep everything the right size when the window changes. */
export function onResize() {
    const w = window.innerWidth, hgt = window.innerHeight;
    camera.aspect = w / hgt;
    renderer.setSize(w, hgt);
    labelRenderer.setSize(w, hgt);
    measureObstruct();
}
