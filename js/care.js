/*
 * care.js
 * ---------------------------------------------------------------------------
 * The care calendar: garden jobs for each month, worked out from what's in
 * the garden.
 *
 *   careCalendar()   twelve lists of jobs, January first (cached until something changes)
 *   jobsFor(month)   one month's jobs
 *
 * A job looks like { title, text, ids: [item ids], tag } where tag is one of
 * 'plant', 'prune', 'water', 'wildlife', 'tidy', for the little label.
 *
 * The rules are general guidance for native gardens: low-input, wildlife
 * first (leave stems and seed heads, leave the leaves). Timing is written for
 * the northern hemisphere's seasons and shifted six months south of the
 * equator. Local weather moves everything a few weeks either way.
 *
 * To add a rule, add a line in buildJobs() that pushes a job into one of the
 * months with add(seasonMonth, job). seasonMonth is the northern month
 * (3 = March = early spring); add() converts it for southern gardens.
 */
import { S } from './state.js';
import { traitsOf } from './library/match.js';
import { genusOf } from './flora/shapes.js';

const names = (list, max = 4) => {
    const n = list.map(p => p.name);
    const uniq = [...new Set(n)];
    const shown = uniq.slice(0, max);
    const more = uniq.length - shown.length;
    return shown.join(', ') + (more > 0 ? ` and ${more} more` : '');
};

function buildJobs() {
    const lat = S.meta?.place?.lat ?? 35;
    const months = Array.from({ length: 12 }, () => []);
    // Northern "season month" → this garden's month (the same in the north; six months on in the south).
    const toMonth = (sm) => (lat < 0 ? ((sm + 5) % 12) + 1 : sm);
    const add = (sm, job) => months[toMonth(sm) - 1].push(job);
    // A plant's own months (bloom, seed…) are already this garden's months.
    const addAt = (m, job) => months[m - 1].push(job);

    const all = [...S.items.plants.values()];
    const growing = all.filter(p => p.status !== 'planned' && p.status !== 'removing');
    const planned = all.filter(p => p.status === 'planned');
    const of = (forms, list = growing) => list.filter(p => forms.includes(p.form));
    const ids = (list) => list.map(p => p.id);

    /* ---- planting ---- */
    const plantWoody = of(['tree', 'shrub', 'vine'], planned);
    if (plantWoody.length) {
        add(10, { tag: 'plant', ids: ids(plantWoody), title: `Plant trees and shrubs: ${names(plantWoody)}`,
            text: 'Fall is the best time: the soil is still warm, so roots grow all winter before summer heat. Water at planting and every week or two without rain until the ground freezes.' });
        add(3, { tag: 'plant', ids: ids(plantWoody), title: `Spring window for trees and shrubs: ${names(plantWoody, 3)}`,
            text: 'Fall is better, but early spring works: plant before they leaf out, and plan to water through the first summer.' });
    }
    const plantSoft = of(['forb', 'grass', 'iris'], planned);
    if (plantSoft.length) {
        add(4, { tag: 'plant', ids: ids(plantSoft), title: `Plant: ${names(plantSoft)}`,
            text: "Spring planting after the last hard frost. Plugs and small pots establish fastest. Water every few days for the first two weeks, then whenever it hasn't rained for a week." });
        add(9, { tag: 'plant', ids: ids(plantSoft), title: 'Fall planting window',
            text: `Early fall works too for ${names(plantSoft, 3)}: warm soil, cooler air, and fall rains do most of the watering.` });
    }
    const sowAnnual = of(['annual'], planned);
    if (sowAnnual.length) {
        add(11, { tag: 'plant', ids: ids(sowAnnual), title: `Sow seed: ${names(sowAnnual)}`,
            text: 'Many native annuals need winter cold to sprout. Scatter seed on bare, raked soil and press it in; don\'t bury it deep.' });
    }
    const plantCactus = of(['cactus'], planned);
    if (plantCactus.length) {
        add(5, { tag: 'plant', ids: ids(plantCactus), title: `Plant: ${names(plantCactus)}`,
            text: 'Plant cacti in warm weather, in fast-draining soil. Let cut pads dry for a week first, and wait a week before the first watering.' });
    }
    const removing = all.filter(p => p.status === 'removing');
    if (removing.length) {
        add(10, { tag: 'tidy', ids: ids(removing), title: `Take out: ${names(removing)}`,
            text: 'Remove these before they set seed, and replant the gap with a native so weeds don\'t move in.' });
    }

    /* ---- first-year watering ---- */
    const fresh = growing.filter(p => p.status === 'new');
    if (fresh.length) {
        for (const sm of [6, 7, 8]) {
            add(sm, { tag: 'water', ids: ids(fresh), title: 'Water new plantings',
                text: `${names(fresh)}: about an inch of water a week in their first summer, soaking deeply rather than sprinkling daily. Established natives rarely need it.` });
        }
    }
    const thirsty = growing.filter(p => traitsOf(p).water === 'moist');
    if (thirsty.length) {
        add(7, { tag: 'water', ids: ids(thirsty), title: 'Watch the moisture-lovers',
            text: `${names(thirsty)} like moist ground; give them a deep soak in dry spells.` });
    }

    /* ---- cutting back and leaving things standing ---- */
    const stems = of(['forb', 'grass', 'iris']);
    if (stems.length) {
        add(3, { tag: 'tidy', ids: ids(stems), title: 'Cut back last year\'s stems',
            text: `Once days stay above about 50°F, cut ${names(stems, 3)} down to 8–15 inches. The hollow stubs become nests for small native bees, and new growth hides them in weeks. Chop the cut stems and leave them as mulch.` });
    }
    const seedy = growing.filter(p => p.seed && ['forb', 'grass', 'annual'].includes(p.form));
    const bySeedMonth = new Map();
    for (const p of seedy) {
        const m = p.seed[0];
        if (!bySeedMonth.has(m)) bySeedMonth.set(m, []);
        bySeedMonth.get(m).push(p);
    }
    for (const [m, list] of bySeedMonth) {
        addAt(m, { tag: 'wildlife', ids: ids(list), title: `Leave seed heads: ${names(list)}`,
            text: 'Skip the deadheading. Goldfinches, sparrows and juncos eat the seed through fall and winter, and the stems look good in frost.' });
    }
    const annuals = of(['annual']);
    if (annuals.length) {
        const m = annuals[0].seed ? annuals[0].seed[0] : toMonth(8);
        addAt(m, { tag: 'tidy', ids: ids(annuals), title: 'Let annuals drop seed',
            text: `${names(annuals)} come back from seed. Leave the plants until the seed has fallen, then pull or shake them over bare spots.` });
    }

    /* ---- trees and shrubs ---- */
    const woody = of(['tree', 'shrub']);
    const oaks = woody.filter(p => genusOf(p.sci) === 'Quercus');
    const others = woody.filter(p => genusOf(p.sci) !== 'Quercus');
    if (oaks.length) {
        add(1, { tag: 'prune', ids: ids(oaks), title: 'Prune oaks only now, if at all',
            text: `Prune ${names(oaks)} in the dead of winter. Fresh cuts in spring and early summer attract the beetles that spread oak wilt. Seal any cut made outside winter.` });
    }
    // Spring bloomers flower on last year's wood: prune right after they bloom.
    const springBloom = others.filter(p => p.bloom && p.form === 'shrub' && seasonOf(p.bloom[1], lat) <= 5);
    for (const p of springBloom) {
        addAt(nextMonth(p.bloom[1]), { tag: 'prune', ids: [p.id], title: `Prune ${p.name} after it flowers`,
            text: 'It blooms on last year\'s wood, so shape it now (if needed) and next spring\'s buds have time to form.' });
    }
    const winterPrune = others.filter(p => !springBloom.includes(p));
    if (winterPrune.length) {
        add(2, { tag: 'prune', ids: ids(winterPrune), title: 'Prune while dormant',
            text: `For ${names(winterPrune, 3)}: take out dead, damaged and crossing branches while the leaves are off and you can see the shape. Less is more; natives rarely need it.` });
    }
    if (woody.some(p => p.form === 'tree')) {
        add(11, { tag: 'wildlife', ids: ids(woody.filter(p => p.form === 'tree')), title: 'Leave the leaves',
            text: 'Rake fallen leaves onto beds instead of bagging them. Many moths, butterflies and fireflies spend the winter in leaf litter, and it feeds the soil.' });
    }
    const fruiting = growing.filter(p => p.fruit);
    const byFruit = new Map();
    for (const p of fruiting) {
        const m = p.fruit[0];
        if (!byFruit.has(m)) byFruit.set(m, []);
        byFruit.get(m).push(p);
    }
    for (const [m, list] of byFruit) {
        addAt(m, { tag: 'wildlife', ids: ids(list), title: `Fruit ripening: ${names(list)}`,
            text: 'Leave most of it for the birds; they\'ll strip a shrub in days during migration.' });
    }

    /* ---- particular plants ---- */
    const milkweed = growing.filter(p => genusOf(p.sci) === 'Asclepias');
    if (milkweed.length) {
        for (const sm of [5, 8]) {
            add(sm, { tag: 'wildlife', ids: ids(milkweed), title: 'Look for monarch caterpillars',
                text: `Check the leaves of ${names(milkweed)} for striped caterpillars and tiny white eggs. Don't spray anything nearby, even "organic" sprays.` });
        }
    }

    /* ---- beds ---- */
    const mulched = [...S.items.zones.values()].filter(z => z.surface === 'mulch');
    if (mulched.length) {
        add(4, { tag: 'tidy', ids: mulched.map(z => z.id), title: 'Top up mulch',
            text: 'Keep shredded wood or leaf mulch 2–3 inches deep, pulled back from stems. As plants fill in, you\'ll need less of it: they become the mulch.' });
    }
    if (all.length) {
        add(5, { tag: 'tidy', ids: [], title: 'Weed while they\'re small',
            text: 'Pull weeds after a rain when roots slide out, before they set seed. A few minutes a week now saves hours in July.' });
    }

    /* ---- wildlife features ---- */
    const feats = [...S.items.features.values()];
    const ft = (types) => feats.filter(f => types.includes(f.type));
    const boxes = ft(['nestbox']);
    if (boxes.length) {
        add(2, { tag: 'wildlife', ids: boxes.map(f => f.id), title: 'Clean out nest boxes',
            text: 'Empty old nests before birds start scouting. Check that the door, vents and drain holes are clear.' });
        add(4, { tag: 'wildlife', ids: boxes.map(f => f.id), title: 'Check nest boxes weekly',
            text: 'A quick peek (tap first) lets you catch house sparrows or wasps early. Record what you see on NestWatch if you like.' });
    }
    const martins = ft(['martin']);
    if (martins.length) {
        add(2, { tag: 'wildlife', ids: martins.map(f => f.id), title: 'Open the martin gourds',
            text: 'Have gourds clean and open before the first scouts arrive (late winter in the south, early spring farther north).' });
        add(9, { tag: 'wildlife', ids: martins.map(f => f.id), title: 'Close up the martin gourds',
            text: 'After the martins leave, clean the gourds and close or take them down so sparrows and starlings don\'t claim them.' });
    }
    const feeders = ft(['feeder']);
    if (feeders.length) {
        for (const sm of [1, 4, 7, 10]) {
            add(sm, { tag: 'wildlife', ids: feeders.map(f => f.id), title: 'Scrub the feeders',
                text: 'Wash feeders in hot soapy water (or 1 part bleach to 9 water), rinse and dry. Every two weeks or so keeps disease from spreading; rake up spilled hulls.' });
        }
    }
    const water = ft(['dripper', 'birdseep', 'seep']);
    if (water.length) {
        add(7, { tag: 'water', ids: water.map(f => f.id), title: 'Keep water fresh',
            text: 'In hot weather, refill and scrub baths every few days so mosquitoes can\'t breed. Keep the mud seep wet: butterflies "puddle" on it for minerals.' });
        add(1, { tag: 'water', ids: water.map(f => f.id), title: 'Open water in winter',
            text: 'Birds need water most when everything is frozen. A heated birdbath or a daily refill helps.' });
    }
    const ponds = ft(['pond']);
    if (ponds.length) {
        add(10, { tag: 'tidy', ids: ponds.map(f => f.id), title: 'Net the pond', text: 'Stretch a net over the pond before leaves fall, or scoop them out weekly so they don\'t rot over winter.' });
        add(3, { tag: 'tidy', ids: ponds.map(f => f.id), title: 'Spring pond check', text: 'Clear dead leaves and stems, check the pump, and leave some pond plants standing for dragonfly nymphs to climb out on.' });
    }
    const piles = ft(['brushpile', 'hibernaculum']);
    if (piles.length && woody.length) {
        add(11, { tag: 'wildlife', ids: piles.map(f => f.id), title: 'Feed the brush pile',
            text: 'Add pruned branches and cut stems to the brush pile. Wrens, sparrows, rabbits and overwintering insects shelter in it.' });
    }

    return months;
}

/* Which northern season month a month is (for "spring bloomer" tests). */
function seasonOf(m, lat) { return lat < 0 ? ((m + 5) % 12) + 1 : m; }
function nextMonth(m) { return m === 12 ? 1 : m + 1; }

let cache = { key: '', months: null };

export function careCalendar() {
    const key = `${S.gardenId}|${S.rev}|${S.library.loaded}|${S.library.saved.size}`;
    if (cache.key !== key || !cache.months) cache = { key, months: buildJobs() };
    return cache.months;
}

export function jobsFor(month) {
    return careCalendar()[month - 1];
}

export const CARE_TAGS = { plant: 'Plant', prune: 'Prune', water: 'Water', wildlife: 'Wildlife', tidy: 'Tidy' };

