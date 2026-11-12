/*
 * config.js
 * ---------------------------------------------------------------------------
 * The one file you edit to connect the app to YOUR Firebase project.
 *
 * Until FIREBASE_CONFIG is filled in, the app still works: it runs in
 * "browser only" mode and saves gardens in this browser's localStorage.
 * Once it's filled in, people can sign in with Google and their gardens
 * sync between their phone and computer.
 *
 * Where these values come from (full steps are in README.md):
 *   Firebase console → your project → Project settings (gear icon)
 *   → "Your apps" → the web app (</>) → "SDK setup and configuration"
 *   → choose "Config" and copy the object it shows.
 *
 * Is it safe to put these in a public GitHub repo?  Yes. A Firebase web
 * "apiKey" is not a password; it only identifies which project to talk to.
 * What actually protects everyone's data is firestore.rules (in the repo
 * root), which only lets a signed-in person read and write their own data.
 */

export const FIREBASE_CONFIG = {
    apiKey: '',
    authDomain: '',          // looks like: your-project-id.firebaseapp.com
    projectId: '',           // looks like: your-project-id
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
};

/*
 * Which version of the Firebase JavaScript SDK to load from Google's CDN.
 * The app imports it straight from https://www.gstatic.com/firebasejs/<version>/
 * so there's nothing to install. Newer versions usually work; if something
 * breaks after changing this, change it back.
 */
export const FIREBASE_SDK_VERSION = '12.19.0';

/* The name shown in the browser tab and on the welcome screen. */
export const APP_NAME = 'Native Garden';

/* True when the Firebase settings above have been filled in. */
export function firebaseReady() {
    return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.authDomain);
}
