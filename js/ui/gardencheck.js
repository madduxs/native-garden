/*
 * ui/gardencheck.js
 * ---------------------------------------------------------------------------
 * The Check tab: draws the Garden Check report from gardencheck.js.
 *   - things worth a second look, worst first, each linked to its plants
 *   - the year at a glance: how many species bloom and fruit each month
 *   - wildlife support: how many species feed bees, butterflies, birds…
 *   - good signs
 * Also checkNote(), the "Garden Check" lines in a plant's detail panel.
 */
import { S, scheduleUI } from '../state.js';
import { select, setMonth } from '../garden.js';
import { $, h, MONTHS, MSHORT } from '../util.js';
import { TAGS, SUN } from '../model.js';
import { gardenCheck, issuesFor } from '../gardencheck.js';
import { isThin } from './common.js';
import { showInLibrary } from './library.js';
import { toggleSunMap } from './sunpanel.js';
import { openHome } from './gardens.js';
import { stopPlay } from './months.js';

const SEV_LABEL = { bad: 'Fix', warn: 'Check', info: 'Idea' };

/* Which kind of item an id belongs to, as a selection key ("plants:id"). */
function keyFor(id) {
    for (const kind of ['plants', 'features', 'zones']) if (S.items[kind].has(id)) return `${kind}:${id}`;
    return null;
}

/* Do what an issue's button says. switchTab is passed in to avoid a circular import with panes.js. */
function runAction(a, switchTab) {
    if (a.run === 'sunmap') {
        stopPlay();
        if (a.month) setMonth(a.month);
        if (!S.sunMap) toggleSunMap(true);
    } else if (a.run === 'settings') {
        openHome('settings');
    } else if (a.run === 'library') {
        if (a.month) { stopPlay(); setMonth(a.month); }
        showInLibrary({ month: !!a.month, tag: a.tag });
        switchTab('lib');
    }
}

function issueRow(issue, switchTab) {
    const names = issue.ids.map(keyFor).filter(Boolean).map(key => {
        const [kind, id] = key.split(':');
        const it = S.items[kind].get(id);
        return h('button', { class: 'linkbtn', type: 'button', text: it.name, onclick: () => select(key, { fly: true }) });
    });
    return h('div', { class: `issue ${issue.sev}` },
        h('div', { class: 'ih' }, h('span', { class: 'sev', text: SEV_LABEL[issue.sev] }), h('b', { text: issue.title })),
        h('p', { text: issue.text }),
        names.length ? h('div', { class: 'who' }, ...names) : null,
        issue.action ? h('button', { class: 'btn small', type: 'button', text: issue.action.label, onclick: () => runAction(issue.action, switchTab) }) : null);
}

/* Twelve little columns: species in bloom (top) and with fruit or seed (bottom). */
function yearStrip(w) {
    const max = Math.max(1, ...w.bloom);
    return h('div', { class: 'yearstrip', role: 'table', 'aria-label': 'Species blooming and fruiting each month' },
        ...w.bloom.map((n, i) => h('button', {
            type: 'button', class: 'ym' + (isThin(i + 1, n) ? ' gap' : '') + (i + 1 === S.month ? ' cur' : ''),
            title: `${MONTHS[i]}: ${n} in bloom, ${w.fruit[i]} with fruit or seed`,
            onclick: () => { stopPlay(); setMonth(i + 1); },
        },
            h('span', { class: 'bar' }, h('i', { style: `height:${Math.round((n / max) * 100)}%` })),
            h('span', { class: 'n', text: String(n) }),
            h('span', { class: 'f', text: w.fruit[i] ? '●' : '' }),
            h('span', { class: 'm', text: MSHORT[i][0] }))));
}

export function renderCheck(switchTab) {
    const pane = $('#pane-chk');
    if (!S.loaded) { pane.replaceChildren(h('p', { class: 'empty', text: 'Loading the garden…' })); return; }
    if (!S.items.plants.size) {
        pane.replaceChildren(h('p', { class: 'big', text: 'Garden Check' }),
            h('p', { class: 'lede', text: 'Add some plants and Garden Check will look at spacing, sun, winter hardiness and food for wildlife.' }));
        return;
    }
    const r = gardenCheck();
    const fix = r.issues.filter(i => i.sev !== 'info').length, ideas = r.issues.length - fix;
    const cb = h('input', { type: 'checkbox', id: 'chkPlanned', onchange: (e) => { S.checkPlanned = e.target.checked; scheduleUI(); } });
    cb.checked = S.checkPlanned;

    const kids = [
        h('p', { class: 'big', text: 'Garden Check' }),
        h('p', { class: 'lede', text: fix || ideas
            ? `${fix ? `${fix} thing${fix === 1 ? '' : 's'} to look at` : 'Nothing to fix'}${ideas ? ` · ${ideas} idea${ideas === 1 ? '' : 's'}` : ''}`
            : 'Nothing to fix. Nice work.' }),
        h('label', { class: 'toggle-line', for: 'chkPlanned' }, cb, 'Include planned plants'),
    ];
    if (r.issues.length) kids.push(h('div', { class: 'issues' }, ...r.issues.map(i => issueRow(i, switchTab))));

    kids.push(h('h3', { text: 'The year at a glance' }), yearStrip(r.wildlife),
        h('p', { class: 'note', text: 'Bars: species in bloom. Dots: fruit or seed heads for birds. Highlighted: thin months. Click a month to go to it.' }));

    if (r.wildlife.tagsKnown) {
        kids.push(h('h3', { text: 'Wildlife support' }),
            h('div', { class: 'chips tagcount' }, ...Object.entries(TAGS).map(([k, label]) => {
                const n = r.wildlife.tagCount[k];
                return h('button', {
                    type: 'button', class: 'chip tag' + (n ? '' : ' none'), title: `Find plants for ${label.toLowerCase()} in the library`,
                    onclick: () => { showInLibrary({ tag: k }); switchTab('lib'); },
                }, `${label} `, h('b', { text: String(n) }));
            })),
            h('p', { class: 'note', text: `Species in the garden that support each. Click one to find more in the library.` }));
    }

    if (r.good.length) kids.push(h('h3', { text: 'Good signs' }), h('ul', { class: 'good' }, ...r.good.map(g => h('li', { text: g }))));

    const parts = [];
    if (r.stats.noLight) parts.push(`${r.stats.noLight} plant${r.stats.noLight === 1 ? " doesn't" : "s don't"} have light needs listed, so their sun wasn't checked.`);
    parts.push(`Sun is measured for ${MONTHS[r.month - 1]}, with shade from buildings, walls, hedges, trees and big shrubs${S.years ? ` grown ${S.years} years` : ''}. Spacing uses mature widths. This is general guidance, worked out from what's entered.`);
    kids.push(h('p', { class: 'note', text: parts.join(' ') }));
    pane.replaceChildren(...kids);
}

/* For a plant's detail panel: its summer sun and any Garden Check issues. */
export function checkNote(it) {
    if (!S.loaded) return null;
    const { issues, sun, month } = issuesFor(it.id);
    if (!sun && !issues.length) return null;
    return h('div', { class: 'checknote' },
        h('h3', { text: 'Garden Check' }),
        sun ? h('p', {}, `About ${sun.hours.toFixed(1)} hours of direct sun on a ${MONTHS[month - 1]} day here: `, h('b', { text: SUN[sun.got].toLowerCase() }), '.') : null,
        ...issues.map(i => h('p', { class: `issue-line ${i.sev}` }, h('b', { text: `${i.title}. ` }), i.text)));
}
