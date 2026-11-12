/*
 * ui/months.js
 * ---------------------------------------------------------------------------
 * The month strip across the top: 12 buttons, each with a little bar showing
 * how many species bloom that month (dashed outline = thin month), plus a
 * play button that steps through the year.
 */
import { S } from '../state.js';
import { setMonth } from '../garden.js';
import { $, h, MONTHS, MSHORT, reduceMotion } from '../util.js';
import { bloomCounts, isThin } from './common.js';

let playTimer = 0;

export function renderMonthStrip() {
    const box = $('#months');
    const { bloom } = bloomCounts(false);
    const max = Math.max(4, ...bloom);
    box.replaceChildren(...MSHORT.map((nm, i) => {
        const m = i + 1, n = bloom[i], thin = isThin(m, n);
        return h('button', {
            class: 'mo' + (thin ? ' thin' : ''), type: 'button', 'aria-pressed': String(m === S.month),
            'aria-label': `${MONTHS[i]}: ${n} in bloom`,
            title: `${MONTHS[i]}: ${n} species in bloom${thin ? ' (thin month)' : ''}`,
            onclick: () => { stopPlay(); setMonth(m); },
        }, h('span', { class: 'bar' }, h('i', { style: `height:${Math.round(n / max * 100)}%` })), nm[0]);
    }));
    $('#mname').replaceChildren(MONTHS[S.month - 1], h('small', { text: `${bloom[S.month - 1]} in bloom` }));
}

export function stopPlay() {
    if (!playTimer) return;
    clearInterval(playTimer);
    playTimer = 0;
    $('#playIcon').setAttribute('d', 'M4 2.5v11l9-5.5z');            // ▶
    $('#play').setAttribute('aria-label', 'Play through the year');
}

export function initMonths() {
    $('#play').addEventListener('click', () => {
        if (playTimer) { stopPlay(); return; }
        $('#playIcon').setAttribute('d', 'M4 2.5h3v11H4zM9 2.5h3v11H9z');   // ❚❚
        $('#play').setAttribute('aria-label', 'Pause');
        setMonth(S.month + 1);
        playTimer = setInterval(() => setMonth(S.month + 1), reduceMotion ? 2200 : 1300);
    });
}
