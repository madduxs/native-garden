/*
 * state.js
 * ---------------------------------------------------------------------------
 * The app's shared memory, plus a tiny "event bus" so modules can tell each
 * other something happened without importing each other.
 *
 * S holds everything the app currently knows: who's signed in, which garden
 * is open, every item in it, which month is showing, what's selected, and so
 * on. Any module can read S. Changing S doesn't redraw anything by itself;
 * after changing it, call scheduleUI() (or a function in garden.js that does).
 *
 * The bus:
 *   on('ui', fn)     run fn whenever the UI should redraw
 *   emit('ui')       tell everyone listening
 * Events used in this app:
 *   'ui'        redraw the panels (main.js listens; fired by scheduleUI)
 *   'session'   sign-in state or the list of gardens changed (ui/gardens.js)
 *   'status'    saving status changed (the chip under the garden name)
 *   'garden-loaded'  a garden finished loading its items (main.js frames the camera)
 */
export const S = {
    /* who and where */
    mode: null,            // 'local' (saved in this browser), 'cloud' (Google sign-in + Firebase) or 'view' (a share link)
    user: null,            // { uid, name, email, photo } when signed in
    authReady: false,      // true once Firebase has said whether someone is signed in
    gardens: [],           // [{ id, ...meta }] every garden this person has, for the picker
    gardensLoaded: false,  // true once that list has arrived
    gardenId: null,        // the open garden's id, or null when the home screen is showing
    readOnly: false,       // true when viewing someone else's garden from a share link
    share: null,           // while viewing a share link: { ownerId, gardenId, status: 'loading'|'ok'|'private'|'missing'|'error' }

    /* the open garden */
    meta: null,            // its settings (see cleanMeta in model.js)
    items: emptyItems(),   // Maps of id → item for plants, features and zones
    loaded: false,         // true once the garden's items have arrived
    rev: 0,                // goes up by one whenever any item or the garden's settings change

    /* the plant library */
    library: {
        catalog: [],           // the starter list from data/catalog.json
        about: '',             // a note about where the starter list came from
        loaded: false,
        failed: false,
        saved: new Map(),      // id → entry: plants this person saved to their own library
    },

    /* what's on screen */
    month: new Date().getMonth() + 1,
    sel: null,             // selected item as "kind:id", e.g. "plants:redbud-3k2a"
    form: null,            // the add/edit form when open: { mode: 'edit'|'new', kind, id, prefill }
    libSel: null,          // the library entry open in the detail panel (see ui/library.js)
    dragKey: null,         // the item (or 'outline') being dragged right now
    edit: false,           // "Edit layout" mode
    labels: window.innerWidth > 900,
    mature: false,         // show mature-size shells
    years: 0,              // "years from now": trees and shrubs drawn grown this many years
    hour: 14,              // time of day for the 3D sun, in "sun time" (12 = sun due south; see sunpath.js)
    sunMap: false,         // show the hours-of-sun overlay on the ground (see sun.js)
    wind: null,            // plants sway in the wind (null = decided by scene.js from the device's speed)
    planned: true,         // show planned items
    view: '3d',            // camera: '3d', 'plan' or 'eye'
    tab: 'now',            // side panel tab: 'now', 'cal', 'inv' or 'lib'
    invFilter: 'all',
    invQuery: '',
    calPlanned: true,
    calView: 'bloom',      // Calendar tab: 'bloom' chart or 'care' jobs
    checkPlanned: true,    // Garden Check includes planned plants
    noticeDismissed: false,
};

export function emptyItems() {
    return { plants: new Map(), features: new Map(), zones: new Map() };
}

/* ---------- the event bus ---------- */
const listeners = new Map();   // event name → Set of functions

export function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);   // call the result to stop listening
}

export function emit(event, data) {
    for (const fn of listeners.get(event) || []) {
        try { fn(data); } catch (err) { console.error(`Error in a "${event}" listener:`, err); }
    }
}

/*
 * Ask for a UI redraw. Many things can change in one moment (for example a
 * database update with 50 items), so instead of redrawing 50 times we wait
 * for the next animation frame and redraw once.
 */
let uiQueued = false;
export function scheduleUI() {
    if (uiQueued) return;
    uiQueued = true;
    requestAnimationFrame(() => {
        uiQueued = false;
        emit('ui');
    });
}
