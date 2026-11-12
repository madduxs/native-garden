/*
 * util.js
 * ---------------------------------------------------------------------------
 * Small helper functions used all over the app. None of them know anything
 * about gardens; they're general tools (building HTML, checking numbers,
 * month math, fetching JSON). Every other module imports from here.
 */

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MSHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* True if the person has asked their device for less animation. We respect it. */
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- DOM helpers ---------- */

/* $('#id') is shorthand for document.querySelector('#id'). */
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/*
 * h() builds an HTML element in one call, so UI code reads like the HTML it makes.
 *
 *   h('button', { class: 'btn', onclick: save }, 'Save')
 *   → <button class="btn">Save</button> with a click handler attached
 *
 * attrs:  class, text (sets textContent), style, on<event> functions,
 *         true → empty attribute (e.g. disabled), anything else → setAttribute.
 * kids:   strings, numbers, elements, or arrays of those. null/false are skipped,
 *         which makes "show this only if…" easy: cond ? h(...) : null
 *
 * Text is always inserted as text (never as HTML), so names typed by users or
 * returned by an API can't inject markup into the page.
 */
export function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'style') el.setAttribute('style', value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(value));
    }
    for (const kid of kids.flat(Infinity)) {
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
}

/*
 * toast('Saved.') shows a short message at the top of the screen for a few
 * seconds. The #toast element lives in index.html.
 */
let toastTimer = 0;
export function toast(message, ms = 2600) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- number and text checking ---------- */
/*
 * Data comes from places we don't fully control (old files, the database,
 * other people's browsers), so before using a value we check it. Each helper
 * returns a safe value, or the default `d` if the input is unusable.
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* A finite number kept between lo and hi, or the default. */
export function num(v, d, lo = -1e4, hi = 1e4) {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}

/* A string cut to `max` characters, or the default. */
export function str(v, d = '', max = 600) {
    return typeof v === 'string' ? v.slice(0, max) : d;
}

/* A color like "#a1b2c3" (lowercased), or the default. */
export function col(v, d) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d;
}

/* An https:// web address (used for plant photos), or ''. */
export function url(v) {
    return typeof v === 'string' && /^https:\/\/[^\s"'<>]{4,500}$/.test(v) ? v : '';
}

/* ---------- months ---------- */
/*
 * Bloom, fruit and leaf times are stored as a pair of month numbers [from, to],
 * with 1 = January. A range can wrap past December: [11, 2] means Nov–Feb.
 */

/* A valid [from, to] month pair, or null. */
export function rng2(v) {
    return Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= 1 && n <= 12) ? [v[0], v[1]] : null;
}

/* Is month m inside range r? Handles ranges that wrap around the new year. */
export function inRange(m, r) {
    if (!r) return false;
    const [a, b] = r;
    return a <= b ? (m >= a && m <= b) : (m >= a || m <= b);
}

/* [4, 6] → "Apr–Jun",  [5, 5] → "May",  null → "—" */
export function fmtRange(r) {
    if (!r) return '—';
    return r[0] === r[1] ? MSHORT[r[0] - 1] : `${MSHORT[r[0] - 1]}–${MSHORT[r[1] - 1]}`;
}

export const prevM = (m) => (m === 1 ? 12 : m - 1);
export const nextM = (m) => (m === 12 ? 1 : m + 1);

/*
 * Turn a list of months (e.g. the ones where iNaturalist has lots of flowering
 * observations) into one [from, to] range. Because ranges can wrap, we find the
 * longest run of "empty" months and start the range right after it.
 *   [4,5,6,9]     → [4, 9]
 *   [11,12,1,2]   → [11, 2]
 */
export function monthsToRange(months) {
    const on = new Set(months);
    if (!on.size) return null;
    if (on.size === 12) return [1, 12];
    let bestStart = 1, bestLen = 0;
    for (let start = 1; start <= 12; start++) {
        if (on.has(start)) continue;
        let len = 0;
        while (len < 12 && !on.has(((start - 1 + len) % 12) + 1)) len++;
        if (len > bestLen) { bestLen = len; bestStart = start; }
    }
    const from = ((bestStart - 1 + bestLen) % 12) + 1;       // first month after the gap
    const to = ((bestStart - 2 + 12) % 12) + 1;               // last month before the gap
    return [from, to];
}

/* ---------- ids and names ---------- */

/* "Purple Coneflower!" → "purple-coneflower" (safe for ids and file names) */
export function slug(s) {
    return (s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}

/* A new unique-enough id like "purple-coneflower-k3x9". */
export function newId(name) {
    return `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------- colors ---------- */

/* Blend two "#rrggbb" colors. t = 0 gives a, t = 1 gives b. */
export function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (p, shift) => (p >> shift) & 255;
    const out = [16, 8, 0].map(s => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
    return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ---------- repeatable randomness ---------- */
/*
 * The 3D plants scatter their leaves and flowers randomly. If we used
 * Math.random() they'd look different every time the page loads. Instead,
 * rngFor('my-plant-id') gives a random-number function that always produces
 * the same sequence for the same id, so each plant keeps its own look.
 * (Hash the id with FNV-1a, then feed it to the "mulberry32" generator.)
 */
export function rngFor(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    let a = hash >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* ---------- web requests ---------- */

/*
 * fetchJSON(url) downloads JSON with a time limit, and remembers successful
 * answers for this visit so asking the same question twice doesn't hit the
 * API twice (iNaturalist and GBIF are free services; we try to be polite).
 *
 * Pass { signal } from an AbortController to cancel a request that's no
 * longer needed (for example when someone keeps typing in a search box).
 */
const jsonCache = new Map();
export async function fetchJSON(address, { timeout = 12000, signal, cache = true } = {}) {
    if (cache && jsonCache.has(address)) return jsonCache.get(address);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    try {
        const res = await fetch(address, { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cache) jsonCache.set(address, data);
        return data;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/* Turn an HTML snippet (like a Wikipedia summary) into plain text, safely. */
export function stripHtml(html) {
    if (typeof html !== 'string' || !html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/* ---------- small saved preferences ---------- */
/*
 * Remembers little things between visits (which garden was open, which mode)
 * in localStorage. Wrapped in try/catch because private browsing modes can
 * refuse storage, and the app should keep working anyway.
 */
const PREFS_KEY = 'native-garden:prefs';
export function loadPref(name, fallback = null) {
    try {
        const all = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        return name in all ? all[name] : fallback;
    } catch (e) {
        return fallback;
    }
}
export function savePref(name, value) {
    try {
        const all = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        if (value === null || value === undefined) delete all[name];
        else all[name] = value;
        localStorage.setItem(PREFS_KEY, JSON.stringify(all));
    } catch (e) {
        /* storage unavailable: preferences just won't be remembered */
    }
}
