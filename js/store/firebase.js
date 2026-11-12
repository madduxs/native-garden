/*
 * store/firebase.js
 * ---------------------------------------------------------------------------
 * Cloud storage: Google sign-in (Firebase Authentication) and the Firestore
 * database. Same functions as store/local.js, so the app can use either.
 *
 * The Firebase SDK is loaded straight from Google's CDN with import(), only
 * when someone chooses to sign in, so "browser only" visitors never download it.
 *
 * Where things live in Firestore (everything sits under the signed-in
 * person's own user id, which makes the security rules short and strict;
 * see firestore.rules):
 *
 *   users/{uid}/gardens/{gardenId}                 a garden's settings (meta)
 *   users/{uid}/gardens/{gardenId}/items/{itemId}  one plant, feature or bed ({ kind, ...fields })
 *   users/{uid}/library/{entryId}                  plants saved to their library
 *
 * Sharing: a garden whose settings say shared: true can be READ (never
 * changed) by anyone who has its link, signed in or not. firestore.rules
 * enforces that; watchShared() below is how a visitor reads one.
 *
 * Offline: Firestore keeps a copy in the browser (persistentLocalCache), so the
 * app opens and edits work without a connection; changes upload when it's back.
 * Because of that we never wait for the server before updating the screen.
 */

export async function createFirebaseBackend(config, version, onAuth) {
    const base = `https://www.gstatic.com/firebasejs/${version}`;
    const [appSdk, authSdk, fs] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
    ]);

    const app = appSdk.initializeApp(config);
    const auth = authSdk.getAuth(app);

    // Firestore with an offline cache shared by all open tabs. Some browsers
    // (private windows) refuse the cache; then we fall back to memory only.
    let db;
    try {
        db = fs.initializeFirestore(app, {
            localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
        });
    } catch (e) {
        db = fs.getFirestore(app);
    }

    let uid = null;

    // Called by Firebase at startup (with the remembered user, or null) and on every sign-in/out.
    authSdk.onAuthStateChanged(auth, (user) => {
        uid = user ? user.uid : null;
        onAuth(user ? { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' } : null);
    });

    // If sign-in went through the redirect fallback (below), report any error from it.
    authSdk.getRedirectResult(auth).catch((err) => console.warn('Redirect sign-in failed:', err));

    // Paths under the signed-in person: col('gardens') → users/{uid}/gardens
    const col = (...parts) => fs.collection(db, 'users', uid, ...parts);
    const ref = (...parts) => fs.doc(db, 'users', uid, ...parts);
    const listOf = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));

    /* Write many documents in batches (Firestore allows up to 500 per batch). */
    async function batched(ops) {
        for (let i = 0; i < ops.length; i += 400) {
            const batch = fs.writeBatch(db);
            for (const op of ops.slice(i, i + 400)) op(batch);
            await batch.commit();
        }
    }

    return {
        kind: 'cloud',

        /*
         * Google sign-in in a popup window. If the browser blocks popups, fall
         * back to sending the whole page to Google and back (a "redirect").
         */
        async signIn() {
            const provider = new authSdk.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            try {
                await authSdk.signInWithPopup(auth, provider);
            } catch (err) {
                const code = err && err.code;
                if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
                    await authSdk.signInWithRedirect(auth, provider);
                } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
                    // They closed the popup; nothing to do.
                } else {
                    throw err;
                }
            }
        },
        signOut() { return authSdk.signOut(auth); },
        /* The signed-in person's id (for building share links). */
        uid() { return uid; },

        /* The second argument says the list came from the offline cache, not the server (yet). */
        watchGardens(cb, onError) {
            return fs.onSnapshot(col('gardens'), snap => cb(listOf(snap), snap.metadata ? snap.metadata.fromCache : false), onError);
        },
        saveGarden(id, meta) {
            return fs.setDoc(ref('gardens', id), meta);
        },
        /* Firestore doesn't delete a document's sub-collection for us, so delete the items first. */
        async deleteGarden(id) {
            const snap = await fs.getDocs(col('gardens', id, 'items'));
            await batched(snap.docs.map(d => (batch) => batch.delete(d.ref)));
            await fs.deleteDoc(ref('gardens', id));
        },

        watchItems(gardenId, cb, onError) {
            return fs.onSnapshot(col('gardens', gardenId, 'items'), snap => cb(listOf(snap)), onError);
        },
        saveItem(gardenId, id, doc) {
            return fs.setDoc(ref('gardens', gardenId, 'items', id), doc);
        },
        saveItems(gardenId, list) {
            return batched(list.map(({ id, doc }) => (batch) => batch.set(ref('gardens', gardenId, 'items', id), doc)));
        },
        deleteItem(gardenId, id) {
            return fs.deleteDoc(ref('gardens', gardenId, 'items', id));
        },

        /*
         * A visitor opening a share link: watch someone else's garden (its
         * settings and its items) without signing in. Works only while the
         * owner has sharing turned on; otherwise the rules say no and
         * onError gets a 'permission-denied' error.
         */
        watchShared(ownerId, gardenId, onMeta, onItems, onError) {
            const g = fs.doc(db, 'users', ownerId, 'gardens', gardenId);
            const stopMeta = fs.onSnapshot(g, snap => onMeta(snap.exists() ? snap.data() : null), onError);
            const stopItems = fs.onSnapshot(fs.collection(g, 'items'), snap => onItems(listOf(snap)), onError);
            return () => { stopMeta(); stopItems(); };
        },

        watchLibrary(cb, onError) {
            return fs.onSnapshot(col('library'), snap => cb(listOf(snap)), onError);
        },
        saveLibrary(id, entry) {
            return fs.setDoc(ref('library', id), entry);
        },
        deleteLibrary(id) {
            return fs.deleteDoc(ref('library', id));
        },
    };
}

/* Turn a Firebase error into a sentence a person can act on. */
export function firebaseErrorText(err) {
    const code = (err && err.code) || '';
    if (code === 'permission-denied') return "The database refused that. Check that firestore.rules was published (see README).";
    if (code === 'unavailable') return "Can't reach the database right now. Your changes will upload when the connection is back.";
    if (code === 'resource-exhausted') return 'The free database limit for today was reached. Try again tomorrow.';
    if (code === 'auth/unauthorized-domain') return "This web address isn't on the Firebase sign-in list yet. Add it under Authentication → Settings → Authorized domains.";
    if (code === 'auth/network-request-failed') return "Couldn't reach Google to sign in. Check your connection.";
    if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') return 'Google sign-in is turned off in Firebase. Turn it on under Authentication → Sign-in method.';
    return (err && err.message) || 'Something went wrong.';
}
