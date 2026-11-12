/*
 * interact.js
 * ---------------------------------------------------------------------------
 * Mouse and touch on the 3D view: click to select, and in "Edit layout"
 * mode drag items around, drag the gold corners to reshape the garden, or
 * drag the corners of a selected freeform bed.
 *
 * How clicking on 3D things works ("raycasting"): turn the pointer's screen
 * position into a ray shooting out of the camera, and ask three.js which
 * meshes the ray passes through. Each item's Group carries its key in
 * userData, so we walk up from the mesh that was hit to find which item it was.
 *
 * OrbitControls (camera movement) listens to the same pointer events. To stop
 * the camera spinning while you drag an item, our pointerdown listener runs
 * in the "capture" phase (before OrbitControls) and calls stopPropagation()
 * when it grabs something.
 */
import { THREE, scene, renderer, camera, itemsRoot, zonesRoot, handleMeshes, buildGround, bounds, requestRender } from './scene.js';
import { recs, select, upsertItem } from './garden.js';
import { S, scheduleUI } from './state.js';
import { $, clamp, toast } from './util.js';
import { toDoc } from './model.js';
import { Store } from './store/index.js';

const stage = $('#stage');
const canvas = renderer.domElement;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();                                    // pointer position, -1…1 across the canvas
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // the flat ground at height 0

let drag = null;        // what's being dragged: { key, rec, off } for an item or { vertex } for a corner
let downAt = null;      // where the pointer went down (to tell a click from a drag)
let lastPointer = null, hoverQueued = false;

const snapHalf = (v) => Math.round(v * 2) / 2;   // positions snap to the nearest half foot

/* ---------- corners of a freeform bed ---------- */
/*
 * When a freeform bed is selected in Edit layout, gold handles appear at its
 * corners. syncZoneHandles() (called on every UI redraw) adds, moves or
 * removes them to match.
 */
const zoneHandleRoot = new THREE.Group();
scene.add(zoneHandleRoot);
const zoneHandleMat = new THREE.MeshBasicMaterial({ color: '#a8740f' });
const zoneHandleGeo = new THREE.IcosahedronGeometry(0.6, 1);
let zoneHandleKey = '';

function selectedPolyZone() {
    if (!S.edit || !S.sel || !S.sel.startsWith('zones:')) return null;
    const zn = S.items.zones.get(S.sel.slice(6));
    return zn && zn.shape === 'poly' ? zn : null;
}

export function syncZoneHandles() {
    const zn = selectedPolyZone();
    const key = zn ? `${zn.id}|${zn.x}|${zn.z}|${zn.raised}|${JSON.stringify(zn.points)}` : '';
    if (key === zoneHandleKey) return;
    zoneHandleKey = key;
    zoneHandleRoot.clear();
    if (!zn) { requestRender(); return; }
    zn.points.forEach((p, i) => {
        const m = new THREE.Mesh(zoneHandleGeo, zoneHandleMat);
        m.position.set(zn.x + p.x, (zn.raised || 0) + 0.35, zn.z + p.z);
        m.userData.zoneVertex = i;
        zoneHandleRoot.add(m);
    });
    requestRender();
}

/* Aim the raycaster from the camera through the pointer. */
function setNdc(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
}

/* Walk up from a hit mesh to the item Group that owns it. */
function keyFromObject(o) {
    while (o) {
        if (o.userData && o.userData.key) return o.userData.key;
        o = o.parent;
    }
    return null;
}

/* Hidden things (planned items switched off, winter leaves) shouldn't be clickable. */
function isShown(o) {
    while (o) {
        if (!o.visible) return false;
        o = o.parent;
    }
    return true;
}

/* Which item is under the pointer? Plants and features first, then beds. */
function pick(ev, includeZones = true) {
    setNdc(ev);
    const hit = raycaster.intersectObjects(itemsRoot.children, true).find(x => keyFromObject(x.object) && isShown(x.object));
    if (hit) return keyFromObject(hit.object);
    if (!includeZones) return null;
    const zoneHit = raycaster.intersectObjects(zonesRoot.children, true).find(x => keyFromObject(x.object) && isShown(x.object));
    return zoneHit ? keyFromObject(zoneHit.object) : null;
}

/* Where the pointer meets the ground, in feet. */
function groundPoint(ev) {
    setNdc(ev);
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}

/* The little "x 12.5 · z 30 ft" tip that follows the pointer while dragging. */
function showTip(ev, text) {
    const tip = $('#dragTip');
    tip.hidden = false;
    tip.textContent = text;
    tip.style.left = (ev.clientX + 14) + 'px';
    tip.style.top = (ev.clientY - 28) + 'px';
}

/* Distance from point (px, pz) to the line segment a–b. */
function segDist(px, pz, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / L2, 0, 1);
    return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    S.dragKey = null;
    stage.classList.remove('dragging');
    $('#dragTip').hidden = true;
    try { canvas.releasePointerCapture(d.pointerId); } catch (e) { /* already released */ }
    if (!d.moved) return;
    if (d.vertex !== undefined) Store.saveMeta();
    else if (d.zoneVertex !== undefined) Store.saveItem(S.items.zones.get(d.zone.id));
    else Store.saveItem(d.rec.item);
    scheduleUI();
}

export function initInteraction() {
    /* Pointer down: maybe start dragging a corner or an item (Edit layout only). */
    stage.addEventListener('pointerdown', (ev) => {
        if (ev.target !== canvas) return;
        downAt = { x: ev.clientX, y: ev.clientY };
        if (!S.edit || !S.meta || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        setNdc(ev);
        const zoneHit = raycaster.intersectObjects(zoneHandleRoot.children);
        const handleHit = raycaster.intersectObjects(handleMeshes);
        if (zoneHit.length && selectedPolyZone()) {
            ev.stopPropagation();          // keep OrbitControls from also reacting
            drag = { zoneVertex: zoneHit[0].object.userData.zoneVertex, zone: selectedPolyZone(), moved: false, pointerId: ev.pointerId };
            S.dragKey = S.sel;
        } else if (handleHit.length) {
            ev.stopPropagation();
            drag = { vertex: handleHit[0].object.userData.vertex, moved: false, pointerId: ev.pointerId };
            S.dragKey = 'outline';
        } else {
            let key = pick(ev, false);
            // Beds are big, so a bed only moves if it's already selected (otherwise you'd grab one by accident).
            if (!key && S.sel && S.sel.startsWith('zones:') && pick(ev, true) === S.sel) key = S.sel;
            if (!key) return;
            const rec = recs.get(key), gp = groundPoint(ev);
            if (!rec || !gp) return;
            ev.stopPropagation();
            drag = { key, rec, off: { x: rec.item.x - gp.x, z: rec.item.z - gp.z }, moved: false, pointerId: ev.pointerId };
            S.dragKey = key;
            select(key);
        }
        stage.classList.add('dragging');
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* pointer already gone */ }
    }, { capture: true });

    /* Pointer move: drag, or (with a mouse) show a pointer cursor over clickable things. */
    canvas.addEventListener('pointermove', (ev) => {
        lastPointer = ev;
        if (drag && drag.zoneVertex !== undefined) {
            const gp = groundPoint(ev);
            if (!gp) return;
            const zn = drag.zone;
            zn.points[drag.zoneVertex] = { x: snapHalf(gp.x) - zn.x, z: snapHalf(gp.z) - zn.z };
            drag.moved = true;
            upsertItem('zones', zn.id, toDoc(zn), { force: true });
            drag.zone = S.items.zones.get(zn.id);
            syncZoneHandles();
            showTip(ev, `corner x ${snapHalf(gp.x).toFixed(1)} · z ${snapHalf(gp.z).toFixed(1)} ft`);
            return;
        }
        if (drag && drag.vertex !== undefined) {
            const gp = groundPoint(ev);
            if (!gp) return;
            const x = snapHalf(gp.x), z = snapHalf(gp.z);
            S.meta.outline[drag.vertex] = { x: clamp(x, -2000, 2000), z: clamp(z, -2000, 2000) };
            drag.moved = true;
            buildGround();
            showTip(ev, `corner x ${x.toFixed(1)} · z ${z.toFixed(1)} ft`);
            return;
        }
        if (drag) {
            const gp = groundPoint(ev);
            if (!gp) return;
            const it = drag.rec.item, b = bounds();
            const pad = Math.max(60, b.w, b.d);    // items may sit a little outside the outline
            it.x = clamp(snapHalf(gp.x + drag.off.x), b.minX - pad, b.maxX + pad);
            it.z = clamp(snapHalf(gp.z + drag.off.z), b.minZ - pad, b.maxZ + pad);
            drag.rec.group.position.set(it.x, 0, it.z);
            drag.moved = true;
            showTip(ev, `x ${it.x.toFixed(1)} · z ${it.z.toFixed(1)} ft`);
            requestRender();
            return;
        }
        if (ev.pointerType === 'mouse' && !hoverQueued) {
            hoverQueued = true;
            requestAnimationFrame(() => {
                hoverQueued = false;
                if (!lastPointer || drag) return;
                const key = pick(lastPointer, S.edit);
                stage.classList.toggle('pointing', !!key && !S.edit);
                stage.classList.toggle('grab', !!key && S.edit);
            });
        }
    });

    /* Pointer up: finish a drag, or treat a short tap as a click that selects. */
    canvas.addEventListener('pointerup', (ev) => {
        const wasDrag = drag && drag.moved;
        endDrag();
        if (wasDrag || !downAt) return;
        const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
        downAt = null;
        if (moved > 6) return;              // the camera was being moved, not a click
        select(pick(ev, true));
    });
    canvas.addEventListener('pointercancel', endDrag);

    /*
     * Double-click in Edit layout: on a corner removes it; near an edge adds a
     * new corner there.
     */
    stage.addEventListener('dblclick', (ev) => {
        if (!S.edit || !S.meta || ev.target !== canvas) return;
        setNdc(ev);
        // A selected freeform bed: remove a corner, or add one on the nearest edge.
        const zn = selectedPolyZone();
        if (zn) {
            const pts = zn.points.map(p => ({ x: p.x + zn.x, z: p.z + zn.z }));
            const hit = raycaster.intersectObjects(zoneHandleRoot.children);
            let changed = false;
            if (hit.length) {
                if (pts.length <= 3) { toast('A bed needs at least 3 corners.'); return; }
                zn.points.splice(hit[0].object.userData.zoneVertex, 1);
                changed = true;
            } else {
                const gp = groundPoint(ev);
                if (gp) {
                    let best = -1, bestDist = Infinity;
                    pts.forEach((p, i) => {
                        const d = segDist(gp.x, gp.z, p, pts[(i + 1) % pts.length]);
                        if (d < bestDist) { bestDist = d; best = i; }
                    });
                    if (bestDist <= 2) {
                        zn.points.splice(best + 1, 0, { x: snapHalf(gp.x) - zn.x, z: snapHalf(gp.z) - zn.z });
                        changed = true;
                    }
                }
            }
            if (changed) {
                upsertItem('zones', zn.id, toDoc(zn), { force: true });
                Store.saveItem(S.items.zones.get(zn.id));
                syncZoneHandles();
                scheduleUI();
                return;
            }
        }
        const o = S.meta.outline;
        const handleHit = raycaster.intersectObjects(handleMeshes);
        if (handleHit.length) {
            if (o.length <= 3) { toast('The outline needs at least 3 corners.'); return; }
            o.splice(handleHit[0].object.userData.vertex, 1);
        } else {
            const gp = groundPoint(ev);
            if (!gp) return;
            let best = -1, bestDist = Infinity;
            o.forEach((p, i) => {
                const d = segDist(gp.x, gp.z, p, o[(i + 1) % o.length]);
                if (d < bestDist) { bestDist = d; best = i; }
            });
            if (bestDist > 3) return;        // too far from any edge
            o.splice(best + 1, 0, { x: snapHalf(gp.x), z: snapHalf(gp.z) });
        }
        buildGround();
        Store.saveMeta();
        scheduleUI();
    }, { capture: true });
}
