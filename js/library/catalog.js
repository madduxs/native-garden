/*
 * library/catalog.js
 * ---------------------------------------------------------------------------
 * Loads the starter plant list (data/catalog.json) into S.library.catalog.
 *
 * The starter list is a plain JSON file you can edit by hand. Each plant looks
 * like the entries described in cleanLib() in model.js. To add a plant, copy
 * an existing entry, give it a new "id", and change the details. If you
 * regenerate it with a script, keep the same shape.
 */
import { S, scheduleUI } from '../state.js';
import { cleanLib } from '../model.js';
import { fetchJSON, str } from '../util.js';

export async function loadCatalog() {
    try {
        const js = await fetchJSON('data/catalog.json', { cache: false });
        S.library.catalog = (Array.isArray(js.plants) ? js.plants : []).map(p => cleanLib(p, 'catalog'));
        S.library.about = str(js.about, '', 800);
        S.library.loaded = true;
    } catch (err) {
        console.error('Starter plant list failed to load:', err);
        S.library.failed = true;
    }
    scheduleUI();
}
