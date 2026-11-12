/*
 * ui/sunpanel.js
 * ---------------------------------------------------------------------------
 * The "Sun map" button and its small panel:
 *   - a color key for the hours-of-sun overlay (sun.js draws the overlay)
 *   - how much of the garden is full sun / part sun / shade this month
 *   - a time-of-day slider that moves the 3D sun, so you can watch shadows
 *     sweep across the garden from morning to evening
 */
import { S, scheduleUI } from '../state.js';
import { seasonGround } from '../scene.js';
import { setSunMap, refreshSunMap, sunSummary, gardenLat } from '../sun.js';
import { dayLength, fmtHour } from '../sunpath.js';
import { $, h, MONTHS, loadPref, savePref } from '../util.js';

/* The overlay's colors, low to high (keep in step with RAMP in sun.js). */
const KEY = [
    ['0', '#283c8c'], ['3 h', '#2896a0'], ['4½', '#78be5a'], ['6 h', '#f0d23c'], ['9+', '#f08228'],
];

/* Move the 3D sun to a time of day (sun time). */
export function setHour(hour) {
    S.hour = hour;
    savePref('hour', hour);
    seasonGround(S.month);
}

export function renderSunPanel() {
    const panel = $('#sunPanel');
    $('#tSun').setAttribute('aria-pressed', String(S.sunMap));
    refreshSunMap();
    panel.hidden = !S.sunMap || !S.meta;
    if (panel.hidden) return;

    // Keep the slider's thumb if someone is dragging it right now.
    const slider = panel.querySelector('input[type=range]');
    if (slider && document.activeElement === slider) return;

    const lat = gardenLat();
    const day = dayLength(lat, S.month);
    const [from, to] = day ? [Math.ceil(day[0] * 4) / 4, Math.floor(day[1] * 4) / 4] : [6, 18];
    const hourText = h('span', { class: 'hour', text: fmtHour(S.hour) });
    const range = h('input', {
        type: 'range', min: String(from), max: String(to), step: '0.25', value: String(Math.min(to, Math.max(from, S.hour))),
        'aria-label': 'Time of day for the shadows',
    });
    range.addEventListener('input', () => {
        setHour(Number(range.value));
        hourText.textContent = fmtHour(S.hour);
    });

    // The summary line, once the map has been worked out.
    const sum = sunSummary();
    let summary;
    if (!sum) summary = h('p', { class: 'muted', text: 'Working out the sun…' });
    else {
        const pc = (n) => Math.round((n / sum.cells) * 100);
        summary = h('p', {},
            `In ${MONTHS[S.month - 1]} (about ${Math.round(sum.dayLength)} hours of daylight): `,
            h('b', { text: `${pc(sum.full)}%` }), ' full sun, ',
            h('b', { text: `${pc(sum.part)}%` }), ' part sun, ',
            h('b', { text: `${pc(sum.shade)}%` }), ' shade.');
    }

    panel.replaceChildren(
        h('div', { class: 'sunhead' },
            h('h3', { text: 'Sun and shade' }),
            h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close the sun map', text: '×', onclick: () => toggleSunMap(false) })),
        h('div', { class: 'sunkey', role: 'img', 'aria-label': 'Color key: blue is under 3 hours of sun, green about 4 to 5, yellow 6, orange 9 or more' },
            ...KEY.map(([label, color]) => h('span', { style: `--c:${color}` }, label))),
        h('p', { class: 'small', text: 'Hours of direct sun on an average day: under 3 is shade, 3–6 part sun, 6+ full sun.' }),
        summary,
        h('label', { class: 'sunslider' }, h('span', {}, 'Shadows at ', hourText), range),
        h('p', { class: 'small muted', text: 'Counts shade from buildings, walls, fences, hedges, trees and big shrubs (at the Growth year you picked). "Sun time": noon is when the sun is highest; your clock usually says 12:30–1:30 then.' }),
    );
}

export function toggleSunMap(on) {
    setSunMap(on ?? !S.sunMap);
    savePref('sunMap', S.sunMap);
    scheduleUI();
}

export function initSunPanel() {
    S.hour = Number(loadPref('hour', 14)) || 14;
    S.sunMap = loadPref('sunMap', false) === true;
    $('#tSun').addEventListener('click', () => toggleSunMap());
}
