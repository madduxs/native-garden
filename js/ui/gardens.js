/*
 * ui/gardens.js
 * ---------------------------------------------------------------------------
 * Everything about choosing and setting up gardens:
 *
 *   - the home screen (#home): welcome, Google sign-in, the garden list,
 *     "New garden", "Import a garden file", and copying browser-only gardens
 *     into an account after signing in
 *   - garden settings: rename, change location, delete
 *   - the top-left panel: the garden's name (click it to switch gardens),
 *     the save-status chip, and where the garden is
 *
 * The home screen is drawn from a small state object, H. Which "view" shows
 * depends on whether someone has picked a mode, signed in, and so on (see
 * currentView()).
 */
import { S, on } from '../state.js';
import { applyMeta } from '../garden.js';
import { bounds, measureObstruct } from '../scene.js';
import { Store } from '../store/index.js';
import { firebaseReady, APP_NAME } from '../config.js';
import { $, h, toast, num } from '../util.js';
import { rectOutline, outlineBounds, parseGardenFile, ZONES } from '../model.js';
import { currentPosition, searchAddress, placeFromPoint, hardinessZoneAt } from '../library/location.js';
import { confirmButton } from './common.js';
import { importParsed } from './toolbar.js';

const H = {
    open: false,       // home screen open on top of an open garden
    view: null,        // 'new' | 'settings' | null (null = work it out from the session)
    pendingImport: null,   // a parsed garden file waiting for "Create garden"
    copying: false,
    shown: null,       // the view currently drawn (so background updates don't wipe a half-filled form)
};

/* ---------- opening and closing ---------- */

export function openHome(view = null) {
    H.open = true;
    H.view = view;
    renderHome(true);
}

export function closeHome() {
    H.open = false;
    H.view = null;
    H.pendingImport = null;
    renderHome(true);
}

function currentView() {
    if (S.mode === 'view') return 'shared';
    if (H.view === 'new' && (S.mode === 'local' || S.user)) return 'new';
    if (H.view === 'settings' && S.gardenId) return 'settings';
    if (!S.mode) return 'welcome';
    if (S.mode === 'cloud' && !S.authReady) return 'wait';
    if (S.mode === 'cloud' && !S.user) return 'signin';
    return 'picker';
}

/* ---------- the location picker (used by New garden and Settings) ---------- */

/*
 * A self-contained widget: it redraws only its own insides, so typing in the
 * rest of the form isn't interrupted. Read the chosen place from .place.
 */
function locationWidget(initial, onPlacePicked = null) {
    let place = initial || null;
    const now = h('div', { class: 'loc-now', 'aria-live': 'polite' });
    const results = h('div', { class: 'rows loc-results' });

    function show(message) {
        if (message) { now.replaceChildren(h('span', { class: 'muted', text: message })); return; }
        now.replaceChildren(place
            ? h('span', {}, h('b', { text: 'Location: ' }), place.label)
            : h('span', { class: 'muted', text: 'No location yet. It sets the sun angle and lets the Library check which plants are native here.' }));
    }

    async function pick(lat, lng) {
        results.replaceChildren();
        show('Finding the county…');
        try {
            place = await placeFromPoint(lat, lng);
            show();
            if (onPlacePicked) await onPlacePicked(place);
        } catch (err) {
            show("Couldn't look that place up. Check your connection.");
        }
    }

    const useMine = h('button', { class: 'btn', type: 'button', text: 'Use my location' });
    useMine.addEventListener('click', async () => {
        show('Asking for your location…');
        try {
            const p = await currentPosition();
            await pick(p.lat, p.lng);
        } catch (err) {
            show(err.message);
        }
    });

    const q = h('input', { class: 'search', type: 'search', placeholder: 'Town, county or address', 'aria-label': 'Search for a place' });
    const searchBtn = h('button', { class: 'btn', type: 'button', text: 'Search' });
    const doSearch = async () => {
        const text = q.value.trim();
        if (text.length < 2) return;
        searchBtn.disabled = true;
        results.replaceChildren(h('p', { class: 'empty', text: 'Searching…' }));
        try {
            const list = await searchAddress(text);
            results.replaceChildren(...(list.length
                ? list.map(r => h('button', { class: 'row', type: 'button', onclick: () => pick(r.lat, r.lng) }, h('span'), h('span', { class: 'nm', text: r.label }), h('span')))
                : [h('p', { class: 'empty', text: 'No places found. Try a nearby town.' })]));
        } catch (err) {
            results.replaceChildren(h('p', { class: 'empty', text: "Couldn't search right now. Try again, or use your location." }));
        }
        searchBtn.disabled = false;
    };
    searchBtn.addEventListener('click', doSearch);
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doSearch(); } });

    const lat = h('input', { type: 'number', step: '0.01', placeholder: 'Latitude, e.g. 35.68', 'aria-label': 'Latitude' });
    const lng = h('input', { type: 'number', step: '0.01', placeholder: 'Longitude, e.g. -99.60', 'aria-label': 'Longitude' });
    const coords = h('details', { class: 'loc-coords' }, h('summary', { text: 'Enter coordinates instead' }),
        h('div', { class: 'loc-row' }, lat, lng, h('button', {
            class: 'btn', type: 'button', text: 'Use',
            onclick: () => {
                const la = num(lat.value, NaN, -90, 90), ln = num(lng.value, NaN, -180, 180);
                if (Number.isFinite(la) && Number.isFinite(ln)) pick(la, ln);
                else show('Enter a latitude and a longitude.');
            },
        })));

    show();
    const el = h('div', { class: 'loc' },
        now,
        h('div', { class: 'loc-row' }, useMine),
        h('div', { class: 'loc-row' }, q, searchBtn),
        results,
        coords,
        h('p', { class: 'note' }, 'Place search by ', h('a', { href: 'https://nominatim.openstreetmap.org/', target: '_blank', rel: 'noopener' }, 'Nominatim'), ' · © ',
            h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap'), ' contributors. Only the area (about 1 km) is saved.'));
    return { el, get place() { return place; } };
}

/*
 * The USDA hardiness zone picker. Garden Check uses it to flag plants that
 * won't survive the winters there, and the Library can filter by it.
 */
function zoneField(value) {
    const s = h('select', { 'aria-label': 'Hardiness zone' });
    s.append(h('option', { value: '', text: 'Not set' }));
    for (const z of ZONES) {
        const o = h('option', { value: z, text: `Zone ${z}` });
        if (z === value) o.selected = true;
        s.append(o);
    }

    const el = h('label', {}, 'USDA hardiness zone', s,
        h('a', { href: 'https://planthardiness.ars.usda.gov/', target: '_blank', rel: 'noopener', class: 'small-link' }, 'Look up your zone'));
    const status = h('p', { class: 'note full' });
    status.hidden = true;

    return {
        el,
        status,
        get value() { return s.value; },
        set value(v) {
            if (v === '' || ZONES.includes(v)) s.value = v;
        },
    };
}

async function suggestZone(place, field) {
    field.status.hidden = false;
    field.status.textContent = 'Looking up the USDA zone…';

    try {
        const zone = await hardinessZoneAt(place.lat, place.lng);
        if (!zone) {
            field.status.textContent = 'No USDA zone found. Select one manually.';
            return;
        }

        field.value = zone;
        field.status.textContent = `Suggested by the 2023 USDA map: ${zone}. You can change it.`;
    } catch (err) {
        console.warn('USDA hardiness zone lookup failed:', err);
        field.status.textContent = 'Could not detect a zone. Select one manually.';
    }
}

/* ---------- each view ---------- */

function cardHead(title, closable) {
    return h('div', { class: 'dh' },
        h('h2', { text: title }),
        closable ? h('button', { class: 'close', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeHome }) : null);
}

function welcomeView() {
    const kids = [
        h('p', { class: 'eyebrow', text: 'Welcome' }),
        h('h1', { class: 'home-title', text: APP_NAME }),
        h('p', { class: 'lede', text: "Map your native garden in 3D. See what's growing and when it blooms, find plants native to where you live, and plan what to add next." }),
    ];
    if (firebaseReady()) {
        kids.push(h('div', { class: 'stack' },
            h('button', { class: 'btn primary big-btn', type: 'button', text: 'Sign in with Google', onclick: () => Store.signIn() }),
            h('button', { class: 'btn big-btn', type: 'button', text: 'Try it without an account', onclick: () => Store.useLocal() })),
            h('p', { class: 'note', text: 'Signing in keeps your gardens in sync between your phone and computer. Without an account, gardens are saved only in this browser.' }));
    } else {
        kids.push(h('div', { class: 'stack' }, h('button', { class: 'btn primary big-btn', type: 'button', text: 'Start', onclick: () => Store.useLocal() })),
            h('p', { class: 'note', text: "Sign-in isn't set up on this copy yet, so gardens are saved in this browser. (To turn on Google sign-in, see README.md.)" }));
    }
    return kids;
}

function waitView() {
    return [h('h2', { text: 'Checking sign-in…' }), h('p', { class: 'note', text: 'One moment.' })];
}

function signinView() {
    return [
        h('h2', { text: 'Sign in' }),
        h('p', { class: 'lede', text: 'Sign in with your Google account to see your gardens.' }),
        h('div', { class: 'stack' },
            h('button', { class: 'btn primary big-btn', type: 'button', text: 'Sign in with Google', onclick: () => Store.signIn() }),
            h('button', { class: 'btn big-btn', type: 'button', text: 'Use it without an account instead', onclick: () => Store.useLocal() })),
    ];
}

function gardenRow(g) {
    const b = outlineBounds(g.outline);
    const where = g.place ? g.place.label : 'No location set';
    const current = g.id === S.gardenId;
    return h('button', { class: 'row gcard' + (current ? ' on' : ''), type: 'button', onclick: () => { if (!current) Store.openGarden(g.id); closeHome(); } },
        h('span', { class: 'sw', style: 'background:#7d8a36' }),
        h('span', { class: 'nm' }, g.name, h('small', { text: `${where} · ${Math.round(b.w)} × ${Math.round(b.d)} ft` })),
        h('span', { class: 'meta', text: current ? 'Open now' : 'Open' }));
}

function pickerView() {
    const kids = [cardHead('Your gardens', !!S.gardenId)];
    // Who's using it
    if (S.mode === 'cloud') {
        kids.push(h('p', { class: 'account' }, `Signed in as ${S.user.name || S.user.email}`, ' · ',
            h('button', { class: 'linkbtn', type: 'button', text: 'Sign out', onclick: () => Store.signOut() })));
    } else {
        kids.push(h('p', { class: 'account' }, 'Saved in this browser only.',
            firebaseReady() ? [' ', h('button', { class: 'linkbtn', type: 'button', text: 'Sign in to sync', onclick: () => Store.signIn() })] : null));
    }
    // The list
    if (!S.gardensLoaded) kids.push(h('p', { class: 'empty', text: 'Loading your gardens…' }));
    else if (!S.gardens.length) kids.push(h('p', { class: 'empty', text: 'No gardens yet. Make your first one.' }));
    else kids.push(h('div', { class: 'rows' }, S.gardens.map(gardenRow)));

    const acts = [
        h('button', { class: 'btn primary', type: 'button', text: 'New garden', onclick: () => { H.pendingImport = null; openHome('new'); } }),
        h('button', { class: 'btn', type: 'button', text: 'Import a garden file…', onclick: () => $('#homeImportFile').click() }),
    ];
    if (S.gardenId) acts.push(h('button', { class: 'btn', type: 'button', text: 'Settings for this garden', onclick: () => openHome('settings') }));
    kids.push(h('div', { class: 'actions' }, acts));

    // After signing in: offer to bring browser-only gardens along.
    if (S.mode === 'cloud' && S.user && S.gardensLoaded) {
        const n = Store.localGardenCount();
        if (n) {
            const btn = h('button', { class: 'btn', type: 'button', text: H.copying ? 'Copying…' : `Copy ${n === 1 ? 'it' : 'them'} to my account`, disabled: H.copying });
            btn.addEventListener('click', async () => {
                H.copying = true;
                renderHome(true);
                try {
                    const copied = await Store.copyLocalToCloud();
                    toast(`Copied ${copied} garden${copied === 1 ? '' : 's'} to your account.`);
                } catch (err) {
                    toast("Couldn't copy them. Try again.", 5000);
                }
                H.copying = false;
                renderHome(true);
            });
            kids.push(h('div', { class: 'libbox' }, h('p', { text: `${n} garden${n === 1 ? ' is' : 's are'} saved in this browser from before you signed in.` }), btn));
        }
    }
    if (S.mode === 'local' && !firebaseReady()) kids.push(h('p', { class: 'note', text: "Clearing this browser's data deletes these gardens. Use Data → Download garden file now and then to keep a backup." }));
    return kids;
}

function newView() {
    const imp = H.pendingImport;
    const fileB = imp && imp.meta.outline ? outlineBounds(imp.meta.outline) : null;
    const name = h('input', { type: 'text', maxlength: 80, required: true, placeholder: 'e.g. Backyard pollinator garden', value: imp ? imp.meta.name : '' });
    const zone = zoneField('');
    const loc = locationWidget(null, (place) => suggestZone(place, zone));
    const w = h('input', { type: 'number', min: 10, max: 1000, step: 1, value: fileB ? Math.round(fileB.w) : 60 });
    const d = h('input', { type: 'number', min: 10, max: 1000, step: 1, value: fileB ? Math.round(fileB.d) : 40 });
    const create = h('button', { class: 'btn primary', type: 'submit', text: 'Create garden' });
    const form = h('form', { class: 'form' },
        h('label', { class: 'full' }, 'Name', name),
        h('div', { class: 'full' }, h('div', { class: 'label', text: 'Where is it?' }), loc.el),
        zone.el,
        zone.status,
        fileB ? h('p', { class: 'note full', text: `Using the outline from the file (${Math.round(fileB.w)} × ${Math.round(fileB.d)} ft).` }) : null,
        fileB ? null : h('label', {}, 'Width, east–west (ft)', w),
        fileB ? null : h('label', {}, 'Depth, north–south (ft)', d),
        fileB ? null : h('p', { class: 'note full', text: 'It starts as a rectangle. Reshape it any time with Edit layout: drag the gold corners, double-click an edge to add one.' }),
        imp ? h('p', { class: 'note full', text: `Will import ${imp.counts.plants} plants, ${imp.counts.features} features and ${imp.counts.zones} beds.` }) : null,
        h('div', { class: 'actions full' }, create, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { H.pendingImport = null; openHome(null); } })));
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const outline = imp && imp.meta.outline ? imp.meta.outline : rectOutline(num(w.value, 60, 10, 1000), num(d.value, 40, 10, 1000));
        const id = Store.createGarden({
            name: name.value.trim() || 'My garden',
            outline,
            place: loc.place,
            zone: zone.value,
            layoutPlaceholder: imp ? imp.meta.layoutPlaceholder : false,
            notice: imp ? imp.meta.notice : '',
        });
        Store.openGarden(id);
        const pending = H.pendingImport;
        closeHome();
        if (pending) {
            await importParsed(pending, false);
            toast('Garden imported.');
        } else {
            toast('Garden created. Use Add or the Library to put plants in.', 4000);
        }
    });
    queueMicrotask(() => name.focus());
    return [cardHead(imp ? 'Import as a new garden' : 'New garden', false), form];
}

function settingsView() {
    const m = S.meta;
    const name = h('input', { type: 'text', maxlength: 80, required: true, value: m.name });
    const zone = zoneField(m.zone);
    const loc = locationWidget(m.place, (place) => suggestZone(place, zone));

    if (m.place && !m.zone) suggestZone(m.place, zone);
    const form = h('form', { class: 'form' },
        h('label', { class: 'full' }, 'Name', name),
        h('div', { class: 'full' }, h('div', { class: 'label', text: 'Location' }), loc.el),
        zone.el,
        zone.status,
        h('p', { class: 'note full', text: `Outline: ${Math.round(bounds().w)} × ${Math.round(bounds().d)} ft. To change its shape, close this and turn on Edit layout.` }),
        h('div', { class: 'actions full' },
            h('button', { class: 'btn primary', type: 'submit', text: 'Save' }),
            h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => openHome(null) })));
    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        applyMeta({ ...S.meta, name: name.value.trim() || S.meta.name, place: loc.place, zone: zone.value });
        Store.saveMeta();
        closeHome();
        toast('Saved.');
    });
    const del = confirmButton('Delete this garden', 'Yes, delete it for good', async () => {
        const nm = S.meta.name;
        await Store.deleteGarden(S.gardenId);
        H.view = null;
        renderHome(true);
        toast(`Deleted ${nm}.`);
    });
    return [cardHead('Garden settings', true), form,
        h('div', { class: 'libbox' }, h('h3', { text: 'Delete' }), h('p', { class: 'note', text: 'Deletes this garden and everything in it. Your plant library stays. Download a copy from Share first if you might want it back.' }), del)];
}

/* Someone opened a share link: what's happening, and a way to start their own garden. */
function sharedView() {
    const st = S.share ? S.share.status : 'loading';
    const own = h('button', { class: 'btn primary', type: 'button', text: 'Make your own garden', onclick: () => { location.href = location.pathname; } });
    if (st === 'loading') return [h('p', { class: 'eyebrow', text: 'Shared garden' }), h('p', { class: 'lede', text: 'Opening the garden…' })];
    if (st === 'ok') {
        const owner = S.meta?.owner;
        return [cardHead(owner ? `${owner}'s garden` : 'A shared garden', true),
            h('p', { class: 'lede', text: "Someone shared this garden with you to look at. Walk around it in 3D, play through the months and browse the plant library; changes they make show up here live. You can't change anything." }),
            h('div', { class: 'actions' }, own, h('button', { class: 'btn', type: 'button', text: 'Back to the garden', onclick: closeHome })),
            h('p', { class: 'note', text: `${APP_NAME} is free: map your own native garden and find plants native to where you live.` })];
    }
    const msg = st === 'private'
        ? "This garden isn't shared right now. The owner may have turned sharing off, or the link got cut short when it was copied."
        : "Couldn't load the shared garden. Check your connection and reload the page.";
    return [h('p', { class: 'eyebrow', text: 'Shared garden' }), h('h1', { class: 'home-title', text: APP_NAME }), h('p', { class: 'lede', text: msg }), h('div', { class: 'actions' }, own)];
}

/* ---------- drawing ---------- */

export function renderHome(force = false) {
    const show = !S.gardenId || H.open;
    const home = $('#home');
    home.hidden = !show;
    document.body.classList.toggle('home-open', show);
    document.body.classList.toggle('no-garden', !S.gardenId);
    measureObstruct();
    if (!show) { H.shown = null; return; }
    const v = currentView();
    // Forms redraw only when asked to (force), not on every background update.
    if (!force && v === H.shown && (v === 'new' || v === 'settings')) return;
    H.shown = v;
    const kids = v === 'shared' ? sharedView() : v === 'welcome' ? welcomeView() : v === 'wait' ? waitView() : v === 'signin' ? signinView()
        : v === 'new' ? newView() : v === 'settings' ? settingsView() : pickerView();
    $('#homeCard').replaceChildren(...kids);
}

/* The top-left panel: garden name, save status, location and size. */
export function renderBrand() {
    $('#title').textContent = S.meta ? S.meta.name : APP_NAME;
    const st = Store.status();
    const chip = $('#dataChip');
    chip.className = `chip dot ${st.cls}`;
    chip.textContent = st.text;
    if (S.meta) {
        const b = bounds();
        const p = S.meta.place;
        const where = p ? [p.county, p.state].filter(Boolean).join(', ') || p.label : 'No location set';
        const whose = S.mode === 'view' && S.meta.owner ? `${S.meta.owner}'s garden · ` : '';
        $('#siteSize').textContent = `${whose}${Math.round(b.w)} × ${Math.round(b.d)} ft · ${where}${S.meta.zone ? ` · zone ${S.meta.zone}` : ''}`;
    }
}

export function initGardens() {
    $('#gardenBtn').addEventListener('click', () => openHome(null));
    $('#homeImportFile').addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        try {
            H.pendingImport = parseGardenFile(JSON.parse(await file.text()));
            openHome('new');
        } catch (err) {
            toast(err instanceof SyntaxError ? "That file isn't valid JSON." : err.message, 5000);
        }
    });
    window.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && H.open && S.gardenId) closeHome();
    });
    on('session', () => { renderHome(); renderBrand(); });
    on('status', renderBrand);
}
