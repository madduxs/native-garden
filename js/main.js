/*
 * main.js
 * ---------------------------------------------------------------------------
 * Where the app starts. index.html loads this one file; it imports
 * everything else, wires the pieces together, and decides what to show first.
 *
 * Map of the code (all under js/):
 *   config.js          your Firebase settings (the only file you must edit)
 *   util.js            small general helpers
 *   model.js           what gardens, plants and features are made of; data checking
 *   state.js           shared app state (S) and the event bus (on / emit)
 *   scene.js           three.js: renderer, camera, ground, views, drawing loop
 *   builders.js        the 3D models for plants, features and beds
 *   garden.js          keeps the 3D scene in step with the data; seasons; selection
 *   interact.js        clicking and dragging in the 3D view
 *   store/             saving: local.js (browser only), firebase.js (Google sign-in), index.js (picks one)
 *   library/           plant data: the starter list, iNaturalist, GBIF, location lookups
 *   ui/                the panels, forms, toolbar and home screen
 */
import { S, on, scheduleUI } from './state.js';
import { startLoop, onResize, measureObstruct, setView } from './scene.js';
import { initInteraction, syncZoneHandles } from './interact.js';
import { Store } from './store/index.js';
import { firebaseReady } from './config.js';
import { loadCatalog } from './library/catalog.js';
import { renderMonthStrip, initMonths } from './ui/months.js';
import { renderNow, renderCalendar, renderInventory, initPanes, switchTab } from './ui/panes.js';
import { renderCheck } from './ui/gardencheck.js';
import { renderLibrary } from './ui/library.js';
import { renderDetail } from './ui/detail.js';
import { initToolbar, renderNotice } from './ui/toolbar.js';
import { initGardens, renderHome, renderBrand } from './ui/gardens.js';
import { initSunPanel, renderSunPanel } from './ui/sunpanel.js';
import { $, loadPref } from './util.js';

/* Redraw every panel that's showing. Runs at most once per frame (see scheduleUI). */
function renderAllUI() {
    renderBrand();
    if (!S.gardenId) return;
    renderMonthStrip();
    if (S.tab === 'now') renderNow();
    if (S.tab === 'cal') renderCalendar();
    if (S.tab === 'chk') renderCheck(switchTab);
    if (S.tab === 'inv') renderInventory();
    if (S.tab === 'lib') renderLibrary();
    renderDetail();
    renderNotice();
    renderSunPanel();
    syncZoneHandles();
}
on('ui', renderAllUI);

/*
 * The panels float over the 3D view. Keep the CSS variable --top (where the
 * side panels start) matched to the top bar's height, and re-center the camera.
 */
function syncTop() {
    const tb = $('#topbar').getBoundingClientRect();
    document.documentElement.style.setProperty('--top', `${Math.round(tb.bottom + 10)}px`);
    measureObstruct();
}
new ResizeObserver(syncTop).observe($('#topbar'));
window.addEventListener('resize', () => { onResize(); syncTop(); });

/* When a garden opens, frame it; when its items arrive, frame them too. */
let lastGarden = null;
on('garden-loaded', () => setView(S.view, true));

/*
 * After sign-in (or choosing browser-only), once the garden list arrives,
 * reopen the garden used last time on this device. Only once per person,
 * so closing or deleting a garden doesn't bounce straight back into one.
 */
let autoOpenedFor = '';
on('session', () => {
    const who = `${S.mode}:${S.user ? S.user.uid : ''}`;
    if (S.mode && (S.mode === 'local' || S.user) && S.gardensLoaded && !S.gardenId && autoOpenedFor !== who) {
        autoOpenedFor = who;
        const id = Store.lastGardenId() || (S.gardens.length === 1 ? S.gardens[0].id : null);
        if (id) Store.openGarden(id);
    }
    if (S.gardenId !== lastGarden) {
        lastGarden = S.gardenId;
        if (S.gardenId) { syncTop(); setView(S.view, true); }
    }
    scheduleUI();
});

/* ---------- start ---------- */

initPanes();
initMonths();
initToolbar();
initSunPanel();
initGardens();
initInteraction();
renderHome(true);
syncTop();
startLoop();
loadCatalog();

/*
 * A share link (…?view=<owner id>/<garden id>) opens that garden read-only.
 * Otherwise pick up where this device left off: signed in, browser-only,
 * or the welcome screen.
 */
const shared = new URLSearchParams(location.search).get('view');
const [shareOwner, shareGarden] = (shared || '').split('/');
if (shareOwner && shareGarden && firebaseReady()) {
    document.body.classList.add('read-only');
    Store.openShared(shareOwner, shareGarden);
} else {
    const mode = loadPref('mode');
    if (firebaseReady()) Store.preloadCloud().catch(() => { /* shown when someone tries to sign in */ });
    if (mode === 'cloud' && firebaseReady()) Store.useCloud();
    else if (mode === 'local') Store.useLocal();
}
