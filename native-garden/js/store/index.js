/*
 * store/index.js
 * ---------------------------------------------------------------------------
 * The one place the rest of the app goes to load and save. It picks a
 * "backend" (local.js for browser-only, firebase.js for Google sign-in) and
 * hides the difference.
 *
 * What it does:
 *   - keeps S.gardens (the garden list) and S.library.saved up to date
 *   - opens a garden: watches its items and feeds them to garden.js
 *   - saves changes, and counts writes still in flight for the status chip
 *   - opens someone else's shared garden, read-only (openShared)
 *
 * Saving never blocks the screen. The UI updates first (garden.js), then
 * Store.saveItem() sends it off. If a save fails, a message pops up.
 */
import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from '../config.js';
import { createLocalBackend, readLocalSnapshot } from './local.js';
import { createFirebaseBackend, firebaseErrorText } from './firebase.js';
import { S, emit, scheduleUI } from '../state.js';
import { syncItems, applyMeta, clearItems } from '../garden.js';
import { cleanMeta, cleanLib, toDoc, metaDoc } from '../model.js';
import { toast, savePref, loadPref, newId } from '../util.js';

let backend = null;       // the active backend
let cloud = null;         // the Firebase backend, created the first time it's needed
let cloudLoading = null;  // the promise while it's loading
let cloudUser;            // last user Firebase told us about (undefined = not heard yet)
const unsub = { gardens: null, items: null, library: null };   // functions that stop each watch

function stop(name) {
    if (unsub[name]) { unsub[name](); unsub[name] = null; }
}

function stopWatching() {
    stop('gardens');
    stop('library');
    S.gardens = [];
    S.gardensLoaded = false;
    S.library.saved = new Map();
}

function onWatchError(err) {
    console.error(err);
    toast(firebaseErrorText(err), 6000);
}

/* Do two garden settings objects describe the same garden? (ignores timestamps) */
function sameMeta(a, b) {
    const pick = (m) => JSON.stringify([m.name, m.outline, m.place, m.zone, m.layoutPlaceholder, m.notice, m.shared, m.owner]);
    return pick(a) === pick(b);
}

/* Remember the last open garden separately for each person on this device. */
function lastGardenKey() {
    return `lastGarden:${S.mode}:${S.user ? S.user.uid : 'local'}`;
}

/* Watch the garden list and saved library for whoever is using the app now. */
function startWatching() {
    S.gardensLoaded = false;
    unsub.gardens = backend.watchGardens((list, fromCache) => {
        S.gardens = list.map(g => ({ id: g.id, ...cleanMeta(g) })).sort((a, b) => a.name.localeCompare(b.name));
        // An empty list straight from the offline cache may just mean "not downloaded yet".
        S.gardensLoaded = !fromCache || list.length > 0;
        // If the open garden's settings changed (maybe on another device), apply them.
        if (S.gardenId) {
            const g = S.gardens.find(x => x.id === S.gardenId);
            if (!g) {
                toast('This garden was deleted.');
                Store.closeGarden();
            } else if (S.dragKey !== 'outline' && S.meta && !sameMeta(g, S.meta)) {
                applyMeta(g);
            }
        }
        emit('session');
    }, onWatchError);
    unsub.library = backend.watchLibrary((list) => {
        S.library.saved = new Map(list.map(e => {
            const entry = cleanLib(e, 'saved');
            entry.id = e.id;
            return [e.id, entry];
        }));
        scheduleUI();
    }, onWatchError);
}

/* Firebase calls this whenever someone signs in or out. */
function handleAuth(user) {
    cloudUser = user;
    if (S.mode !== 'cloud') return;
    const changed = (S.user ? S.user.uid : null) !== (user ? user.uid : null) || !S.authReady;
    S.user = user;
    S.authReady = true;
    if (changed) {
        Store.closeGarden();
        stopWatching();
        if (user) startWatching();
    }
    emit('session');
}

/* False while viewing a share link: nothing may be saved then. */
function canWrite() {
    return !!backend && !S.readOnly;
}

window.addEventListener('online', () => emit('status'));
window.addEventListener('offline', () => emit('status'));

export const Store = {
    pending: 0,        // writes sent but not confirmed yet

    /* ---------- choosing where data lives ---------- */

    /* Use this browser's storage (no account). */
    useLocal() {
        this.closeGarden();
        stopWatching();
        backend = createLocalBackend();
        S.mode = 'local';
        S.user = null;
        S.authReady = true;
        savePref('mode', 'local');
        startWatching();
        emit('session');
    },

    /*
     * Load the Firebase SDK in the background (main.js calls this at startup
     * when Firebase is configured). Having it ready matters: browsers only
     * allow the Google sign-in popup if it opens right away when clicked.
     */
    preloadCloud() {
        if (cloud) return Promise.resolve(cloud);
        if (!cloudLoading) {
            cloudLoading = createFirebaseBackend(FIREBASE_CONFIG, FIREBASE_SDK_VERSION, handleAuth)
                .then((c) => { cloud = c; return c; })
                .catch((err) => { cloudLoading = null; throw err; });
        }
        return cloudLoading;
    },

    /* Use Firebase: wait for the SDK, then for Firebase to say who's signed in. */
    async useCloud() {
        this.closeGarden();
        stopWatching();
        S.mode = 'cloud';
        S.user = null;
        S.authReady = false;
        savePref('mode', 'cloud');
        emit('session');
        try {
            if (!cloud) await this.preloadCloud();
        } catch (err) {
            console.error(err);
            S.mode = null;
            savePref('mode', null);
            toast("Couldn't load Google sign-in. Check your connection, or use the app without an account.", 6000);
            emit('session');
            return;
        }
        backend = cloud;
        // If Firebase already said who's signed in (earlier this visit), use that now.
        if (cloudUser !== undefined) handleAuth(cloudUser);
    },

    /*
     * Google sign-in. When the SDK is already loaded, the popup opens straight
     * from the click (no waiting), which keeps popup blockers happy.
     */
    signIn() {
        const go = () => cloud.signIn().catch((err) => {
            console.error(err);
            toast(firebaseErrorText(err), 7000);
        });
        if (cloud) {
            if (S.mode !== 'cloud') this.useCloud();   // runs instantly when the SDK is loaded
            return go();
        }
        return this.useCloud().then(() => (cloud ? go() : null));
    },

    async signOut() {
        this.closeGarden();
        if (cloud) await cloud.signOut();
    },

    /* Go back to the start screen (forget the chosen mode). */
    leave() {
        this.closeGarden();
        stopWatching();
        backend = null;
        S.mode = null;
        S.user = null;
        savePref('mode', null);
        emit('session');
    },

    /* ---------- viewing someone else's garden (a share link) ---------- */

    /*
     * Open a shared garden read-only: ?view=<owner id>/<garden id> in the
     * address. Needs Firebase, but not signing in. If the owner turned
     * sharing off (or the link is wrong), S.share.status says why.
     */
    async openShared(ownerId, gardenId) {
        this.closeGarden();
        stopWatching();
        S.mode = 'view';
        S.readOnly = true;
        S.authReady = true;
        S.share = { ownerId, gardenId, status: 'loading' };
        emit('session');
        try {
            if (!cloud) await this.preloadCloud();
        } catch (err) {
            console.error(err);
            S.share.status = 'error';
            emit('session');
            return;
        }
        backend = cloud;
        let pending = null;            // items that arrive before the garden's settings
        const fail = (status) => {
            this.closeGarden();
            S.share.status = status;
            emit('session');
        };
        unsub.items = cloud.watchShared(ownerId, gardenId,
            (meta) => {
                if (!meta || meta.shared !== true) { fail('private'); return; }
                const first = !S.gardenId;
                if (first) { S.gardenId = gardenId; S.loaded = false; }
                if (first || !sameMeta(cleanMeta(meta), S.meta)) applyMeta(meta);
                S.share.status = 'ok';
                if (first && pending) { syncItems(pending); pending = null; S.loaded = true; emit('garden-loaded'); }
                emit('session');
            },
            (list) => {
                if (!S.gardenId) { pending = list; return; }
                syncItems(list);
                if (!S.loaded) { S.loaded = true; emit('garden-loaded'); }
                scheduleUI();
            },
            (err) => {
                console.warn('Shared garden:', err);
                fail(err && err.code === 'permission-denied' ? 'private' : 'error');
            });
    },

    /* The link that opens the open garden read-only (signed-in owners only). */
    shareLink() {
        if (S.mode !== 'cloud' || !cloud || !cloud.uid() || !S.gardenId) return '';
        return `${location.origin}${location.pathname}?view=${encodeURIComponent(cloud.uid())}/${encodeURIComponent(S.gardenId)}`;
    },

    /* Turn the open garden's share link on or off. */
    setShared(on) {
        if (S.mode !== 'cloud' || !S.meta) return;
        const first = (S.user && (S.user.name || '').split(' ')[0]) || '';
        applyMeta({ ...S.meta, shared: on, owner: on ? first : S.meta.owner });
        this.saveMeta();
    },

    /* ---------- opening and closing a garden ---------- */

    openGarden(id) {
        const g = S.gardens.find(x => x.id === id);
        if (!g || !backend) return false;
        this.closeGarden();
        S.gardenId = id;
        S.loaded = false;
        S.noticeDismissed = false;
        applyMeta(g);
        savePref(lastGardenKey(), id);
        unsub.items = backend.watchItems(id, (list) => {
            syncItems(list);
            if (!S.loaded) {
                S.loaded = true;
                emit('garden-loaded');
            }
            scheduleUI();
        }, onWatchError);
        emit('session');
        return true;
    },

    closeGarden() {
        stop('items');                 // (also stops a share link that never finished opening)
        if (!S.gardenId) return;
        clearItems();
        S.gardenId = null;
        S.meta = null;
        S.loaded = false;
        S.libSel = null;
        emit('session');
    },

    /* The garden that was open last time on this device (if it still exists). */
    lastGardenId() {
        const id = loadPref(lastGardenKey());
        return S.gardens.some(g => g.id === id) ? id : null;
    },

    /* ---------- gardens ---------- */

    /* Make a new garden from { name, outline, place }. Returns its id. */
    createGarden(fields) {
        if (!canWrite()) return null;
        const id = newId(fields.name || 'garden');
        const meta = cleanMeta({ ...fields, created: new Date().toISOString() });
        // Add it to the list right away so it can be opened before the database answers.
        S.gardens = [...S.gardens, { id, ...meta }].sort((a, b) => a.name.localeCompare(b.name));
        this.track(backend.saveGarden(id, metaDoc(meta)));
        return id;
    },

    /* Save the open garden's settings (name, outline, location...). */
    saveMeta() {
        if (!S.gardenId || !S.meta || !canWrite()) return;
        const doc = metaDoc(S.meta);
        S.gardens = S.gardens.map(g => (g.id === S.gardenId ? { id: g.id, ...cleanMeta(doc) } : g));
        this.track(backend.saveGarden(S.gardenId, doc));
    },

    deleteGarden(id) {
        if (!canWrite()) return Promise.resolve(false);
        if (S.gardenId === id) this.closeGarden();
        S.gardens = S.gardens.filter(g => g.id !== id);
        if (loadPref(lastGardenKey()) === id) savePref(lastGardenKey(), null);
        emit('session');
        return this.track(backend.deleteGarden(id));
    },

    /* ---------- items ---------- */

    saveItem(item) {
        if (!S.gardenId || !canWrite()) return;
        this.track(backend.saveItem(S.gardenId, item.id, { kind: item.kind, ...toDoc(item) }));
    },

    deleteItem(kind, id) {
        if (!S.gardenId || !canWrite()) return;
        this.track(backend.deleteItem(S.gardenId, id));
    },

    /* Save many items at once. list: [{ kind, id, data }] (from parseGardenFile) */
    importItems(list) {
        if (!S.gardenId || !canWrite()) return Promise.resolve();
        return this.track(backend.saveItems(S.gardenId, list.map(x => ({ id: x.id, doc: { kind: x.kind, ...x.data } }))));
    },

    /* ---------- library ---------- */

    saveLibrary(entry) {
        if (!canWrite()) return Promise.resolve(false);
        S.library.saved.set(entry.id, entry);
        scheduleUI();
        return this.track(backend.saveLibrary(entry.id, { ...toDoc(entry), source: 'saved' }));
    },

    deleteLibrary(id) {
        if (!canWrite()) return Promise.resolve(false);
        S.library.saved.delete(id);
        scheduleUI();
        return this.track(backend.deleteLibrary(id));
    },

    /* ---------- moving browser gardens into an account ---------- */

    /*
     * Browser-only gardens that haven't been copied into this account yet.
     * (We remember which ones were copied so the offer doesn't keep coming back.)
     */
    uncopiedLocalIds() {
        if (!S.user) return [];
        const done = new Set(loadPref(`copied:${S.user.uid}`, []));
        return Object.keys(readLocalSnapshot().gardens).filter(id => !done.has(id));
    },

    localGardenCount() {
        return this.uncopiedLocalIds().length;
    },

    /* Copy browser-only gardens (and the saved library) into the signed-in account. */
    async copyLocalToCloud() {
        if (S.mode !== 'cloud' || !S.user) return 0;
        const snap = readLocalSnapshot();
        const prefKey = `copied:${S.user.uid}`;
        let n = 0;
        for (const oldId of this.uncopiedLocalIds()) {
            const g = snap.gardens[oldId];
            const id = S.gardens.some(x => x.id === oldId) ? newId(g.meta?.name || 'garden') : oldId;
            await backend.saveGarden(id, metaDoc(cleanMeta(g.meta)));
            await backend.saveItems(id, Object.entries(g.items || {}).map(([itemId, doc]) => ({ id: itemId, doc })));
            savePref(prefKey, [...loadPref(prefKey, []), oldId]);
            n++;
        }
        for (const [id, entry] of Object.entries(snap.library)) {
            if (!S.library.saved.has(id)) await backend.saveLibrary(id, entry);
        }
        return n;
    },

    /* ---------- save status ---------- */

    /*
     * Count a write while it's in flight, and report it if it fails.
     * Returns a promise of true (saved) or false (failed); it never throws,
     * so callers can simply `await` it.
     */
    track(promise) {
        this.pending++;
        emit('status');
        return Promise.resolve(promise)
            .then(() => true, (err) => {
                console.error(err);
                toast(err && err.code ? firebaseErrorText(err) : (err && err.message) || "Couldn't save that change.", 6000);
                return false;
            })
            .finally(() => {
                this.pending--;
                emit('status');
            });
    },

    /* The chip under the garden name: { cls: 'ok'|'warn'|'err', text } */
    status() {
        if (S.mode === 'view') return { cls: 'ok', text: 'View only' };
        if (S.mode === 'local') return this.pending ? { cls: 'warn', text: 'Saving…' } : { cls: 'ok', text: 'Saved in this browser' };
        if (!navigator.onLine) return { cls: 'warn', text: 'Offline · changes upload later' };
        if (this.pending) return { cls: 'warn', text: 'Syncing…' };
        return { cls: 'ok', text: 'Synced to your account' };
    },
};
