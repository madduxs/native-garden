/*
 * ui/toolbar.js
 * ---------------------------------------------------------------------------
 * The buttons at the bottom right (camera views, show/hide toggles, wind,
 * Edit layout, Add, Share), the Growth (years from now) menu, the Share menu
 * (a read-only link, and download / import a garden file), the "positions
 * are rough" notice, and keyboard shortcuts:
 *   ← / →   previous / next month
 *   Esc     close whatever is open, then leave Edit layout
 */
import { S, scheduleUI } from '../state.js';
import { setView, setEditVisuals, setLabelsVisible, setWind } from '../scene.js';
import { applyAllVisibility, applyMeta, upsertItem, select, setMonth, setYears } from '../garden.js';
import { Store } from '../store/index.js';
import { $, $$, h, toast, slug } from '../util.js';
import { exportGarden, parseGardenFile } from '../model.js';
import { stopPlay } from './months.js';

function setToggle(sel, on) { $(sel).setAttribute('aria-pressed', String(on)); }

/* Turn Edit layout on/off (pass nothing to flip it). */
export function toggleEdit(on) {
    if (S.readOnly) return;            // a shared garden can't be changed
    S.edit = on ?? !S.edit;
    setToggle('#tEdit', S.edit);
    setEditVisuals(S.edit);
    scheduleUI();                      // shows or hides a freeform bed's corner handles
    $('#stage').classList.remove('pointing', 'grab');
    if (S.edit) {
        toast(window.innerWidth <= 760
            ? 'Edit layout on: drag an item or a gold corner to move it. Use two fingers to move the camera.'
            : 'Edit layout on: drag items or the gold corners. Double-click an edge to add a corner, or a corner to remove it.', 4200);
    }
}

/* ---------- Share menu (the #dataMenu element: share link, download, import) ---------- */

function downloadText(filename, text) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/*
 * The share section: a link anyone can open to look at (not change) this
 * garden. Only for gardens saved to a Google account, since the link reads
 * from the cloud database.
 */
function shareSection() {
    const box = h('div', { class: 'share' }, h('h3', { text: 'Share a link' }));
    if (S.mode !== 'cloud') {
        box.append(h('p', { text: 'Gardens saved in this browser can\'t be shared with a link. Sign in with Google (click the garden name) and copy this garden into your account first.' }));
        return box;
    }
    const on = S.meta.shared;
    const toggle = h('input', { type: 'checkbox', id: 'shareOn' });
    toggle.checked = on;
    toggle.addEventListener('change', () => {
        Store.setShared(toggle.checked);
        toast(toggle.checked ? 'Sharing is on. Anyone with the link can look.' : 'Sharing is off. The old link stops working.');
        renderDataMenu();
    });
    box.append(h('label', { class: 'toggle-line', for: 'shareOn' }, toggle, 'Anyone with the link can view'));
    if (on) {
        const link = Store.shareLink();
        const field = h('input', { type: 'text', readonly: true, value: link, class: 'linkfield', 'aria-label': 'Share link', onfocus: (e) => e.target.select() });
        const copy = h('button', { class: 'btn primary', type: 'button', text: 'Copy link' });
        copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(link); toast('Link copied.'); }
            catch (e) { field.focus(); field.select(); toast('Press Ctrl+C (or ⌘C) to copy.'); }
        });
        box.append(h('div', { class: 'linkrow' }, field, copy));
        box.append(h('p', { text: 'They see the plants, layout and the county it\'s in, and changes you make show up for them live. They can\'t change anything. Turn this off to stop the link working.' }));
    } else {
        box.append(h('p', { text: 'Turn this on to get a link friends can open in any browser, no account needed, to look around your garden in 3D.' }));
    }
    return box;
}

function renderDataMenu(extra) {
    const m = $('#dataMenu');
    const dl = h('button', { class: 'btn primary', type: 'button', text: 'Download garden file' });
    dl.addEventListener('click', () => {
        const data = exportGarden(S.meta, S.items, S.library.saved);
        downloadText(`${slug(S.meta.name)}.json`, JSON.stringify(data, null, 2));
        toast('Downloaded.');
    });
    if (S.readOnly) {
        // Someone else's garden: they can keep a copy and import it into a garden of their own.
        m.replaceChildren(h('h3', { text: 'Download a copy' }),
            h('p', { text: 'Save this garden as a file. You can import it into a garden of your own to use as a starting point.' }),
            h('div', { class: 'stack' }, dl));
        return;
    }
    const where = S.mode === 'cloud'
        ? 'Changes save to your account automatically. Download a copy as a backup.'
        : 'Changes save in this browser only. Download a copy as a backup, or to move this garden to another device.';
    const imp = h('button', { class: 'btn', type: 'button', text: 'Import a garden file…', onclick: () => $('#importFile').click() });
    m.replaceChildren(shareSection(), h('h3', { text: 'Garden data' }), h('p', { text: where }), h('div', { class: 'stack' }, dl, imp), extra || null);
}

function closeDataMenu() {
    $('#dataMenu').hidden = true;
    $('#tData').setAttribute('aria-expanded', 'false');
}

/* After choosing a file: read it, then ask before importing. */
async function onImportFile(file) {
    let parsed;
    try {
        parsed = parseGardenFile(JSON.parse(await file.text()));
    } catch (err) {
        renderDataMenu(h('p', { class: 'note err', text: err instanceof SyntaxError ? "That file isn't valid JSON." : err.message }));
        return;
    }
    const { counts, meta } = parsed;
    const empty = !S.items.plants.size && !S.items.features.size && !S.items.zones.size;
    const outlineBox = h('input', { type: 'checkbox', id: 'impOutline' });
    outlineBox.checked = empty;
    const go = h('button', { class: 'btn primary', type: 'button', text: `Import ${counts.plants} plants, ${counts.features} features, ${counts.zones} beds` });
    go.addEventListener('click', async () => {
        go.disabled = true;
        go.textContent = 'Importing…';
        await importParsed(parsed, outlineBox.checked);
        closeDataMenu();
        toast('Imported.');
    });
    renderDataMenu(h('div', { class: 'stack', style: 'margin-top:10px' },
        h('p', { text: `Into “${S.meta.name}”. Entries with the same id are replaced; nothing else is deleted.` }),
        meta.outline ? h('label', { class: 'toggle-line', for: 'impOutline' }, outlineBox, "Also use the file's garden outline") : null,
        go));
}

/* Put a parsed garden file into the open garden (and save it). */
export async function importParsed(parsed, useOutline) {
    for (const x of parsed.items) upsertItem(x.kind, x.id, x.data, { force: true });
    if (useOutline && parsed.meta.outline) {
        applyMeta({ ...S.meta, outline: parsed.meta.outline, layoutPlaceholder: parsed.meta.layoutPlaceholder, notice: parsed.meta.notice });
        Store.saveMeta();
    }
    await Store.importItems(parsed.items);
    for (const e of parsed.library) if (!S.library.saved.has(e.id)) await Store.saveLibrary(e);
    setView(S.view);
}

/* ---------- the "positions are rough" notice ---------- */

export function renderNotice() {
    const n = $('#notice');
    const show = S.loaded && S.meta && S.meta.layoutPlaceholder && !S.noticeDismissed && S.items.plants.size > 0;
    n.hidden = !show;
    if (!show) return;
    const custom = (S.meta.notice || '').trim();
    n.replaceChildren(
        custom ? h('div', { text: custom })
            : h('div', {}, h('b', { text: 'Positions are rough placeholders. ' }), 'Turn on Edit layout and drag each item to where it really is.'),
        h('button', {
            class: 'btn', type: 'button', text: 'Got it',
            onclick: () => { S.noticeDismissed = true; S.meta.layoutPlaceholder = false; Store.saveMeta(); renderNotice(); },
        }));
}

/* ---------- wiring ---------- */

export function initToolbar() {
    $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

    setToggle('#tLabels', S.labels);
    $('#tLabels').addEventListener('click', () => {
        S.labels = !S.labels;
        setToggle('#tLabels', S.labels);
        setLabelsVisible(S.labels);
    });
    $('#tMature').addEventListener('click', () => {
        S.mature = !S.mature;
        setToggle('#tMature', S.mature);
        applyAllVisibility();
        if (S.mature) toast('Blue shells show each tree and shrub at mature size.');
    });
    $('#tPlanned').addEventListener('click', () => {
        S.planned = !S.planned;
        setToggle('#tPlanned', S.planned);
        applyAllVisibility();
        scheduleUI();
    });
    setToggle('#tWind', S.wind);
    $('#tWind').addEventListener('click', () => {
        setWind(!S.wind);
        setToggle('#tWind', S.wind);
    });
    $('#years').addEventListener('change', (ev) => {
        setYears(Number(ev.target.value) || 0);
        if (S.years) toast(`Trees and shrubs shown ${S.years} year${S.years === 1 ? '' : 's'} from now, if they have a mature size set.`, 3500);
    });
    $('#tEdit').addEventListener('click', () => toggleEdit());
    $('#tAdd').addEventListener('click', () => {
        if (S.readOnly) return;
        select(null);
        S.form = { mode: 'new', kind: 'plants' };
        scheduleUI();
    });
    $('#tData').addEventListener('click', () => {
        const m = $('#dataMenu');
        const open = m.hidden;
        if (open) renderDataMenu();
        m.hidden = !open;
        $('#tData').setAttribute('aria-expanded', String(open));
    });
    $('#importFile').addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';           // so choosing the same file again still fires
        if (file && S.gardenId) onImportFile(file);
    });

    window.addEventListener('keydown', (ev) => {
        const tag = (ev.target && ev.target.tagName) || '';
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || !S.gardenId || document.body.classList.contains('home-open')) return;
        if (ev.key === 'Escape') {
            if (!$('#dataMenu').hidden) { closeDataMenu(); return; }
            if (S.form) { S.form = null; scheduleUI(); return; }
            if (S.libSel) { S.libSel = null; scheduleUI(); return; }
            if (S.sel) { select(null); return; }
            if (S.edit) toggleEdit(false);
        }
        if (ev.key === 'ArrowRight' && !ev.altKey) { stopPlay(); setMonth(S.month + 1); }
        if (ev.key === 'ArrowLeft' && !ev.altKey) { stopPlay(); setMonth(S.month - 1); }
    });
}
