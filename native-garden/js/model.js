/*
 * model.js
 * ---------------------------------------------------------------------------
 * What a garden is made of, written down as code.
 *
 * A garden has:
 *   meta      – its name, outline (the shape of the ground), and location
 *   plants    – trees, shrubs, vines, wildflower patches, grasses...
 *   features  – ponds, feeders, nest boxes, fences, brush piles...
 *   zones     – beds: colored areas drawn on the ground
 *
 * Every item is a plain object like { id, kind, name, x, z, ... }.
 * Positions are in FEET: x runs west → east, z runs north → south
 * (so north is "up" on the plan view, the way maps usually look).
 *
 * The clean...() functions are the gatekeepers. Whenever data arrives from
 * the database, a file, or a form, it goes through one of them, which fills
 * in defaults and throws away anything malformed. That way the 3D code and
 * the UI can trust what they're given.
 */
import { num, str, col, url, rng2, clamp, slug } from './util.js';
import { FLOWERS, CROWNS } from './flora/shapes.js';

/* The three collections of things in a garden. */
export const KINDS = ['plants', 'features', 'zones'];

/*
 * Lookup tables: the key is what's stored in data, the value is what people see.
 * Add a new kind of feature by adding it to FTYPES and giving it a 3D model in
 * builders.js (buildFeature's switch statement). Unknown types fall back to a post.
 */
export const FORMS = {
    tree: 'Tree', shrub: 'Shrub', vine: 'Vine', forb: 'Wildflower patch', annual: 'Annual patch',
    iris: 'Iris ring', cactus: 'Cactus patch', grass: 'Grass patch',
};
export const FTYPES = {
    // wildlife and garden features
    pond: 'Pond', feeder: 'Bird feeder', nestbox: 'Nest box', planter: 'Planter', hibernaculum: 'Hibernaculum',
    seep: 'Mud seep', brushpile: 'Brush pile', snag: 'Snag / perch', dripper: 'Dripper / bath', birdseep: 'Bird seep',
    martin: 'Martin gourd rack', windmill: 'Windmill', boulder: 'Boulder', pot: 'Pot / container', bench: 'Bench',
    // structures (these cast shade on the sun map)
    house: 'House', garage: 'Garage', shed: 'Shed', greenhouse: 'Greenhouse', pergola: 'Pergola', gazebo: 'Gazebo',
    deck: 'Deck', fence: 'Fence', wall: 'Wall', hedge: 'Hedge',
    other: 'Other',
};

/*
 * Starting sizes (feet) for each feature type, used when a new one is added.
 *   w, d   width east–west and depth north–south (buildings, ponds, boulders)
 *   len    length (fences, walls, hedges, brush piles, benches)
 *   y      height (buildings, walls, hedges) or mounting height
 */
export const FEATURE_SIZES = {
    pond: { w: 8, d: 6 }, brushpile: { len: 7 }, fence: { len: 20 },
    house: { w: 40, d: 30, y: 12 }, garage: { w: 24, d: 22, y: 10 }, shed: { w: 10, d: 8, y: 8 },
    greenhouse: { w: 12, d: 8, y: 8 }, pergola: { w: 12, d: 12, y: 9 }, gazebo: { w: 12, d: 12, y: 10 },
    deck: { w: 16, d: 12, y: 1.5 }, wall: { len: 20, y: 4, w: 1 }, hedge: { len: 20, y: 6, w: 4 },
    boulder: { w: 3, d: 2.5, y: 2 }, pot: { w: 2, y: 2 }, bench: { len: 5 },
};

/* Beds can be one of these shapes, and show one of these surfaces. */
export const SHAPES = { rect: 'Rectangle', circle: 'Circle', poly: 'Freeform (drag its corners in Edit layout)' };
export const SURFACES = {
    mulch: 'Mulch', soil: 'Bare soil', gravel: 'Gravel', pavers: 'Brick pavers', flagstone: 'Flagstone',
    lawn: 'Lawn', tint: 'Just a colored area',
};
export const STATUS = {
    established: 'Established', new: 'Newly planted', inprogress: 'In progress', planned: 'Planned', removing: 'Being removed',
};
export const WATER = { dry: 'Dry ground once established', medium: 'Average moisture', moist: 'Moist or wet ground' };

/*
 * Light a plant wants. A plant lists every level it's happy in, e.g.
 * ['full', 'part']. Hours are of direct sun on a summer day, the usual rule:
 * full sun 6+ hours, part sun/shade 3–6, shade under 3.
 */
export const SUN = { full: 'Full sun', part: 'Part sun', shade: 'Shade' };
export const SUN_HOURS = { full: [6, 24], part: [3, 6], shade: [0, 3] };

/* Wildlife a plant supports (shown as chips; used by Garden Check). */
export const TAGS = { bees: 'Bees', butterflies: 'Butterflies', host: 'Caterpillar host', hummingbirds: 'Hummingbirds', birds: 'Birds' };

/*
 * US regions used for "native to this region" in the starter list. Each
 * starter-list plant lists the regions it's native to; the garden's state
 * decides which region it's in.
 */
export const REGIONS = {
    NE: 'the Northeast', SE: 'the Southeast', MW: 'the Midwest', GP: 'the Great Plains',
    SW: 'the Southwest', RM: 'the Rocky Mountains', PW: 'the Pacific Northwest', CA: 'California',
};
const STATE_REGION = {
    Maine: 'NE', 'New Hampshire': 'NE', Vermont: 'NE', Massachusetts: 'NE', 'Rhode Island': 'NE', Connecticut: 'NE',
    'New York': 'NE', 'New Jersey': 'NE', Pennsylvania: 'NE', Delaware: 'NE', Maryland: 'NE', 'District of Columbia': 'NE',
    Virginia: 'SE', 'West Virginia': 'SE', Kentucky: 'SE', Tennessee: 'SE', 'North Carolina': 'SE', 'South Carolina': 'SE',
    Georgia: 'SE', Florida: 'SE', Alabama: 'SE', Mississippi: 'SE', Arkansas: 'SE', Louisiana: 'SE',
    Ohio: 'MW', Michigan: 'MW', Indiana: 'MW', Illinois: 'MW', Wisconsin: 'MW', Minnesota: 'MW', Iowa: 'MW', Missouri: 'MW',
    'North Dakota': 'GP', 'South Dakota': 'GP', Nebraska: 'GP', Kansas: 'GP', Oklahoma: 'GP', Texas: 'GP',
    'New Mexico': 'SW', Arizona: 'SW', Nevada: 'SW',
    Montana: 'RM', Idaho: 'RM', Wyoming: 'RM', Colorado: 'RM', Utah: 'RM',
    Washington: 'PW', Oregon: 'PW', California: 'CA',
};
export function regionOf(place) {
    return place && place.country === 'United States' ? STATE_REGION[place.state] || '' : '';
}

/* USDA hardiness zones as stored ('7a') and as a number for comparisons ('7a' → 7, '7b' → 7.5). */
export const ZONES = [];
for (let z = 1; z <= 13; z++) ZONES.push(`${z}a`, `${z}b`);
export function zoneNum(z) {
    const m = /^(\d{1,2})([ab])$/.exec(z || '');
    return m ? Number(m[1]) + (m[2] === 'b' ? 0.5 : 0) : null;
}

/* Default height in feet for each growth form, used when none is given. */
export const DEF_H = { tree: 10, shrub: 3, vine: 6, forb: 2.5, annual: 2.5, iris: 2.5, cactus: 1.5, grass: 2 };

/* Colors used for seed heads and for dormant (winter) stems. */
export const SEED_BROWN = '#5b4630';
export const DORMANT = '#a8916a';

/* Ids become database document names, so keep them to safe characters (no "/"). */
export const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,100}$/;

/* ---------- nativity ---------- */
/*
 * "Is this plant native here?" is answered with one of these codes. The words
 * shown depend on where the garden is, so the labels are built from the
 * garden's place (see nativeLabel below).
 *   county   – native, and recorded in the garden's own county
 *   adjacent – native, recorded in a nearby county
 *   region   – native to the wider region; county not checked
 *   state    – native to the state or province; county not checked
 *   no       – introduced here (not native)
 *   unknown  – not checked yet, or the sources disagree
 */
export const NATIVE_CODES = ['county', 'adjacent', 'region', 'state', 'no', 'unknown'];

export function countyName(place) { return place?.county || ''; }

export function nativeLabel(code, place) {
    const county = countyName(place), state = place?.state || '';
    switch (code) {
        case 'county': return county ? `Native · recorded in ${county}` : 'Native · recorded in this county';
        case 'adjacent': return 'Native · recorded in a nearby county';
        case 'region': return regionOf(place) ? `Native to ${REGIONS[regionOf(place)]} · county not checked` : 'Native to the region · county not checked';
        case 'state': return state ? `Native to ${state} · county not checked` : 'Native to the state · county not checked';
        case 'no': return 'Not native here';
        default: return 'Nativity not checked';
    }
}

/* Short version for list rows. */
export function nativeShort(code, place) {
    switch (code) {
        case 'county': return place?.county ? place.county.replace(/ (County|Parish|Borough)$/, '') : 'County';
        case 'adjacent': return 'Nearby county';
        case 'region': return 'Region';
        case 'state': return place?.state ? `${place.state} native` : 'State native';
        case 'no': return 'Not native';
        default: return 'Not checked';
    }
}

/*
 * A short key for "where a nativity check was done", so a check done for one
 * garden isn't shown as if it applied to a garden somewhere else.
 */
export function placeKey(place) {
    if (!place) return '';
    return [place.country, place.state, place.county].map(s => (s || '').toLowerCase()).join('|');
}

/*
 * Starter-list nativity for wherever the current garden is.
 * The first 98 starter plants were researched for Roger Mills County, OK, and
 * their `native` codes are relative to it. The rest have code 'unknown' and a
 * list of US regions they're native to. So:
 *   - in Roger Mills County: the researched codes as they are
 *   - elsewhere in Oklahoma: anything researched as native counts as native to Oklahoma
 *   - otherwise, if the plant's regions include the garden's region: 'region'
 *   - otherwise: 'unknown' (use the iNaturalist and GBIF check to find out)
 * `e` is a library entry; older callers may pass just a code string.
 */
export function catalogNative(e, place) {
    const code = typeof e === 'string' ? e : e.native;
    const regions = typeof e === 'string' ? [] : e.regions || [];
    const state = (place?.state || '').toLowerCase();
    const county = (place?.county || '').toLowerCase();
    if (code !== 'unknown') {
        if (state === 'oklahoma' && county.startsWith('roger mills')) return code;
        if (state === 'oklahoma') return ['county', 'adjacent', 'region', 'state'].includes(code) ? 'state' : code;
    }
    const r = regionOf(place);
    return r && regions.includes(r) ? 'region' : 'unknown';
}

/* ---------- points and outlines ---------- */
/*
 * A point is { x, z } in feet. Older garden files stored points as [x, z]
 * pairs; we accept both. (Firestore, the cloud database, can't store a list
 * inside a list, which is why the new format uses { x, z } objects.)
 */
export function cleanPoint(p, lo = -2000, hi = 2000) {
    let x, z;
    if (Array.isArray(p) && p.length === 2) [x, z] = p;
    else if (p && typeof p === 'object') ({ x, z } = p);
    x = Number(x); z = Number(z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x: clamp(x, lo, hi), z: clamp(z, lo, hi) };
}

/* The garden outline: 3 to 64 corners, or null if unusable. */
export function cleanOutline(v) {
    if (!Array.isArray(v) || v.length < 3 || v.length > 64) return null;
    const out = v.map(p => cleanPoint(p));
    return out.every(Boolean) ? out : null;
}

/* A plain rectangle `w` feet wide (east–west) by `d` feet deep (north–south). */
export function rectOutline(w, d) {
    return [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
}

/* The bounding box of an outline. */
export function outlineBounds(outline) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const { x, z } of outline) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/* ---------- items ---------- */

/*
 * Several plants of the same kind can share one entry (e.g. three redbuds):
 * `members` lists each one's offset from the entry's position.
 */
function cleanMembers(v) {
    if (!Array.isArray(v)) return [];
    return v.slice(0, 30).map(p => cleanPoint(p, -120, 120)).filter(Boolean);
}

/*
 * A plant. The fields:
 *   name, tag, sci        common name, optional short tag ("#2"), scientific name
 *   form                  one of FORMS (decides which 3D model is drawn)
 *   status, native        one of STATUS / NATIVE_CODES
 *   x, z, y, rot          position in feet, height off the ground, turn in degrees
 *   h, w                  current height and width in feet
 *   r, rz                 patch radius (east–west, north–south) for wildflower/grass/cactus/iris
 *   len                   how many feet of fence a vine covers
 *   matureH, matureW      expected adult size (drawn as a blue shell with "Mature size")
 *   count, members        how many plants this entry stands for, and where each sits
 *   bloom, bloomColor(2)  flowering months and up to two flower colors
 *   leaf, foliage, fall   months in leaf (null = evergreen), leaf color, fall color
 *   fruit, fruitColor     fruit months and color; fruitShape 'berry' or 'pod'
 *   seed                  months with seed heads worth leaving for birds
 *   planted, source       free text: when and where it came from
 *   notes, wildlife       free text
 *   photo, photoCredit    a photo address (from iNaturalist) and its credit line
 *   inatId                the iNaturalist taxon number, for links and lookups
 *   flower                flower head shape for the 3D view (see flora/shapes.js; '' = automatic)
 *   flowerSize            size of one flower in inches (0 = the shape's usual size)
 *   crown                 tree/shrub silhouette (see flora/shapes.js; '' = automatic)
 *   sun                   light levels it's happy in, e.g. ['full', 'part'] (see SUN)
 *   water                 one of WATER, or ''
 *   zones                 USDA hardiness range [coldest, warmest], e.g. [4, 9]
 *   tags                  wildlife it supports (see TAGS)
 */
export function cleanPlant(id, r) {
    const form = FORMS[r.form] ? r.form : 'shrub';
    return {
        id, kind: 'plants',
        name: str(r.name, 'Unnamed plant', 80) || 'Unnamed plant',
        tag: str(r.tag, '', 12),
        sci: str(r.sci, '', 100),
        form,
        status: STATUS[r.status] ? r.status : 'established',
        native: NATIVE_CODES.includes(r.native) ? r.native : 'unknown',
        x: num(r.x, 0, -2000, 2000), z: num(r.z, 0, -2000, 2000), y: num(r.y, 0, 0, 30), rot: num(r.rot, 0, -360, 360),
        h: num(r.h, DEF_H[form], 0.2, 150), w: num(r.w, 0, 0, 150),
        r: num(r.r, 2, 0.3, 60), rz: num(r.rz, 0, 0, 60), len: num(r.len, 8, 1, 120),
        matureH: num(r.matureH, 0, 0, 200), matureW: num(r.matureW, 0, 0, 200),
        count: Math.round(num(r.count, 1, 1, 999)), members: cleanMembers(r.members),
        bloom: rng2(r.bloom), bloomColor: col(r.bloomColor, '#e8d44d'), bloomColor2: col(r.bloomColor2, ''),
        leaf: rng2(r.leaf), foliage: col(r.foliage, '#5a7a3c'), fall: col(r.fall, ''),
        fruit: rng2(r.fruit), fruitColor: col(r.fruitColor, '#7a2a2a'), fruitShape: r.fruitShape === 'pod' ? 'pod' : 'berry',
        seed: rng2(r.seed),
        planted: str(r.planted, '', 40), source: str(r.source, '', 120),
        notes: str(r.notes, '', 2000), wildlife: str(r.wildlife, '', 1000),
        photo: url(r.photo), photoCredit: str(r.photoCredit, '', 200),
        inatId: Math.round(num(r.inatId, 0, 0, 1e9)),
        flower: FLOWERS[r.flower] ? r.flower : '',
        flowerSize: num(r.flowerSize, 0, 0, 36),
        crown: CROWNS[r.crown] ? r.crown : '',
        ...traits(r),
    };
}

/* Growing needs and wildlife, shared by plants and library entries. */
function cleanList(v, table) {
    return Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && table[x]))] : [];
}
function cleanZones(v) {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const a = Number(v[0]), b = Number(v[1]);
    return Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b <= 13 && a <= b ? [a, b] : null;
}
function traits(r) {
    return {
        sun: cleanList(r.sun, SUN),
        water: WATER[r.water] ? r.water : '',
        zones: cleanZones(r.zones),
        tags: cleanList(r.tags, TAGS),
    };
}

/*
 * A feature (anything that isn't a plant or a bed).
 *   type        one of FTYPES; sub is a variant (nest boxes: 'bluebird', 'owl'...)
 *   y           mount height (nest boxes, tree-hung feeders) or tower height (windmill)
 *   len         length of a fence or brush pile; w/d pond width and length
 *   stream      length of a stream running out of a pond (rot gives its direction)
 *   onTree      true if it hangs from a tree instead of standing on a pole
 */
export function cleanFeature(id, r) {
    const type = FTYPES[r.type] ? r.type : 'other';
    const D = FEATURE_SIZES[type] || {};
    return {
        id, kind: 'features',
        type, sub: str(r.sub, '', 20),
        name: str(r.name, 'Unnamed feature', 80) || 'Unnamed feature',
        status: STATUS[r.status] ? r.status : 'established',
        x: num(r.x, 0, -2000, 2000), z: num(r.z, 0, -2000, 2000), y: num(r.y, D.y ?? 0, 0, 60),
        rot: num(r.rot, 0, -360, 360), len: num(r.len, D.len ?? 20, 1, 1000), w: num(r.w, D.w ?? 3, 0.5, 300),
        d: num(r.d, D.d ?? 0, 0, 300), stream: num(r.stream, 0, 0, 400),
        onTree: r.onTree === true,
        notes: str(r.notes, '', 2000),
    };
}

/*
 * A bed, path or surface: a rectangle (w × d), a circle (radius r) or a
 * freeform shape (points, relative to x/z), with a color and a surface.
 *   raised   height in feet of a raised bed's sides (0 = flush with the ground)
 */
export function cleanZone(id, r) {
    const shape = SHAPES[r.shape] ? r.shape : 'rect';
    const w = num(r.w, 10, 1, 1000), d = num(r.d, 10, 1, 1000);
    let points = [];
    if (shape === 'poly') {
        points = Array.isArray(r.points) && r.points.length >= 3 ? r.points.slice(0, 64).map(p => cleanPoint(p, -500, 500)).filter(Boolean) : [];
        if (points.length < 3) points = [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
    }
    return {
        id, kind: 'zones',
        name: str(r.name, 'Bed', 80) || 'Bed',
        shape, points,
        x: num(r.x, 0, -2000, 2000), z: num(r.z, 0, -2000, 2000),
        w, d, r: num(r.r, 5, 0.5, 500),
        surface: SURFACES[r.surface] ? r.surface : 'mulch',
        raised: num(r.raised, 0, 0, 6),
        color: col(r.color, '#7d8a36'), notes: str(r.notes, '', 2000),
    };
}

/* Is the point (x, z) inside bed `zn`? */
export function inZone(zn, x, z) {
    const dx = x - zn.x, dz = z - zn.z;
    if (zn.shape === 'circle') return dx * dx + dz * dz <= zn.r * zn.r;
    if (zn.shape === 'rect') return Math.abs(dx) <= zn.w / 2 && Math.abs(dz) <= zn.d / 2;
    let inside = false;
    const p = zn.points;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i].z > dz) !== (p[j].z > dz) && dx < ((p[j].x - p[i].x) * (dz - p[i].z)) / (p[j].z - p[i].z) + p[i].x) inside = !inside;
    }
    return inside;
}

/* CLEAN.plants(id, raw) etc. — pick the right cleaner by kind. */
export const CLEAN = { plants: cleanPlant, features: cleanFeature, zones: cleanZone };

/*
 * toDoc() turns a cleaned item into what we store: no id/kind (those live in
 * the document's name), and no empty or default-ish fields, to keep things small.
 * JSON round-tripping also removes `undefined`, which Firestore refuses.
 */
export function toDoc(it) {
    const out = {};
    for (const [k, v] of Object.entries(it)) {
        if (k === 'id' || k === 'kind') continue;
        if (v === '' || v === null || v === undefined || v === false) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
    }
    return JSON.parse(JSON.stringify(out));
}

/* ---------- the garden itself ---------- */

/*
 * Where a garden is. Filled in when the garden is created (see ui/gardens.js):
 *   lat, lng           decimal degrees (sets the sun angle and the "near me" searches)
 *   label              readable name, e.g. "Roger Mills County, Oklahoma, United States"
 *   country/state/county  names from GBIF's map of administrative areas (GADM)
 *   gadm.{country,state,county}  GADM ids, used to count GBIF records in the area
 *   inat.{state,county}          iNaturalist place ids, used for native/introduced status
 */
export function cleanPlace(r) {
    if (!r || typeof r !== 'object') return null;
    const lat = num(r.lat, NaN, -90, 90), lng = num(r.lng, NaN, -180, 180);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const g = r.gadm || {}, i = r.inat || {};
    return {
        lat, lng,
        label: str(r.label, '', 160),
        country: str(r.country, '', 80), state: str(r.state, '', 80), county: str(r.county, '', 80),
        gadm: { country: str(g.country, '', 40), state: str(g.state, '', 40), county: str(g.county, '', 40) },
        inat: { state: Math.round(num(i.state, 0, 0, 1e9)), county: Math.round(num(i.county, 0, 0, 1e9)) },
    };
}

/*
 * A garden's settings ("meta").
 *   name                  shown at the top of the screen
 *   outline               corners of the ground, in feet
 *   place                 see cleanPlace (null if no location was given)
 *   zone                  USDA hardiness zone like '7a' ('' if not set)
 *   layoutPlaceholder     true shows a "positions are rough" reminder
 *   notice                custom text for that reminder
 *   created, updated      ISO date strings
 */
export function cleanMeta(r) {
    r = r || {};
    return {
        name: str(r.name, '', 80).trim() || 'My garden',
        outline: cleanOutline(r.outline) || rectOutline(num(r.width, 60, 10, 1000), num(r.depth, 40, 10, 1000)),
        place: cleanPlace(r.place),
        zone: ZONES.includes(r.zone) ? r.zone : '',
        layoutPlaceholder: r.layoutPlaceholder === true,
        notice: str(r.notice, '', 400),
        shared: r.shared === true,
        owner: str(r.owner, '', 60),
        created: str(r.created, '', 40),
        updated: str(r.updated, '', 40),
    };
}

/* What gets saved for a garden's settings (same idea as toDoc). */
export function metaDoc(m) {
    return JSON.parse(JSON.stringify({
        name: m.name, outline: m.outline, place: m.place || null, zone: m.zone || '',
        layoutPlaceholder: m.layoutPlaceholder, notice: m.notice || '',
        shared: m.shared === true, owner: m.owner || '',
        created: m.created || new Date().toISOString(), updated: new Date().toISOString(),
    }));
}

/* ---------- plant library entries ---------- */
/*
 * A plant you can browse and add: from the starter list (source 'catalog'),
 * from iNaturalist ('inat'), or saved to your own library ('saved').
 *   h, w        mature height and width in feet
 *   water, sun, zones, tags   growing needs and wildlife (as on plants)
 *   regions     US regions it's native to (starter list only)
 *   native, nativeNote   nativity code and a sentence explaining it
 *   nativeFor   placeKey() of the garden the nativity was checked for
 *   inatId, photo, photoCredit, family   from iNaturalist when known
 */
export function cleanLib(raw, source) {
    const form = FORMS[raw.form] ? raw.form : 'forb';
    return {
        id: slug(str(raw.id, '') || str(raw.sci, '') || str(raw.name, 'plant')),
        name: str(raw.name, '', 80) || str(raw.sci, '', 80) || 'Unnamed plant',
        sci: str(raw.sci, '', 100), form,
        h: num(raw.h, DEF_H[form], 0.1, 200), w: num(raw.w, 1, 0.1, 200),
        bloom: rng2(raw.bloom), bloomColor: col(raw.bloomColor, '#e8d44d'), bloomColor2: col(raw.bloomColor2, ''),
        fruit: rng2(raw.fruit), fruitColor: col(raw.fruitColor, '#7a2a2a'), seed: rng2(raw.seed),
        leaf: rng2(raw.leaf), fall: col(raw.fall, ''), foliage: col(raw.foliage, '#5f7d42'),
        ...traits(raw),
        regions: Array.isArray(raw.regions) ? raw.regions.filter(x => REGIONS[x]) : [],
        native: NATIVE_CODES.includes(raw.native) ? raw.native : 'unknown',
        nativeNote: str(raw.nativeNote, '', 500), nativeFor: str(raw.nativeFor, '', 200),
        wildlife: str(raw.wildlife, '', 800), cautions: str(raw.cautions, '', 600),
        family: str(raw.family, '', 60),
        inatId: Math.round(num(raw.inatId, 0, 0, 1e9)),
        photo: url(raw.photo), photoCredit: str(raw.photoCredit, '', 200),
        flower: FLOWERS[raw.flower] ? raw.flower : '',
        crown: CROWNS[raw.crown] ? raw.crown : '',
        note: str(raw.note, '', 500),
        source,
    };
}

/* ---------- garden files (download / import) ---------- */

/*
 * The download format. "native-garden/2" uses { x, z } points;
 * "native-garden/1" (the first single-file app) used [x, z] pairs.
 */
export function exportGarden(meta, items, library) {
    const out = { format: 'native-garden/2', exported: new Date().toISOString(), meta: metaDoc(meta) };
    for (const kind of KINDS) out[kind] = [...items[kind].values()].map(it => ({ id: it.id, ...toDoc(it) }));
    out.library = [...library.values()].map(e => ({ id: e.id, ...toDoc(e) }));
    return out;
}

/*
 * Read a downloaded garden file (either format). Returns
 *   { meta, items: [{ kind, id, data }], library: [entry], counts }
 * or throws an Error with a readable message.
 */
export function parseGardenFile(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error("That file isn't a garden file.");
    const items = [];
    const counts = { plants: 0, features: 0, zones: 0 };
    const used = new Set();   // all kinds share one id space in storage, so keep ids unique
    for (const kind of KINDS) {
        for (const raw of Array.isArray(obj[kind]) ? obj[kind] : []) {
            if (!raw || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) continue;
            const id = used.has(raw.id) ? `${raw.id}-${kind}` : raw.id;
            used.add(id);
            items.push({ kind, id, data: toDoc(CLEAN[kind](id, raw)) });
            counts[kind]++;
        }
    }
    const library = [];
    for (const raw of Array.isArray(obj.library) ? obj.library : []) {
        if (!raw || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) continue;
        // Old files marked looked-up entries as source 'claude'; here they're just saved entries.
        const e = cleanLib(raw, 'saved');
        e.id = raw.id;
        library.push(e);
    }
    if (!items.length && !library.length) throw new Error('No plants, features or beds found in that file.');
    const m = obj.meta && typeof obj.meta === 'object' ? obj.meta : {};
    const meta = {
        name: str(m.name, '', 80),
        outline: cleanOutline(m.outline),
        layoutPlaceholder: m.layoutPlaceholder === true,
        notice: str(m.notice, '', 400),
    };
    return { meta, items, library, counts };
}
