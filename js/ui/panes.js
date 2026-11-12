/*
 * ui/panes.js
 * ---------------------------------------------------------------------------
 * Three of the side panel's tabs:
 *   Now          this month: what's blooming, fruiting and starting next
 *                month, and this month's garden jobs
 *   Calendar     a bloom/fruit chart for every species with monthly totals,
 *                or (switch at the top) the care calendar: jobs for each month
 *   Items        the inventory: every item, searchable and filterable
 * (Check is ui/gardencheck.js; Library is ui/library.js.)
 *
 * Each render function rebuilds its pane from S. They're called by
 * renderAllUI() in main.js whenever something changes.
 */
import { S, scheduleUI } from '../state.js';
import { select, setMonth, displayName } from '../garden.js';
import { measureObstruct } from '../scene.js';
import { $, $$, h, MONTHS, MSHORT, inRange, fmtRange, nextM } from '../util.js';
import { KINDS, FORMS, FTYPES, STATUS, SEED_BROWN } from '../model.js';
import { swatch, bloomCounts, isThin, speciesKey } from './common.js';
import { stopPlay } from './months.js';
import { showBloomingInLibrary } from './library.js';
import { jobsFor, CARE_TAGS } from '../care.js';

/* One clickable row for an item: color swatch, name, a short note on the right. */
export function itemRow(kind, it, metaText) {
    let sw;
    if (kind === 'plants') {
        const m = S.month;
        const color = inRange(m, it.bloom) ? it.bloomColor : inRange(m, it.fruit) ? it.fruitColor : inRange(m, it.seed) ? SEED_BROWN : it.foliage;
        sw = swatch(color);
    } else if (kind === 'zones') {
        sw = swatch(it.color);
    } else {
        sw = swatch(null, 'feat');
    }
    const sub = kind === 'plants' ? (it.sci || FORMS[it.form]) : kind === 'features' ? FTYPES[it.type] : 'Bed / area';
    return h('button', { class: 'row', type: 'button', onclick: () => { select(`${kind}:${it.id}`, { fly: true }); collapseSheetOnPhone(); } },
        sw,
        h('span', { class: 'nm' }, displayName(it) + (it.count > 1 ? ` ×${it.count}` : ''), h('small', { text: sub })),
        h('span', { class: 'meta', text: metaText || (it.status && it.status !== 'established' ? STATUS[it.status] : '') }));
}

const byName = (a, b) => a.name.localeCompare(b.name);

/* ---------- This month ---------- */

export function renderNow() {
    const pane = $('#pane-now');
    const m = S.month;
    if (!S.loaded) { pane.replaceChildren(h('p', { class: 'empty', text: 'Loading the garden…' })); return; }
    const plants = [...S.items.plants.values()];
    if (!plants.length && !S.items.features.size && !S.items.zones.size) {
        pane.replaceChildren(
            h('p', { class: 'big', text: 'An empty garden' }),
            h('p', { class: 'lede', text: 'Start by adding what already grows here. Use Add for a plant, feature or bed, or open the Library to find natives for your area.' }),
            h('div', { class: 'actions', style: 'border:0;padding-top:8px' },
                h('button', { class: 'btn primary', type: 'button', text: 'Open the Library', onclick: () => switchTab('lib') })));
        return;
    }
    const shown = plants.filter(it => S.planned || it.status !== 'planned');
    const inBloom = shown.filter(it => inRange(m, it.bloom)).sort(byName);
    const fruit = shown.filter(it => inRange(m, it.fruit) || inRange(m, it.seed)).sort(byName);
    const starting = shown.filter(it => it.bloom && it.bloom[0] === nextM(m)).sort(byName);
    const { bloom } = bloomCounts(false);
    const thin = isThin(m, bloom[m - 1]);

    const kids = [
        h('p', { class: 'big', text: MONTHS[m - 1] }),
        h('p', { class: 'lede' }, `${bloom[m - 1]} species in bloom in the ground now`, thin ? ' · ' : '', thin ? h('b', { class: 'gold', text: 'thin month' }) : ''),
    ];
    if (thin || bloom[m - 1] === 0) {
        kids.push(h('p', { class: 'thin-link' }, h('button', { class: 'linkbtn', type: 'button', text: `Find natives that bloom in ${MONTHS[m - 1]}`, onclick: () => { showBloomingInLibrary(); switchTab('lib'); } })));
    }
    kids.push(h('h3', { text: 'In bloom' }));
    kids.push(inBloom.length
        ? h('div', { class: 'rows' }, inBloom.map(it => itemRow('plants', it, it.status === 'planned' ? 'Planned' : `to ${MSHORT[it.bloom[1] - 1]}`)))
        : h('p', { class: 'empty', text: 'Nothing flowering this month.' }));
    kids.push(h('h3', { text: 'Fruit & seed for birds' }));
    kids.push(fruit.length
        ? h('div', { class: 'rows' }, fruit.map(it => itemRow('plants', it, it.status === 'planned' ? 'Planned' : (inRange(m, it.fruit) ? 'fruit' : 'seed heads'))))
        : h('p', { class: 'empty', text: 'No fruit or seed heads this month.' }));
    kids.push(h('h3', { text: `Starting in ${MONTHS[nextM(m) - 1]}` }));
    kids.push(starting.length
        ? h('div', { class: 'rows' }, starting.map(it => itemRow('plants', it, fmtRange(it.bloom))))
        : h('p', { class: 'empty', text: 'Nothing new starts next month.' }));
    const jobs = jobsFor(m);
    kids.push(h('h3', { text: 'Garden jobs' }));
    kids.push(jobs.length ? h('div', { class: 'jobs' }, jobs.map(jobRow)) : h('p', { class: 'empty', text: 'Nothing pressing this month. Enjoy it.' }));
    kids.push(h('p', { class: 'thin-link' }, h('button', { class: 'linkbtn', type: 'button', text: 'See jobs for the whole year', onclick: () => { S.calView = 'care'; switchTab('cal'); } })));
    pane.replaceChildren(...kids);
}

/* ---------- care jobs ---------- */

/* One job: a label (Plant, Prune…), what to do, and links to the items it's about. */
function jobRow(job) {
    const links = job.ids.slice(0, 8).map(id => {
        for (const kind of KINDS) {
            const it = S.items[kind].get(id);
            if (it) return h('button', { class: 'linkbtn', type: 'button', text: displayName(it), onclick: () => { select(`${kind}:${id}`, { fly: true }); collapseSheetOnPhone(); } });
        }
        return null;
    }).filter(Boolean);
    return h('div', { class: `job ${job.tag}` },
        h('div', { class: 'jh' }, h('span', { class: 'jtag', text: CARE_TAGS[job.tag] }), h('b', { text: job.title })),
        h('p', { text: job.text }),
        links.length ? h('div', { class: 'who' }, links) : null);
}

/* The Calendar tab's care view: every month's jobs, starting with the current month. */
function renderCare(pane, head) {
    const kids = [head];
    for (let i = 0; i < 12; i++) {
        const m = ((S.month - 1 + i) % 12) + 1;
        const jobs = jobsFor(m);
        kids.push(h('h3', { class: m === S.month ? 'cur' : null }, h('button', { class: 'linkbtn plain', type: 'button', text: MONTHS[m - 1], title: `Go to ${MONTHS[m - 1]}`, onclick: () => { stopPlay(); setMonth(m); } })));
        kids.push(jobs.length ? h('div', { class: 'jobs' }, jobs.map(jobRow)) : h('p', { class: 'empty', text: 'No jobs.' }));
    }
    kids.push(h('p', { class: 'note', text: 'General guidance for a low-maintenance, wildlife-friendly native garden, worked out from what\'s in this garden. Your weather moves everything a few weeks either way.' }));
    pane.replaceChildren(...kids);
}

/* ---------- Calendar ---------- */

export function renderCalendar() {
    const pane = $('#pane-cal');
    // The switch at the top: bloom chart or care jobs.
    const head = h('div', { class: 'seg', role: 'group', 'aria-label': 'Calendar view' },
        ...[['bloom', 'Bloom & fruit'], ['care', 'Care jobs']].map(([k, label]) =>
            h('button', { type: 'button', 'aria-pressed': String(S.calView === k), onclick: () => { S.calView = k; renderCalendar(); } }, label)));
    if (S.calView === 'care') { renderCare(pane, head); return; }
    // One row per species (planned plants get their own row so they look different).
    const groups = new Map();
    for (const it of S.items.plants.values()) {
        if (!it.bloom && !it.fruit && !it.seed) continue;
        if (!S.calPlanned && it.status === 'planned') continue;
        const k = speciesKey(it) + '|' + (it.status === 'planned' ? 'p' : 'g');
        const g = groups.get(k);
        if (g) g.n += it.count;
        else groups.set(k, { it, n: it.count });
    }
    const rows = [...groups.values()].sort((a, b) => ((a.it.bloom?.[0] ?? 13) - (b.it.bloom?.[0] ?? 13)) || a.it.name.localeCompare(b.it.name));

    // A CSS grid: a name column, then 12 month columns.
    const cal = h('div', { class: 'cal', role: 'table', 'aria-label': 'Bloom and fruit calendar' });
    cal.append(h('div', { class: 'hd', style: 'cursor:default' }));
    MSHORT.forEach((nm, i) => cal.append(h('div', { class: 'hd' + (i + 1 === S.month ? ' cur' : ''), text: nm[0], title: MONTHS[i], onclick: () => { stopPlay(); setMonth(i + 1); } })));
    for (const { it, n } of rows) {
        const planned = it.status === 'planned';
        cal.append(h('div', { class: 'nm' + (planned ? ' planned' : ''), title: it.sci || it.name, onclick: () => select(`plants:${it.id}`, { fly: true }) }, it.name + (n > 1 ? ` ×${n}` : '')));
        for (let m = 1; m <= 12; m++) {
            const cell = h('div', { class: 'cell' + (m === S.month ? ' cur' : '') });
            if (inRange(m, it.bloom)) cell.append(h('b', { class: planned ? 'pl' : null, style: `background-color:${it.bloomColor}` }));
            if (inRange(m, it.fruit)) cell.append(h('s', { style: `background:${it.fruitColor}` }));
            else if (inRange(m, it.seed)) cell.append(h('s', { style: `background:${SEED_BROWN}` }));
            cal.append(cell);
        }
    }
    const { bloom, fruit } = bloomCounts(S.calPlanned);
    cal.append(h('div', { class: 'rule' }));
    cal.append(h('div', { class: 'sumh', text: 'Blooming' }));
    bloom.forEach((n, i) => cal.append(h('div', { class: 'sum' + (isThin(i + 1, n) ? ' gap' : ''), text: String(n), title: `${MONTHS[i]}: ${n} species blooming` })));
    cal.append(h('div', { class: 'sumh', text: 'Fruit / seed' }));
    fruit.forEach((n, i) => cal.append(h('div', { class: 'sum', text: String(n), title: `${MONTHS[i]}: ${n} species with fruit or seed` })));

    const cb = h('input', { type: 'checkbox', id: 'calPlanned', onchange: (e) => { S.calPlanned = e.target.checked; renderCalendar(); } });
    cb.checked = S.calPlanned;
    pane.replaceChildren(
        head,
        h('label', { class: 'toggle-line', for: 'calPlanned' }, cb, 'Include planned plants'),
        rows.length ? cal : h('p', { class: 'empty', text: 'No bloom or fruit months entered yet.' }),
        h('div', { class: 'legend' },
            h('span', {}, h('i'), 'Bloom'),
            h('span', {}, h('i', { class: 'f' }), 'Fruit or seed heads'),
            h('span', {}, h('i', { class: 'p' }), 'Planned')),
        h('p', { class: 'note', text: 'Highlighted counts are thin months: two or fewer species in bloom during the growing season. Filling them keeps food going for pollinators all year.' }),
    );
}

/* ---------- Inventory ---------- */

export function renderInventory() {
    const pane = $('#pane-inv');
    const q = S.invQuery.trim().toLowerCase();
    const f = S.invFilter;
    const all = [];
    for (const kind of KINDS) for (const it of S.items[kind].values()) all.push([kind, it]);
    const list = all.filter(([kind, it]) => {
        if (['plants', 'features', 'zones'].includes(f) && kind !== f) return false;
        if (f === 'planned' && it.status !== 'planned') return false;
        if (q && !`${displayName(it)} ${it.sci || ''} ${it.notes || ''}`.toLowerCase().includes(q)) return false;
        return true;
    }).sort((a, b) => KINDS.indexOf(a[0]) - KINDS.indexOf(b[0]) || a[1].name.localeCompare(b[1].name));

    // Build the search box once, so typing doesn't lose focus when the list redraws.
    if (!pane.querySelector('#invSearch')) {
        const search = h('input', { id: 'invSearch', class: 'search', type: 'search', placeholder: 'Search plants, features, notes', 'aria-label': 'Search inventory', oninput: (e) => { S.invQuery = e.target.value; renderInventory(); } });
        pane.replaceChildren(search, h('div', { class: 'seg', id: 'invSeg', role: 'group', 'aria-label': 'Filter' }), h('p', { class: 'count-line', id: 'invCount' }), h('div', { class: 'rows', id: 'invList' }));
    }
    pane.querySelector('#invSeg').replaceChildren(...[['all', 'All'], ['plants', 'Plants'], ['features', 'Features'], ['zones', 'Beds'], ['planned', 'Planned']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(f === k), onclick: () => { S.invFilter = k; renderInventory(); } }, label)));
    const nPlants = [...S.items.plants.values()].reduce((s, it) => s + it.count, 0);
    pane.querySelector('#invCount').textContent = `${nPlants} plants in ${S.items.plants.size} entries · ${S.items.features.size} features · ${S.items.zones.size} beds`;
    pane.querySelector('#invList').replaceChildren(...(list.length ? list.map(([kind, it]) => itemRow(kind, it)) : [h('p', { class: 'empty', text: 'No matches.' })]));
}

/* ---------- tabs and the phone bottom sheet ---------- */

export function switchTab(name) {
    S.tab = name;
    $$('.tab').forEach(x => x.setAttribute('aria-selected', String(x.id === 'tab-' + name)));
    $$('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + name; });
    if (document.body.classList.contains('sheet-collapsed')) setSheet(false);
    scheduleUI();
}

/* On phones the side panel is a bottom sheet that can be folded down. */
export function setSheet(collapsed) {
    document.body.classList.toggle('sheet-collapsed', collapsed);
    $('#sheetToggle').setAttribute('aria-expanded', String(!collapsed));
    $('#sheetToggle').setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
    measureObstruct();
}

export function collapseSheetOnPhone() {
    if (window.innerWidth <= 760) setSheet(true);
}

export function initPanes() {
    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.id.replace('tab-', ''))));
    $('#sheetToggle').addEventListener('click', () => setSheet(!document.body.classList.contains('sheet-collapsed')));
    if (window.innerWidth <= 760) setSheet(true);
}
