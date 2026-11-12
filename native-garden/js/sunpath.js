/*
 * sunpath.js
 * ---------------------------------------------------------------------------
 * Where the sun is in the sky, for any latitude, month and time of day.
 * It's in its own small file because both the 3D scene (to light the garden)
 * and the sun map (to count hours of sun) need it.
 *
 * "Sun time" puts the sun due south (due north, south of the equator) at
 * 12:00. Clock time is usually 30–90 minutes later, depending on where you
 * are in your time zone and on daylight saving time.
 *
 * Directions use the app's axes: x east, y up, z south.
 */
import { clamp } from './util.js';

const RAD = Math.PI / 180;
/* A typical day in the middle of each month (day of the year, 1–365). */
const MID_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];

/*
 * The sun's position for a month (1–12) and a sun-time hour (12 = noon).
 * Returns { x, y, z } (a unit-length arrow pointing toward the sun), plus
 * `elevation` (degrees above the horizon; negative = below it) and `azimuth`
 * (compass bearing in degrees: 90 east, 180 south, 270 west).
 *
 * This is the textbook formula; it's within a degree or so, which is plenty
 * for shadows in a garden.
 */
export function sunDirection(lat, month, hour) {
    const n = MID_DAY[month - 1];
    // Declination: how far north (+) or south (−) of the equator the sun is overhead today.
    const decl = 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365) * RAD;
    // Hour angle: the Earth turns 15° an hour; 0 at solar noon, negative in the morning.
    const H = (hour - 12) * 15 * RAD;
    const phi = lat * RAD;
    const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi) || 1e-6);
    let az = Math.acos(clamp(cosAz, -1, 1));        // 0..180°: the morning half of the sky
    if (H > 0) az = 2 * Math.PI - az;                // afternoon: mirror it to the west
    return {
        x: Math.sin(az) * Math.cos(el),
        y: Math.sin(el),
        z: -Math.cos(az) * Math.cos(el),
        elevation: el / RAD,
        azimuth: az / RAD,
    };
}

/* Sunrise and sunset in sun-time hours (e.g. [6.2, 17.8]); null if the sun never rises or never sets. */
export function dayLength(lat, month) {
    let rise = null, set = null;
    for (let h = 0; h <= 24; h += 0.1) {
        const up = sunDirection(lat, month, h).elevation > 0;
        if (up && rise === null) rise = h;
        if (up) set = h;
    }
    return rise === null || (rise <= 0.01 && set >= 23.9) ? null : [rise, set];
}

/* Show a sun-time hour as a clock time, e.g. 14.5 → "2:30 pm". */
export function fmtHour(hour) {
    const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
    const h12 = ((hh + 11) % 12) + 1;
    return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
}
