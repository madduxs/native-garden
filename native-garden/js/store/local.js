/*
 * store/local.js
 * ---------------------------------------------------------------------------
 * "Browser only" storage: keeps gardens in this browser's localStorage.
 * Used when someone picks "Try it without an account", or when Firebase
 * isn't set up yet in config.js.
 *
 * It has exactly the same functions as store/firebase.js, so the rest of the
 * app doesn't care which one it's talking to. (That's the "interface":
 *   watchGardens, saveGarden, deleteGarden,
 *   watchItems, saveItem, saveItems, deleteItem,
 *   watchLibrary, saveLibrary, deleteLibrary.)
 *
 * watch...() functions call your callback right away with the full current
 * list, and again after every change. They return a function that stops
 * watching.
 *
 * Everything is kept in one localStorage entry shaped like:
 *   { gardens: { <gardenId>: { meta: {...}, items: { <itemId>: { kind, ... } } } },
 *     library: { <entryId>: {...} } }
 * Browsers allow about 5 MB per site, which is plenty for many gardens.
 */

const KEY = 'native-garden:local-data';

/* Read everything (or an empty shell if nothing's saved yet). */
function readAll() {
    try {
        const data = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { gardens: data.gardens || {}, library: data.library || {} };
    } catch (e) {
        return { gardens: {}, library: {} };
    }
}

let data = readAll();
const watchers = new Set();   // every active watch, as { notify() }

function persist() {
    try {
        localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
        // Usually "storage full". Throwing lets store/index.js show a message.
        throw new Error("This browser's storage is full, so the change wasn't saved. Download your garden from Share to keep a copy.");
    }
    notifyAll();
}

/* Tell every watcher about the change, a moment later (like a real database would). */
function notifyAll() {
    queueMicrotask(() => { for (const w of watchers) w.notify(); });
}

/* If the same app is open in another tab, pick up its changes too. */
window.addEventListener('storage', (ev) => {
    if (ev.key !== KEY) return;
    data = readAll();
    notifyAll();
});

/* Start a watch: call `make()` to build the current list, give it to `cb` now and after changes. */
function watch(make, cb) {
    const w = { notify: () => cb(make()) };
    watchers.add(w);
    queueMicrotask(w.notify);
    return () => watchers.delete(w);
}

const copy = (o) => JSON.parse(JSON.stringify(o));

export function createLocalBackend() {
    return {
        kind: 'local',

        /* gardens: [{ id, ...meta }] */
        watchGardens(cb) {
            return watch(() => Object.entries(data.gardens).map(([id, g]) => ({ id, ...copy(g.meta) })), cb);
        },
        async saveGarden(id, meta) {
            const g = data.gardens[id] || (data.gardens[id] = { meta: {}, items: {} });
            g.meta = copy(meta);
            persist();
        },
        async deleteGarden(id) {
            delete data.gardens[id];
            persist();
        },

        /* items: [{ id, kind, ...fields }] */
        watchItems(gardenId, cb) {
            return watch(() => {
                const g = data.gardens[gardenId];
                return g ? Object.entries(g.items).map(([id, it]) => ({ id, ...copy(it) })) : [];
            }, cb);
        },
        async saveItem(gardenId, id, doc) {
            const g = data.gardens[gardenId];
            if (!g) throw new Error('That garden no longer exists.');
            g.items[id] = copy(doc);
            persist();
        },
        /* Save many at once (used by import). list: [{ id, doc }] */
        async saveItems(gardenId, list) {
            const g = data.gardens[gardenId];
            if (!g) throw new Error('That garden no longer exists.');
            for (const { id, doc } of list) g.items[id] = copy(doc);
            persist();
        },
        async deleteItem(gardenId, id) {
            const g = data.gardens[gardenId];
            if (g) delete g.items[id];
            persist();
        },

        /* library: [{ id, ...entry }] */
        watchLibrary(cb) {
            return watch(() => Object.entries(data.library).map(([id, e]) => ({ id, ...copy(e) })), cb);
        },
        async saveLibrary(id, entry) {
            data.library[id] = copy(entry);
            persist();
        },
        async deleteLibrary(id) {
            delete data.library[id];
            persist();
        },
    };
}

/*
 * Everything saved in this browser, for "Copy to my account" after signing
 * in (see Store.copyLocalToCloud).
 */
export function readLocalSnapshot() {
    return copy(readAll());
}
