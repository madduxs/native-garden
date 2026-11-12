/*
 * flora/textures.js
 * ---------------------------------------------------------------------------
 * Pictures painted in code (on an off-screen <canvas>) and used as textures:
 *
 *   leafCard('broad' | 'fine' | 'needle')   a spray of leaves on a transparent background
 *   groundTexture(kind)   tileable ground: 'grass', 'soil', 'mulch', 'gravel', 'pavers', 'flagstone'
 *
 * Why paint them instead of loading image files? No downloads, no licensing
 * questions, and they're easy to tweak right here.
 *
 * They're painted in shades of grey on purpose: the material's color tints
 * them, so one leaf texture serves every plant, and leaves can turn from
 * green to fall red just by changing the material color.
 *
 * Trees and shrubs are built from many "leaf cards": flat squares showing a
 * spray of leaves, turned every which way. With the see-through parts cut out
 * (alphaTest), a few hundred cards read as a full, leafy canopy for very
 * little drawing work. Games use the same trick.
 */
import * as THREE from 'three';
import { rngFor } from '../util.js';

const cache = new Map();

function canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')];
}

function toTexture(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

/* One leaf: a pointed oval along the +x axis, with a darker midrib. */
function drawLeaf(g, x, y, angle, len, wid, shade) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, grey(shade * 0.78));
    grad.addColorStop(0.6, grey(shade));
    grad.addColorStop(1, grey(shade * 0.92));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.8, len, 0);
    g.bezierCurveTo(len * 0.75, wid * 0.8, len * 0.3, wid, 0, 0);
    g.fill();
    g.strokeStyle = grey(shade * 0.62, 0.7);
    g.lineWidth = Math.max(1, wid * 0.08);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.92, 0);
    g.stroke();
    g.restore();
}

/*
 * A leaf card. 'broad' for most trees and shrubs, 'fine' for small-leaflet
 * compound leaves (honey locust, coffeetree), 'needle' for conifers.
 */
export function leafCard(kind = 'broad') {
    const key = `card:${kind}`;
    if (cache.has(key)) return cache.get(key);
    const S = 256, [c, g] = canvas(S);
    const rnd = rngFor(key);
    g.clearRect(0, 0, S, S);
    g.lineCap = 'round';
    if (kind === 'needle') {
        // Branchlets with short needles bristling along them.
        for (let b = 0; b < 11; b++) {
            const a0 = rnd() * Math.PI * 2, len = 75 + rnd() * 45;
            const x0 = S / 2 + Math.cos(a0) * 10, y0 = S / 2 + Math.sin(a0) * 10;
            for (let i = 0; i < 46; i++) {
                const t = i / 46, x = x0 + Math.cos(a0) * len * t, y = y0 + Math.sin(a0) * len * t;
                for (const side of [-1, 1]) {
                    const na = a0 + side * (0.9 + rnd() * 0.4), nl = 11 + rnd() * 8;
                    g.strokeStyle = grey(150 + rnd() * 100);
                    g.lineWidth = 3;
                    g.beginPath();
                    g.moveTo(x, y);
                    g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl);
                    g.stroke();
                }
            }
        }
    } else if (kind === 'fine') {
        // Feathery compound leaves: a stalk with many small leaflets.
        for (let b = 0; b < 9; b++) {
            const a0 = rnd() * Math.PI * 2, len = 60 + rnd() * 55;
            const x0 = S / 2 + Math.cos(a0) * 12, y0 = S / 2 + Math.sin(a0) * 12;
            for (let i = 0; i < 12; i++) {
                const t = (i + 0.5) / 12, x = x0 + Math.cos(a0) * len * t, y = y0 + Math.sin(a0) * len * t;
                for (const side of [-1, 1]) drawLeaf(g, x, y, a0 + side * 1.25, 13 + rnd() * 5, 4.5, 170 + rnd() * 85);
            }
        }
    } else {
        // Broad leaves fanned out from the middle, with a few in front of others.
        g.strokeStyle = grey(120, 0.8);
        g.lineWidth = 3;
        for (let i = 0; i < 26; i++) {
            const a = rnd() * Math.PI * 2, r = 10 + rnd() * 80;
            const x = S / 2 + Math.cos(a) * r * 0.55, y = S / 2 + Math.sin(a) * r * 0.55;
            drawLeaf(g, x, y, a + (rnd() - 0.5) * 0.8, 52 + rnd() * 36, 17 + rnd() * 10, 160 + rnd() * 95);
        }
    }
    const t = toTexture(c, false);
    cache.set(key, t);
    return t;
}

/*
 * Tileable ground. Strokes that cross an edge are drawn again on the far side,
 * so the tiles join without seams.
 */
export function groundTexture(kind) {
    const key = `ground:${kind}`;
    if (cache.has(key)) return cache.get(key);
    const S = 512, [c, g] = canvas(S);
    const rnd = rngFor(key);
    // Draw fn() at (x, y), plus copies on the opposite edges when it's within m pixels of one.
    const wrap = (x, y, m, fn) => {
        const xs = [0], ys = [0];
        if (x < m) xs.push(S); else if (x > S - m) xs.push(-S);
        if (y < m) ys.push(S); else if (y > S - m) ys.push(-S);
        for (const dx of xs) for (const dy of ys) {
            if (dx || dy) { g.save(); g.translate(dx, dy); fn(); g.restore(); } else fn();
        }
    };
    g.lineCap = 'round';
    if (kind === 'grass') {
        g.fillStyle = grey(190);
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 40; i++) {       // soft light and dark patches
            const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 70, v = 175 + rnd() * 70;
            wrap(x, y, r, () => {
                const grad = g.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, grey(v, 0.35));
                grad.addColorStop(1, grey(v, 0));
                g.fillStyle = grad;
                g.fillRect(x - r, y - r, r * 2, r * 2);
            });
        }
        for (let i = 0; i < 9000; i++) {     // blades seen from above
            const x = rnd() * S, y = rnd() * S, a = -Math.PI / 2 + (rnd() - 0.5) * 1.6, l = 4 + rnd() * 9;
            const v = 140 + rnd() * 115;
            wrap(x, y, l, () => {
                g.strokeStyle = grey(v, 0.75);
                g.lineWidth = 1.3;
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
                g.stroke();
            });
        }
    } else if (kind === 'mulch') {
        g.fillStyle = grey(150);
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 5000; i++) {     // shredded bark
            const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 6 + rnd() * 16, v = 90 + rnd() * 150;
            const w = 2 + rnd() * 2.5;
            wrap(x, y, l, () => {
                g.strokeStyle = grey(v, 0.9);
                g.lineWidth = w;
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
                g.stroke();
            });
        }
    } else if (kind === 'gravel') {
        g.fillStyle = grey(150);
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 7000; i++) {     // pebbles, each with a little shadow under it
            const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 3.5, v = 120 + rnd() * 125, rot = rnd() * 3;
            wrap(x, y, r + 2, () => {
                g.fillStyle = grey(90, 0.5);
                g.beginPath(); g.ellipse(x + 1, y + 1.2, r, r * 0.75, rot, 0, Math.PI * 2); g.fill();
                g.fillStyle = grey(v);
                g.beginPath(); g.ellipse(x, y, r, r * 0.75, rot, 0, Math.PI * 2); g.fill();
            });
        }
    } else if (kind === 'pavers') {
        // Running-bond bricks: 8 per row, every other row shifted half a brick. 512 / 64 tiles exactly.
        g.fillStyle = grey(215);             // mortar
        g.fillRect(0, 0, S, S);
        const bw = 64, bh = 32;
        for (let row = 0; row < S / bh; row++) {
            for (let k = -1; k <= S / bw; k++) {
                const x = k * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = 150 + rnd() * 60;
                g.fillStyle = grey(v);
                g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
                for (let n = 0; n < 25; n++) {          // a little speckle in each brick
                    g.fillStyle = grey(v + (rnd() - 0.5) * 50, 0.6);
                    g.fillRect(x + 3 + rnd() * (bw - 8), y + 3 + rnd() * (bh - 8), 2, 2);
                }
            }
        }
    } else if (kind === 'flagstone') {
        // Irregular stones from a jittered 4×4 grid. Corner points wrap around, so tiles join.
        g.fillStyle = grey(105);             // soil between the stones
        g.fillRect(0, 0, S, S);
        const N = 4, cell = S / N, pts = [];
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([(rnd() - 0.5) * cell * 0.45, (rnd() - 0.5) * cell * 0.45]);
        const corner = (i, j) => {
            const p = pts[((j % N) + N) % N * N + ((i % N) + N) % N];
            return [i * cell + p[0], j * cell + p[1]];
        };
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const c = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
                const cx = c.reduce((a, p) => a + p[0], 0) / 4, cy = c.reduce((a, p) => a + p[1], 0) / 4;
                const v = 165 + rnd() * 70;
                for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
                    g.fillStyle = grey(v);
                    g.beginPath();
                    c.forEach(([x, y], k) => {
                        const px = cx + (x - cx) * 0.9 + dx, py = cy + (y - cy) * 0.9 + dy;
                        if (k) g.lineTo(px, py); else g.moveTo(px, py);
                    });
                    g.closePath();
                    g.fill();
                }
            }
        }
    } else {
        g.fillStyle = grey(196);             // bare soil with grit and pebbles
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 9000; i++) {
            const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 1.6, v = 120 + rnd() * 135;
            wrap(x, y, 3, () => { g.fillStyle = grey(v, 0.8); g.fillRect(x, y, r, r); });
        }
        for (let i = 0; i < 160; i++) {
            const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 4, v = 210 + rnd() * 45, rot = rnd() * 3;
            wrap(x, y, r, () => { g.fillStyle = grey(v); g.beginPath(); g.ellipse(x, y, r, r * 0.7, rot, 0, Math.PI * 2); g.fill(); });
        }
    }
    const t = toTexture(c, true);
    cache.set(key, t);
    return t;
}
