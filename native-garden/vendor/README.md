# vendor/

Third-party code, copied here so the app doesn't depend on a CDN.

- `three.module.min.js`: three.js r170 (https://threejs.org), MIT license
- `addons/controls/OrbitControls.js`, `addons/renderers/CSS2DRenderer.js`, `addons/objects/Sky.js` and `addons/utils/BufferGeometryUtils.js`: from the same three.js release (examples/jsm/)

To upgrade three.js, download the matching files from https://github.com/mrdoob/three.js (`build/three.module.min.js` and `examples/jsm/...`) and replace these. Check the release notes for breaking changes first.
