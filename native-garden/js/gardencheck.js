/*
 * gardencheck.js
 * ---------------------------------------------------------------------------
 * Garden Check: looks over the whole garden and lists things worth a second
 * look, plus how well it feeds wildlife through the year.
 *
 *   gardenCheck()     the full report (cached until something changes)
 *   issuesFor(id)     just the issues that involve one plant (for its detail panel)
 *
 * What it checks:
 *   Spacing      trees and shrubs whose mature widths will crowd each other,
 *                or trees planted too close to a building
 *   Light        hours of summer sun where each plant stands (from sun.js)
 *                compared with the light the plant likes
 *   Hardiness    the garden's USDA zone compared with the plant's zone range
 *   Water        beds that mix dry-ground and wet-ground plants
 *   Nativity     plants marked as not native here
 *   Wildlife     months with nothing in bloom, no winter food for birds, and
 *                missing kinds of wildlife support (bees, caterpillar hosts…)
 *
 * The report is plain data; ui/gardencheck.js draws it. Everything here is
 * general guidance worked out from the sizes, positions and plant details
 * entered, so it's only as good as those are.
 *
 * Each issue looks like:
 *   { sev: 'bad' | 'warn' | 'info', type: 'spacing' | 'light' | …,
 *     ids: [plant or feature ids involved], title, text, action? }
 * where action is { label, run: 'sunmap' | 'settings' | 'library', … }.
 */
import { S } from './state.js';
import { inRange, MONTHS } from './util.js';
import { TAGS, SUN, zoneNum, inZone } from './model.js';
import { traitsOf } from './library/match.js';
import { plantSunHours, sunLevel, summerMonth } from './sun.js';
import { speciesKey, bloomCounts, isThin } from './ui/common.js';

const WOODY = ['tree', 'shrub'];
const BUILDINGS = ['house', 'garage', 'shed', 'greenhouse'];
const SEV_ORDER = { bad: 0, warn: 1, info: 2 };
const NATIVE_HERE = ['county', 'adjacent', 'region', 'state'];

/* How wide a tree or shrub will get, in feet (its mature width if set). */
function matureWidth(p) {
    return Math.max(p.matureW || 0, p.w || p.h * 0.7);
}

/* Where each plant of an entry stands (a group lists its members). */
function spots(p) {
    return p.members && p.members.length ? p.members.slice(0, 30).map(m => ({ x: p.x + m.x, z: p.z + m.z })) : [{ x: p.x, z: p.z }];
}

/* The closest two plants of two entries, as a distance in feet. */
function closest(a, b) {
    let best = Infinity;
    for (const p of spots(a)) for (const q of spots(b)) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
    return best;
}

/* Distance from a point to a feature's (turned) rectangle; 0 if it's inside. */
function distToBox(f, x, z) {
    const rot = (f.rot || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
    const rx = x - f.x, rz = z - f.z;
    const lx = rx * cos - rz * sin, lz = rx * sin + rz * cos;            // into the building's own frame
    const hx = f.w / 2, hz = (f.d || f.w * 0.75) / 2;
    const dx = Math.max(0, Math.abs(lx) - hx), dz = Math.max(0, Math.abs(lz) - hz);
    return Math.hypot(dx, dz);
}

const ft = (n) => `${Math.round(n)} ft`;
const list = (names) => names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/* ---------- the individual checks ---------- */

function checkSpacing(plants, out) {
    const woody = plants.filter(p => WOODY.includes(p.form));
    for (let i = 0; i < woody.length; i++) {
        for (let j = i + 1; j < woody.length; j++) {
            const a = woody[i], b = woody[j];
            const need = (matureWidth(a) + matureWidth(b)) / 2;    // centers this far apart: canopies just touch
            const d = closest(a, b);
            const trees = a.form === 'tree' && b.form === 'tree';
            const anyTree = a.form === 'tree' || b.form === 'tree';
            // Some overlap is normal (natives grow in thickets); flag real crowding.
            let sev = null;
            if (d < need * (trees ? 0.45 : 0.35)) sev = anyTree ? 'bad' : 'warn';
            else if (anyTree && d < need * 0.65) sev = 'warn';
            if (!sev) continue;
            out.push({
                sev, type: 'spacing', ids: [a.id, b.id],
                title: sev === 'bad' ? 'Will grow into each other' : 'Will crowd each other',
                text: `${a.name} and ${b.name} are ${ft(d)} apart. Full grown (about ${ft(matureWidth(a))} and ${ft(matureWidth(b))} wide) they need roughly ${ft(need)} between trunks${anyTree ? ', or the smaller one ends up in deep shade' : ''}.`,
            });
        }
    }
    // Trees and big shrubs right up against a house, garage, shed or greenhouse.
    const buildings = [...S.items.features.values()].filter(f => BUILDINGS.includes(f.type));
    for (const p of woody) {
        const tall = Math.max(p.matureH || 0, p.h);
        if (tall < 8) continue;
        const r = matureWidth(p) / 2;
        for (const f of buildings) {
            const d = Math.min(...spots(p).map(s => distToBox(f, s.x, s.z)));
            if (d === 0) {
                out.push({ sev: 'bad', type: 'spacing', ids: [p.id, f.id], title: `Inside the ${f.name.toLowerCase()}`, text: `${p.name} sits inside ${f.name}'s outline. Drag one of them in Edit layout.` });
            } else if (d < r * 0.6) {
                out.push({
                    sev: p.form === 'tree' ? 'warn' : 'info', type: 'spacing', ids: [p.id, f.id],
                    title: `Close to the ${f.name.toLowerCase()}`,
                    text: `${p.name} is ${ft(d)} from ${f.name} and will spread about ${ft(r)} each way. Planting at least ${ft(r * 0.6)} away keeps branches off the roof and roots off the foundation.`,
                });
            }
        }
    }
}

function checkLight(plants, out, stats, sunById) {
    const month = summerMonth();
    for (const p of plants) {
        const want = traitsOf(p).sun;
        if (!want.length) { stats.noLight++; continue; }
        const hours = plantSunHours(p, month);
        const got = sunLevel(hours);
        sunById.set(p.id, { hours, got });      // kept for the detail panel (see issuesFor)
        if (want.includes(got)) { stats.lightOk++; continue; }
        const wantText = want.map(k => SUN[k].toLowerCase()).join(' or ');
        let sev = 'warn', title = 'Less sun than it likes';
        if (got === 'shade' && !want.includes('part')) { sev = 'bad'; title = 'Too shady'; }
        else if (got === 'full' && want.length === 1 && want[0] === 'shade') { sev = 'bad'; title = 'Too sunny'; }
        else if (got === 'full') title = 'More sun than it likes';
        out.push({
            sev, type: 'light', ids: [p.id], title,
            text: `${p.name} gets about ${hours.toFixed(1)} hours of direct sun on a ${MONTHS[month - 1]} day (${SUN[got].toLowerCase()}); it likes ${wantText}.`,
            action: { label: `Show the sun map for ${MONTHS[month - 1]}`, run: 'sunmap', month },
        });
    }
}

function checkHardiness(plants, out) {
    const gz = zoneNum(S.meta?.zone);
    if (gz === null) {
        if (plants.some(p => traitsOf(p).zones)) {
            out.push({ sev: 'info', type: 'zone', ids: [], title: 'No hardiness zone set', text: "Add your USDA hardiness zone in the garden's settings, and Garden Check will flag plants that can't take your winters.", action: { label: 'Open settings', run: 'settings' } });
        }
        return;
    }
    const z = Math.floor(gz);
    for (const p of plants) {
        const zones = traitsOf(p).zones;
        if (!zones) continue;
        if (z < zones[0]) {
            out.push({ sev: 'bad', type: 'zone', ids: [p.id], title: 'Winters may be too cold', text: `${p.name} is usually hardy to zone ${zones[0]}; this garden is zone ${S.meta.zone}.` });
        } else if (z > zones[1]) {
            out.push({ sev: 'warn', type: 'zone', ids: [p.id], title: 'May struggle in the heat', text: `${p.name} usually grows in zones ${zones[0]}–${zones[1]}; this garden is zone ${S.meta.zone}. It may need afternoon shade and extra water.` });
        }
    }
}

function checkWater(plants, out) {
    for (const zn of S.items.zones.values()) {
        if (zn.surface === 'lawn' || zn.surface === 'pavers' || zn.surface === 'flagstone') continue;
        const inside = plants.filter(p => inZone(zn, p.x, p.z));
        const dry = inside.filter(p => traitsOf(p).water === 'dry');
        const wet = inside.filter(p => traitsOf(p).water === 'moist');
        if (!dry.length || !wet.length) continue;
        out.push({
            sev: 'info', type: 'water', ids: [zn.id, ...dry.map(p => p.id), ...wet.map(p => p.id)],
            title: `Mixed water needs in ${zn.name}`,
            text: `${list(dry.slice(0, 3).map(p => p.name))} like dry ground, but ${list(wet.slice(0, 3).map(p => p.name))} like it moist. Watering for one will be hard on the other.`,
        });
    }
}

function checkNative(plants, out) {
    const not = plants.filter(p => p.native === 'no');
    for (const p of not) {
        out.push({ sev: 'info', type: 'native', ids: [p.id], title: 'Not native here', text: `${p.name} is marked as not native to this area. Local wildlife may use it less than a native relative.` });
    }
}

/* ---------- wildlife and seasons ---------- */

function wildlifeReport(plants, includePlanned, out, good) {
    const { bloom, fruit } = bloomCounts(includePlanned);
    const lat = S.meta?.place?.lat ?? 35;
    const season = (m) => lat < 0 ? ((m + 5) % 12) + 1 : m;     // the northern-hemisphere month with the same season

    // Months in the growing season with little or nothing blooming.
    const gaps = [];
    for (let m = 1; m <= 12; m++) if (isThin(m, bloom[m - 1])) gaps.push(m);
    if (plants.length && gaps.length) {
        out.push({
            sev: gaps.length >= 3 ? 'warn' : 'info', type: 'bloom', ids: [],
            title: gaps.length === 1 ? `Thin month: ${MONTHS[gaps[0] - 1]}` : `${gaps.length} thin months`,
            text: `Two or fewer species bloom in ${list(gaps.map(m => MONTHS[m - 1]))}. Bees and butterflies need flowers all season; early spring and fall are the months they most often go hungry.`,
            action: { label: `Find natives that bloom in ${MONTHS[gaps[0] - 1]}`, run: 'library', month: gaps[0] },
        });
    }
    const bloomMonths = bloom.filter(n => n > 0).length;
    if (bloomMonths >= 7) good.push(`Something blooms in ${bloomMonths} months of the year.`);

    // Fruit or seed left standing for birds in winter.
    const winter = [12, 1, 2].map(m => (lat < 0 ? ((m + 5) % 12) + 1 : m));
    const winterFood = winter.some(m => fruit[m - 1] > 0);
    if (plants.length && !winterFood) {
        out.push({
            sev: 'info', type: 'birds', ids: [], title: 'No winter food for birds',
            text: 'Nothing holds fruit or seed heads through winter. Leaving seed heads standing (coneflowers, grasses) or adding a berry-holding shrub feeds birds when food is scarce.',
            action: { label: 'Find plants for birds', run: 'library', tag: 'birds' },
        });
    } else if (winterFood) good.push('Fruit or seed heads are there for birds in winter.');

    // Pollinators: months with flowers, but none of them listed for bees, butterflies or hummingbirds.
    const species = new Map();
    for (const p of plants) if (!species.has(speciesKey(p))) species.set(speciesKey(p), p);
    const pollinatorMonths = [];
    for (let m = 1; m <= 12; m++) {
        const sm = season(m);
        if (sm < 3 || sm > 10) continue;
        const open = [...species.values()].filter(p => inRange(m, p.bloom));
        if (!open.length) continue;
        const known = open.filter(p => traitsOf(p).tags.length);
        if (known.length === open.length && !known.some(p => traitsOf(p).tags.some(t => t === 'bees' || t === 'butterflies' || t === 'hummingbirds'))) pollinatorMonths.push(m);
    }
    if (pollinatorMonths.length) {
        out.push({
            sev: 'info', type: 'pollinators', ids: [], title: 'Flowers, but not for pollinators',
            text: `What blooms in ${list(pollinatorMonths.map(m => MONTHS[m - 1]))} isn't known for feeding bees or butterflies.`,
            action: { label: 'Find plants for bees', run: 'library', tag: 'bees' },
        });
    }

    // Which kinds of wildlife the plants support (each species counted once).
    const tagCount = Object.fromEntries(Object.keys(TAGS).map(k => [k, 0]));
    for (const p of species.values()) for (const t of traitsOf(p).tags) if (t in tagCount) tagCount[t]++;
    const known = [...species.values()].some(p => traitsOf(p).tags.length);
    if (known) {
        if (!tagCount.host) {
            out.push({
                sev: 'warn', type: 'host', ids: [], title: 'No caterpillar host plants',
                text: "Butterflies and moths can only lay eggs on certain plants (milkweeds for monarchs, for example). Without hosts, you'll see visitors but not the next generation, and fewer caterpillars means less food for nesting birds.",
                action: { label: 'Find host plants', run: 'library', tag: 'host' },
            });
        } else good.push(`${tagCount.host} caterpillar host species for butterflies and moths.`);
        if (!tagCount.bees) {
            out.push({ sev: 'warn', type: 'bees', ids: [], title: 'Nothing listed for bees', text: 'None of the plants are known bee plants. Most native wildflowers are; adding a few makes a big difference.', action: { label: 'Find plants for bees', run: 'library', tag: 'bees' } });
        }
    }

    // Water and shelter features.
    const types = new Set([...S.items.features.values()].map(f => f.type));
    const water = ['pond', 'seep', 'dripper', 'birdseep'].some(t => types.has(t));
    const shelter = ['brushpile', 'snag', 'hibernaculum', 'nestbox', 'martin', 'hedge'].some(t => types.has(t));
    if (plants.length) {
        if (water) good.push('A water source for birds and insects.');
        else out.push({ sev: 'info', type: 'water-source', ids: [], title: 'No water source', text: 'A shallow birdbath, dripper or mud seep brings in birds, bees and butterflies, especially in dry spells. Add one with Add → Feature.' });
        if (shelter) good.push('Shelter: a brush pile, snag, nest box or hedge.');
    }

    // Natives.
    const natives = [...species.values()].filter(p => NATIVE_HERE.includes(p.native)).length;
    if (natives) good.push(`${natives} of ${species.size} species are native here.`);

    return { bloom, fruit, gaps, tagCount, tagsKnown: known, species: species.size };
}

/* ---------- putting it together ---------- */

let cache = { key: '', report: null };

/*
 * The full report. Recomputed only when the garden, the Growth year, the
 * library or the "include planned" setting has changed, and not while
 * something is being dragged (the old report stays until the drag ends).
 */
export function gardenCheck() {
    const key = `${S.gardenId}|${S.rev}|${S.years}|${S.checkPlanned}|${S.library.loaded}|${S.library.saved.size}`;
    if (cache.report && (cache.key === key || S.dragKey)) return cache.report;
    const includePlanned = S.checkPlanned;
    const plants = [...S.items.plants.values()].filter(p => includePlanned || p.status !== 'planned');
    const issues = [], good = [];
    const stats = { noLight: 0, lightOk: 0 };
    const sun = new Map();
    checkSpacing(plants, issues);
    checkLight(plants, issues, stats, sun);
    checkHardiness(plants, issues);
    checkWater(plants, issues);
    checkNative(plants, issues);
    const wildlife = wildlifeReport(plants, includePlanned, issues, good);
    if (stats.lightOk && !issues.some(i => i.type === 'light')) good.unshift(`All ${stats.lightOk} plants with light needs listed are in the right light.`);
    issues.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
    cache = { key, report: { issues, good, wildlife, stats, sun, month: summerMonth(), plants: plants.length } };
    return cache.report;
}

/* Issues that involve one item, plus its summer sun (for the detail panel). */
export function issuesFor(id) {
    const r = gardenCheck();
    return { issues: r.issues.filter(i => i.ids.includes(id)), sun: r.sun.get(id) || null, month: r.month };
}
