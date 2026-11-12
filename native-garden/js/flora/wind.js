/*
 * flora/wind.js
 * ---------------------------------------------------------------------------
 * Makes plants sway in the breeze, on the graphics card.
 *
 * three.js builds each material's shader (a small GPU program) from pieces
 * called "chunks". `onBeforeCompile` lets us swap one chunk for our own code
 * before it's compiled. We replace <project_vertex>, the chunk that moves each
 * vertex from the model into the camera's view, so that every vertex first
 * gets nudged sideways:
 *
 *     offset = strength × (height above ground)²  × a wobbling sine wave
 *
 * Bases stay put and tops move most, like real stems. The wave's phase depends
 * on the vertex's x/z position, so neighbouring plants don't move in lockstep.
 *
 * Shadows are drawn by a separate "depth" material; windDepth() returns a
 * matching one so shadows sway along with the plants.
 *
 * wind.uniforms.uTime is advanced by the draw loop in scene.js. Setting
 * uWind to 0 stops the motion (the Wind button does that).
 */
import * as THREE from 'three';

export const wind = {
    uniforms: {
        uTime: { value: 0 },
        uWind: { value: 1 },
    },
};

/* Our replacement for three.js's <project_vertex> chunk. STRENGTH is filled in per material. */
const SWAY = `
    vec4 mvPosition = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
    #endif
    vec4 windWorld = modelMatrix * mvPosition;
    float windH = clamp( windWorld.y, 0.0, 9.0 );
    float windAmount = uWind * STRENGTH * windH * windH * 0.011;
    float windPhase = uTime * 1.6 + windWorld.x * 0.31 + windWorld.z * 0.23;
    windWorld.x += windAmount * ( sin( windPhase ) + 0.4 * sin( windPhase * 2.7 + 1.3 ) );
    windWorld.z += windAmount * 0.55 * cos( windPhase * 0.83 + 0.6 );
    mvPosition = viewMatrix * windWorld;
    gl_Position = projectionMatrix * mvPosition;
`;

function patch(material, strength) {
    const s = strength.toFixed(2);
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = wind.uniforms.uTime;
        shader.uniforms.uWind = wind.uniforms.uWind;
        shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n'
            + shader.vertexShader.replace('#include <project_vertex>', SWAY.replace('STRENGTH', s));
    };
    // Materials with the same strength can share one compiled program.
    material.customProgramCacheKey = () => `wind-${s}`;
    return material;
}

/*
 * Add sway to a material. Rough strengths: 1 for wildflowers, 1.3 for grasses,
 * 0.5 for shrubs, 0.25 for trees (they're tall, so height does the rest).
 */
export function windify(material, strength = 1) {
    return patch(material, strength);
}

/*
 * Matching shadow materials, shared by every mesh with the same strength.
 * Leaf cards pass their texture so the see-through parts don't cast shadows.
 */
const depthCache = new Map();
export function windDepth(strength = 1, cardMap = null) {
    const key = `${strength.toFixed(2)}|${cardMap ? cardMap.uuid : ''}`;
    if (!depthCache.has(key)) {
        const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        if (cardMap) { m.map = cardMap; m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
        depthCache.set(key, patch(m, strength));
    }
    return depthCache.get(key);
}
