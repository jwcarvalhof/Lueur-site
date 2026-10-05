// Lueur 3D bottles: real glass, metal and frosted caps rendered in the browser.
// One shared WebGL renderer draws every view and copies the pixels into that view's own canvas,
// so each bottle lives in the page like an element (clipped, layered, transitioned) without
// opening one GPU context per bottle.
import * as THREE from './vendor/three.module.min.js';
import { RGBELoader } from './vendor/RGBELoader.js';

export const supported = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();

// a photo studio for reflections: warm grey room, a large overhead softbox and two tall strip lights,
// which is what gives real perfume glass its bright vertical edges and dark refractions
function studio() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: 0x3b3430, side: THREE.BackSide })); room.position.y = 4; s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0xd9cfc6 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -2.9; s.add(floor);
  const panel = (w, h, x, y, z, ry, rx, k) => { const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); m.color.setScalar(k);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.set(rx || 0, ry || 0, 0); s.add(p); };
  panel(9, 6, 0, 10.9, 0, 0, Math.PI / 2, 2.6);            // overhead softbox
  panel(1.6, 9, -9, 3, 3, Math.PI / 2.6, 0, 5.5);          // left strip
  panel(1.6, 9, 9, 3, 2, -Math.PI / 2.6, 0, 4.2);          // right strip
  panel(10, 4, 0, 3, -11.9, 0, 0, 1.4);                    // back sweep, warm paper
  const flag = (x, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(5, 12), new THREE.MeshBasicMaterial({ color: 0x14100e, side: THREE.DoubleSide })); p.position.set(x, 3, z); p.rotation.y = ry; s.add(p); };
  flag(-6.5, -2.5, Math.PI / 2.2); flag(6.5, -2.5, -Math.PI / 2.2); flag(-4.5, 6.5, Math.PI / 4); flag(4.5, 6.5, -Math.PI / 4); // black flags carve the glass edges
  panel(6, 3, 0, 2, 11.9, Math.PI, 0, .25);                // a weak fill behind the camera
  return s;
}
/* ---------- materials ---------- */
// thick glass looks dark at its edges because light travels through more of it there.
// The renderer uses a constant thickness, so the edge absorption is added by hand.
function edge(mat, tint, k) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uEdge = { value: new THREE.Color(tint) }; sh.uniforms.uEdgeK = { value: k };
    sh.fragmentShader = 'uniform vec3 uEdge; uniform float uEdgeK;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      'float ndvE = abs(dot(normalize(normal), normalize(vViewPosition)));\n' +
      'float rimE = smoothstep(.0, .9, pow(1.0 - ndvE, 1.6));\n' +
      'outgoingLight *= mix(vec3(1.0), uEdge, rimE * uEdgeK);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'edge' + tint + k;
  return mat;
}
const M = {};
function mats() {
  if (M.glass) return M;
  // heavy flint glass: clear, a little fire at the edges
  M.glass = edge(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, thickness: 1.6, ior: 1.5,
    attenuationColor: new THREE.Color(0xeef2ee), attenuationDistance: 4, specularIntensity: 1, envMapIntensity: .95, dispersion: .28
  }), 0x26302c, .72);
  M.crystal = edge(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0, transmission: 1, thickness: .9, ior: 1.56,
    attenuationColor: new THREE.Color(0xf6efe6), attenuationDistance: 3, specularIntensity: 1, envMapIntensity: 1.1, dispersion: .45
  }), 0x30302a, .6);
  M.gold = new THREE.MeshPhysicalMaterial({ color: 0xe3c28e, metalness: 1, roughness: .13, envMapIntensity: 1.25, clearcoat: .4, clearcoatRoughness: .08 });
  M.goldSatin = new THREE.MeshStandardMaterial({ color: 0xcfae7c, metalness: 1, roughness: .34, envMapIntensity: 1.1 });
  M.lacquer = new THREE.MeshPhysicalMaterial({ color: 0x15110f, metalness: 0, roughness: .22, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.2 });
  M.gunmetal = new THREE.MeshPhysicalMaterial({ color: 0xb7b0a7, metalness: 1, roughness: .14, envMapIntensity: 1.4, clearcoat: .5, flatShading: true });
  M.hole = new THREE.MeshBasicMaterial({ color: 0x1e1814 });
  M.tube = new THREE.MeshPhysicalMaterial({ color: 0xd9d2cb, roughness: .15, clearcoat: 1 });
  return M;
}
// the juice is seen only through the glass, refracted, the way it is in a real bottle
// The juice is drawn as a volume of light: a bright core where light passes straight through, saturated edges where
// it travels through more liquid, a brighter meniscus near the surface and one soft internal glint.
// It sits inside the thick glass, which refracts it, so it moves and bends like liquid when the bottle turns.
const JUICE = { aube: ['#fff1c9', '#d9a845', '#8a5a14'], peau: ['#ffe1d2', '#e59a7e', '#9a4a34'], minuit: ['#ffb060', '#b9540f', '#3e1002'],
  lin: ['#f7f2ff', '#d6c9ee', '#8d7bb3'], figue: ['#f6f7e4', '#cdd296', '#6f7a3a'], velours: ['#ffc7cd', '#b3324a', '#4e0c1a'] };
function juiceMat(k, y0, y1, hw = 1) {
  const J = JUICE[k], m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uCore: { value: new THREE.Color(J[0]) }, uMid: { value: new THREE.Color(J[1]) }, uDeep: { value: new THREE.Color(J[2]) }, uY: { value: new THREE.Vector2(y0, y1) }, uW: { value: hw }, uLay: { value: m.userData.lay || 0 } }); m.userData.sh = sh;
    sh.vertexShader = 'varying vec3 vN; varying vec3 vV; varying float vY; varying float vX;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvY = position.y; vX = position.x; vN = normalize(normalMatrix * normal); vec4 mvJ = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mvJ.xyz);');
    sh.fragmentShader = 'uniform vec3 uCore, uMid, uDeep; uniform vec2 uY; uniform float uW, uLay; varying vec3 vN; varying vec3 vV; varying float vY; varying float vX;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      `float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
       vec3 dp = mix(uDeep, mix(uMid, uCore, 0.3), uLay * 0.85);
       float t = clamp((vY - uY.x) / (uY.y - uY.x), 0.0, 1.0);
       vec3 c = mix(dp, uMid, smoothstep(0.0, 0.55, ndv));
       c = mix(c, uCore, smoothstep(0.55, 1.0, ndv) * 0.75);
       c = mix(c, uMid, smoothstep(0.35, 1.0, abs(vX) / uW) * 0.55);
       c = mix(c, dp, smoothstep(0.8, 1.0, abs(vX) / uW) * 0.35);
       c *= mix(0.78, 1.08, t);
       c += uCore * smoothstep(0.9, 1.0, t) * 0.18;
       float g = exp(-pow((vN.x + 0.42) / 0.16, 2.0)) * smoothstep(0.1, 0.5, t) * (1.0 - smoothstep(0.85, 1.0, t));
       c += vec3(1.0, 0.97, 0.92) * g * 0.22;
       outgoingLight = c;
       #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'juice' + k + y0 + y1;
  return m;
}

/* ---------- wordmark: fine gold lettering on the glass ---------- */
const WM = {};
function wordmark(name) {
  if (WM[name]) return WM[name];
  const c = document.createElement('canvas'); c.width = 1024; c.height = 320;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const spaced = (txt, font, sp, y) => { g.font = font; let w = 0; for (const ch of txt) w += g.measureText(ch).width + sp; w -= sp;
    let x = 512 - w / 2; for (const ch of txt) { const cw = g.measureText(ch).width; g.fillText(ch, x + cw / 2, y); x += cw + sp; } };
  spaced('LUEUR', '200 112px Jost, "Helvetica Neue", Arial, sans-serif', 44, 120);
  spaced(name.toUpperCase(), '300 40px Jost, "Helvetica Neue", Arial, sans-serif', 30, 238);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  return (WM[name] = t);
}
const labelMat = name => new THREE.MeshPhysicalMaterial({ color: 0xe6c592, metalness: 1, roughness: .2, alphaMap: wordmark(name), transparent: true, depthWrite: false, clearcoat: .3 });

/* ---------- ground: soft contact shadow and the warm light that passes through the juice ---------- */
const TEX = {};
function radial(key, stops) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); for (const [o, col] of stops) r.addColorStop(o, col);
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); return (TEX[key] = new THREE.CanvasTexture(c));
}
function shadow(w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radial('sh', [[0, 'rgba(60,40,28,.62)'], [.3, 'rgba(60,40,28,.3)'], [1, 'rgba(60,40,28,0)']]), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.scale.set(w, d, 1); m.position.y = .002; m.renderOrder = -1; return m;
}
function caustic(k, w, d, z) {
  const col = new THREE.Color(JUICE[k][1]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radial('ca', [[0, 'rgba(255,255,255,.75)'], [.45, 'rgba(255,255,255,.22)'], [1, 'rgba(255,255,255,0)']]), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.scale.set(w, d, 1); m.position.set(0, .003, z); m.renderOrder = -1; return m;
}

/* ---------- geometry helpers ---------- */
const V = (x, y) => new THREE.Vector2(x, y);
function lathe(pts, seg = 128) { const g = new THREE.LatheGeometry(pts, seg); g.computeVertexNormals(); return g; }
function cyl(r0, r1, h, y, mat, seg = 96) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.y = y + h / 2; return m; }
function chamferRect(w, d, c) { // a rectangle with cut corners: the facets catch the light
  const s = new THREE.Shape(), x = w / 2, z = d / 2;
  s.moveTo(-x + c, -z); s.lineTo(x - c, -z); s.lineTo(x, -z + c); s.lineTo(x, z - c); s.lineTo(x - c, z); s.lineTo(-x + c, z); s.lineTo(-x, z - c); s.lineTo(-x, -z + c); s.closePath(); return s;
}
function roundRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d); s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
// extrude a footprint upward between two heights; the bevel rounds every edge so it catches a fine highlight
function prism(shape, y0, y1, mat, bevel = 0, curve = 12) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(.001, y1 - y0 - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: curve });
  geo.rotateX(-Math.PI / 2); geo.translate(0, y0 + bevel, 0); geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

// the pump under every cap: collar with fine rings, stem, actuator with a real nozzle hole
function pump(collarR, collarH, y0) {
  const g = new THREE.Group(), m = mats();
  const cp = [V(0, 0), V(collarR * .985, 0), V(collarR, .012)];
  for (let i = 0; i <= 16; i++) { const y = .012 + (collarH - .03) * i / 16; cp.push(V(collarR - (i % 2 ? .004 : 0), y)); } // fine knurled rings
  cp.push(V(collarR * .97, collarH), V(collarR * .55, collarH), V(0, collarH));
  const c = new THREE.Mesh(lathe(cp), m.gold); c.position.y = y0; g.add(c);
  g.add(cyl(collarR * .3, collarR * .3, .07, y0 + collarH, m.goldSatin, 48));
  const ag = new THREE.Group(); g.add(ag); g.userData.act = ag;
  const ar = Math.max(.085, collarR * .42);
  const a = new THREE.Mesh(lathe([V(0, 0), V(ar, 0), V(ar, .16), V(ar * .93, .195), V(0, .2)]), m.gold); a.position.y = y0 + collarH + .07; ag.add(a);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(.016, 20), m.hole);
  hole.position.set(-ar - .001, y0 + collarH + .07 + .11, 0); hole.rotation.y = -Math.PI / 2; ag.add(hole);
  g.userData.nozzle = new THREE.Vector3(-ar - .01, y0 + collarH + .07 + .11, 0);
  g.userData.top = y0 + collarH;
  return g;
}

function clip(p, y0, y1) { // the part of a lathe profile between two heights, closed to the axis
  const out = [V(0, y0)];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    if (a.y >= y0 && a.y <= y1 && a.x > 0) out.push(a.clone());
    for (const yy of [y0, y1]) if ((a.y - yy) * (b.y - yy) < 0) { const t = (yy - a.y) / (b.y - a.y); out.push(V(a.x + (b.x - a.x) * t, yy)); }
  }
  const last = p[p.length - 1]; if (last.y >= y0 && last.y <= y1 && last.x > 0) out.push(last.clone());
  out.sort((m, n) => m.y - n.y); out.push(V(0, y1)); return out;
}
/* ---------- paper labels: printed card stuck on the glass ---------- */
const PL = {};
function paperLabel(key, lines, w, h) {
  if (PL[key]) return PL[key];
  const c = document.createElement('canvas'); c.width = 768; c.height = Math.round(768 * h / w); const g = c.getContext('2d');
  g.fillStyle = '#f7f3ec'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(60,45,35,.35)'; g.lineWidth = 2; g.strokeRect(22, 22, c.width - 44, c.height - 44);
  g.fillStyle = '#2b2622'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const spaced = (txt, font, sp, y) => { g.font = font; let tw = 0; for (const ch of txt) tw += g.measureText(ch).width + sp; tw -= sp;
    let x = c.width / 2 - tw / 2; for (const ch of txt) { const cw = g.measureText(ch).width; g.fillText(ch, x + cw / 2, y); x += cw + sp; } };
  const H = c.height; spaced('LUEUR', '300 92px Jost, "Helvetica Neue", Arial, sans-serif', 30, H * .3);
  g.fillRect(c.width / 2 - 40, H * .44, 80, 2);
  spaced(lines[0], 'italic 400 64px "Instrument Serif", Georgia, serif', 2, H * .58);
  spaced(lines[1], '400 24px "DM Mono", monospace', 8, H * .78);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  // transparent so the glass does not refract copies of it
  return (PL[key] = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: .55, roughness: .85, metalness: 0, envMapIntensity: .5, transparent: true }));
}
// a lofted solid: a stack of rounded-rectangle sections whose width and depth follow functions of height
function loft(wf, df, y0, y1, r = .08, steps = 60, seg = 12) {
  const pos = [], idx = [], ring = [];
  const sect = (w, d) => { const pts = [], rr = Math.min(r, w / 2 - .001, d / 2 - .001), cx = w / 2 - rr, cz = d / 2 - rr;
    for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]])
      for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; pts.push([sx * cx + Math.cos(a) * rr, sz * cz + Math.sin(a) * rr]); }
    return pts; };
  let n = 0;
  for (let i = 0; i <= steps; i++) { const y = y0 + (y1 - y0) * i / steps, s = sect(wf(y), df(y)); n = s.length; for (const [x, z] of s) pos.push(x, y, z); }
  for (let i = 0; i < steps; i++) for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n, c = a + n, d = b + n; idx.push(a, c, b, b, c, d); }
  const cap = (yy, wf2, df2, flip) => { const base = pos.length / 3; pos.push(0, yy, 0); const s = sect(wf2, df2); for (const [x, z] of s) pos.push(x, yy, z);
    for (let j = 0; j < s.length; j++) { const a = base + 1 + j, b = base + 1 + (j + 1) % s.length; flip ? idx.push(base, a, b) : idx.push(base, b, a); } };
  cap(y0, wf(y0), df(y0), true); cap(y1, wf(y1), df(y1), false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}
const round = (y, y0, y1, k, e = 6) => { const t = Math.abs((y - (y0 + y1) / 2) / ((y1 - y0) / 2)); return Math.pow(Math.max(0, 1 - Math.pow(t, e)), 1 / e) * k + (1 - k); };

/* ---------- the six bottles ---------- */
// Aube, dawn: a square of cut glass with bevelled edges, champagne juice, a square crystal stopper on a gold collar
function bottleAube() {
  const m = mats(), g = new THREE.Group();
  const W = 1.16, D = .62, C = .1, H = 1.55, T = .12, B = .4, F = H - .32;
  g.add(prism(chamferRect(W - .04, D - .04, C), 0, H, m.glass, .02));
  g.add(prism(chamferRect(W - 2 * T, D - 2 * T, C * .7), B, F, juiceMat('aube', B, F, W / 2 - T), .025));
  g.add(cyl(.015, .015, H - B - .05, B + .02, m.tube, 12));
  const pu = pump(.19, .17, H - .01); g.add(pu);
  const cap = new THREE.Group();
  cap.add(prism(chamferRect(.48, .4, .06), 0, .03, m.gold, .006));
  const cut = new THREE.LatheGeometry([V(0, .03), V(.25, .03), V(.27, .08), V(.27, .32), V(.19, .44), V(0, .46)], 4, Math.PI / 4);
  cut.scale(1, 1, .82); cut.computeVertexNormals();
  const cc = m.crystal.clone(); cc.flatShading = true; cc.onBeforeCompile = m.crystal.onBeforeCompile; cc.customProgramCacheKey = () => 'cutcrystal';
  cap.add(new THREE.Mesh(cut, cc));
  cap.userData.clear = true;
  cap.position.y = pu.userData.top; g.add(cap);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(.46, .46), paperLabel('aube', ['Aube', 'EAU DE PARFUM · 50 ML'], 1, 1)); lab.position.set(0, .86, (D - .04) / 2 + .021); g.add(lab);
  return finish(g, cap, pu, 'aube', [2, 1.2], [1.4, .9, .55], [B, F, H]);
}
// Peau, skin: a round, full flask that sits in the palm, rosé juice, a slender gold cap
function bottlePeau() {
  const m = mats(), g = new THREE.Group();
  const R = .84, cy = .7, hh = .76, n = 2.35, SZ = .86;
  const se = (r, y) => r * Math.pow(Math.max(0, 1 - Math.pow(Math.abs((y - cy) / hh), n)), 1 / n);
  const top = 1.36, B = .36, F = 1.04;
  const prof = [V(0, 0)]; for (let i = 0; i <= 120; i++) { const y = top * i / 120; prof.push(V(Math.max(.001, se(R, y)), y)); } prof.push(V(0, top));
  const pg = m.glass.clone(); pg.thickness = .8; pg.onBeforeCompile = m.glass.onBeforeCompile; pg.customProgramCacheKey = m.glass.customProgramCacheKey;
  const glass = new THREE.Mesh(lathe(prof, 160), pg); glass.scale.z = SZ; g.add(glass);
  const inner = [V(0, B)]; for (let i = 0; i <= 60; i++) { const y = B + (F - B) * i / 60; inner.push(V(Math.max(.001, se(R, y) - .2), y)); } inner.push(V(0, F));
  const j = new THREE.Mesh(lathe(inner, 160), juiceMat('peau', B, F, R - .2)); j.scale.z = SZ * .84; g.add(j);
  g.add(cyl(.015, .015, top - .4, .38, m.tube, 12));
  const pu = pump(.2, .18, top - .03); g.add(pu);
  const cap = new THREE.Group(), cp = [V(0, 0), V(.215, 0), V(.215, .58)]; for (let i = 1; i <= 10; i++) { const a = i / 10 * Math.PI / 2; cp.push(V(.175 + .04 * Math.cos(a), .58 + .04 * Math.sin(a))); } cp.push(V(0, .62));
  cap.add(new THREE.Mesh(lathe(cp), m.gold));
  for (let i = 0; i < 5; i++) cap.add(cyl(.219, .219, .008, .05 + i * .022, m.goldSatin));
  cap.position.y = pu.userData.top; g.add(cap);
  const ly = .66, lr = se(R, ly) + .008;
  const labGeo = new THREE.CylinderGeometry(lr, lr, .19, 64, 1, true, -0.4, .8); labGeo.scale(1, 1, SZ);
  const lab = new THREE.Mesh(labGeo, labelMat('Peau')); lab.position.y = ly; g.add(lab);
  return finish(g, cap, pu, 'peau', [2.2, 1.6], [1.6, 1.1, .6], [B, F, top]);
}
// Minuit, midnight: a waisted flask that moves like a silhouette in a dark dress, amber juice, a faceted gunmetal stone
function bottleMinuit() {
  const m = mats(), g = new THREE.Group();
  const H = 1.7, B = .38, F = 1.36;
  const wf = y => (1.12 + .2 * Math.cos(2 * Math.PI * y / H + .25) ) * round(y, 0, H, .25, 8);
  const df = y => .62 * round(y, 0, H, .2, 8);
  g.add(new THREE.Mesh(loft(wf, df, 0, H, .2, 80, 10), m.glass));
  const jw = y => Math.max(.05, wf(y) - .26), jd = y => Math.max(.05, df(y) - .2);
  g.add(new THREE.Mesh(loft(jw, jd, B, F, .14, 50, 8), juiceMat('minuit', B, F, (wf((B + F) / 2) - .26) / 2)));
  g.add(cyl(.015, .015, H - B - .05, B + .02, m.tube, 12));
  const pu = pump(.18, .17, H - .01); g.add(pu);
  const cap = new THREE.Group();
  const gem = new THREE.LatheGeometry([V(0, 0), V(.24, 0), V(.33, .14), V(.24, .36), V(.1, .44), V(0, .44)], 6, Math.PI / 6); gem.computeVertexNormals();
  cap.add(new THREE.Mesh(gem, m.gunmetal));
  cap.position.y = pu.userData.top; g.add(cap);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(.62, .194), labelMat('Minuit')); lab.position.set(0, .2, df(.2) / 2 + .012); g.add(lab);
  return finish(g, cap, pu, 'minuit', [2.4, 1.3], [1.6, .9, .55], [B, F, H]);
}
// Lin, linen: a tall flat bottle, clear as water, a hint of lilac, a brushed gold column cap and a printed card
function bottleLin() {
  const m = mats(), g = new THREE.Group();
  const W = 1.02, D = .5, H = 1.72, T = .1, B = .34, F = H - .3;
  g.add(prism(roundRect(W - .04, D - .04, .05), 0, H, m.glass, .02));
  g.add(prism(roundRect(W - 2 * T, D - 2 * T, .04), B, F, juiceMat('lin', B, F, W / 2 - T), .02));
  g.add(cyl(.015, .015, H - B - .05, B + .02, m.tube, 12));
  const pu = pump(.17, .16, H - .01); g.add(pu);
  const cap = new THREE.Group();
  cap.add(cyl(.205, .205, .56, 0, m.goldSatin)); cap.add(cyl(.207, .207, .012, .03, m.gold)); cap.add(cyl(.2, .2, .012, .556, m.gold));
  cap.position.y = pu.userData.top; g.add(cap);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), paperLabel('lin', ['Lin', 'EAU DE PARFUM · 50 ML'], 1, 1)); lab.position.set(0, .82, (D - .04) / 2 + .021); g.add(lab);
  return finish(g, cap, pu, 'lin', [1.8, 1], [1.2, .7, .45], [B, F, H]);
}
// Figue: a low, wide laboratory bottle, pale green juice, a black cap and a typed label
function bottleFigue() {
  const m = mats(), g = new THREE.Group();
  const W = 1.26, D = .58, H = 1.12, T = .12, B = .3, F = H - .24;
  g.add(prism(roundRect(W - .04, D - .04, .04), 0, H, m.glass, .02));
  g.add(prism(roundRect(W - 2 * T, D - 2 * T, .03), B, F, juiceMat('figue', B, F, W / 2 - T), .02));
  g.add(cyl(.015, .015, H - B - .05, B + .02, m.tube, 12));
  const pu = pump(.17, .15, H - .01); g.add(pu);
  const cap = new THREE.Group();
  const lp = [V(0, 0), V(.2, 0), V(.2, .36)]; for (let i = 1; i <= 6; i++) { const a = i / 6 * Math.PI / 2; lp.push(V(.185 + .015 * Math.cos(a), .36 + .015 * Math.sin(a))); } lp.push(V(0, .375));
  cap.add(new THREE.Mesh(lathe(lp), m.lacquer));
  cap.position.y = pu.userData.top; g.add(cap);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(.66, .4), paperLabel('figue', ['Figue', 'EAU DE PARFUM · 50 ML'], .66, .4)); lab.position.set(0, .58, (D - .04) / 2 + .021); g.add(lab);
  return finish(g, cap, pu, 'figue', [2.1, 1.1], [1.4, .8, .5], [B, F, H]);
}
// Velours, velvet: a tall faceted crystal column, ruby juice, a cut gold cap on a gold shoulder
function bottleVelours() {
  const m = mats(), g = new THREE.Group();
  const W = 1.0, D = .66, C = .15, H = 2.0, T = .1, B = .46, F = H - .38;
  g.add(prism(chamferRect(W - .04, D - .04, C), 0, H, m.glass, .02));
  g.add(prism(chamferRect(W - 2 * T, D - 2 * T, C * .7), B, F, juiceMat('velours', B, F, W / 2 - T), .025));
  g.add(cyl(.015, .015, H - B - .05, B + .02, m.tube, 12));
  g.add(prism(chamferRect(.5, .4, .1), H - .005, H + .035, m.gold, .008));
  const pu = pump(.17, .17, H + .035); g.add(pu);
  const cap = new THREE.Group();
  cap.add(prism(chamferRect(.56, .45, .1), 0, .035, m.gold, .008));
  const cut = new THREE.LatheGeometry([V(0, .035), V(.25, .035), V(.27, .09), V(.27, .52), V(.2, .64), V(.12, .7), V(0, .7)], 8, Math.PI / 8);
  cut.scale(1, 1, .8); cut.computeVertexNormals();
  const cm = m.gold.clone(); cm.flatShading = true; cm.roughness = .2; cm.envMapIntensity = 1.6;
  cap.add(new THREE.Mesh(cut, cm));
  cap.position.y = pu.userData.top; g.add(cap);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(.62, .194), labelMat('Velours')); lab.position.set(0, .2, (D - .04) / 2 + .021); g.add(lab);
  return finish(g, cap, pu, 'velours', [1.7, 1.15], [1.3, .9, .55], [B, F, H]);
}
function finish(g, cap, pu, k, sh, ca, zn) {
  const box = new THREE.Box3().setFromObject(g), cb = new THREE.Box3().setFromObject(cap);
  const s = shadow(sh[0], sh[1]); s.userData.isShadow = true; g.add(s);
  const c = caustic(k, ca[0], ca[1], ca[2]); c.userData.isShadow = true; g.add(c);
  g.userData = { cap, capY: cap.position.y, nozzle: pu.userData.nozzle, act: pu.userData.act, height: box.max.y,
    kind: k, clearCap: !!cap.userData.clear, width: box.max.x - box.min.x, capW: cb.max.x - cb.min.x, front: box.max.z, zones: zn, open: 0 };
  return g;
}
const BUILD = { aube: bottleAube, peau: bottlePeau, minuit: bottleMinuit, lin: bottleLin, figue: bottleFigue, velours: bottleVelours };
export function makeBottle(k) { mats(); return BUILD[k](); }
const DIMS = {};
export function dims(k) { // closed height and width, for layout
  if (!DIMS[k]) { const b = makeBottle(k); DIMS[k] = { h: b.userData.height, w: b.userData.width }; }
  return DIMS[k];
}

// open: 0 closed, 1 open. 'aside': the cap is unscrewed, lifted and set down beside the bottle like a hand would do it.
// 'lift': it is unscrewed and hovers above the pump (narrow frames).
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); }; // smootherstep: still at both ends
// open: 0 closed, 1 open. 'aside': unscrewed, lifted, carried in a slow arc and set down beside the bottle like a hand would.
// 'lift': unscrewed and held just above the pump (narrow frames).
export function setOpen(b, t, side = 1, mode = 'aside') {
  const u = b.userData;
  if (u.clearCap && u.act) u.act.visible = t > .04;   // a clear cap would show the pump inside it
  const turn = sm(0, .42, t);                          // the unscrewing turn happens while it rises
  if (mode === 'lift') {
    u.cap.position.set(0, u.capY + sm(0, 1, t) * .55, 0);
    u.cap.rotation.set(0, -turn * Math.PI * .9, sm(.3, 1, t) * .07 * side);
  } else {
    const rise = sm(0, .4, t) * .42, glide = sm(.28, .86, t), land = sm(.5, 1, t);
    const x = -(u.width / 2 + u.capW * .62) * side, z = u.front * .1;
    u.cap.position.set(x * glide, (u.capY + rise) * (1 - land) + Math.sin(Math.PI * glide) * .1, z * glide);
    u.cap.rotation.set(0, -turn * Math.PI * 1.15, Math.sin(Math.PI * glide) * .1 * side);
  }
  u.open = t;
}
// lay: 0 standing, 1 a flat lay. Seen from above, the bottle rests on its back on a sunlit surface and
// turns into a diagonal, like a still life shot from overhead. The table shadow gives way to a drop shadow (CSS).
export function setLay(b, t) {
  const u = b.userData;
  if (!u.lay) {
    const inner = new THREE.Group(), sh = [];
    for (const c of [...b.children]) { if (c.userData.isShadow) sh.push(c); else inner.add(c); }
    b.add(inner); u.lay = { inner, sh, t: -1, cy: u.height * .42 };
  }
  const L = u.lay; if (L.t === t) return; L.t = t;
  const e = sm(0, 1, t), th = -.62 * e;                       // a diagonal, cap to the upper right
  L.inner.traverse(o => { const mm = o.material; if (mm && mm.customProgramCacheKey && mm.userData) { mm.userData.lay = e; if (mm.userData.sh) mm.userData.sh.uniforms.uLay.value = e; } });
  // turn about the middle of the body, so it stays where it was
  const c = Math.cos(th), s = Math.sin(th);
  L.inner.rotation.z = th; L.inner.position.set(L.cy * s, L.cy - L.cy * c, 0);
  for (const m of L.sh) m.visible = e < .12;
}
export function setPress(b, t) { if (b.userData.act) b.userData.act.position.y = -.045 * t; }

/* ---------- views ---------- */
// A view renders one bottle into a canvas that overflows its host element, so the host keeps the page layout
// (flips, transitions, aspect ratios) while the bottle can open beyond it.
// Each frame is drawn twice: once in color over a backdrop that matches the page (the glass refracts it),
// once as a silhouette mask, so only the bottle and its soft shadow land on the page. No rectangles, no seams.
const views = new Set();
let raf = null;
const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
let SHMASK = null;
function shadowMask() {
  if (SHMASK) return SHMASK;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, '#8c8c8c'); r.addColorStop(.35, '#404040'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  SHMASK = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false });
  return SHMASK;
}
export class View {
  constructor(host, opts = {}) {
    this.host = host;
    this.o = Object.assign({ fov: 22, dpr: 1.75, pad: [.42, .5, .16, .5], tilt: .07, bg: ['#F4EDE7', '#EADFD5'], group: 'main', mode: 'aside', side: 1 }, opts);
    this.G = group(this.o.group);
    this.canvas = document.createElement('canvas'); this.canvas.className = 'gl-view'; this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', maxWidth: 'none' });
    this.ctx = this.canvas.getContext('2d');
    host.insertBefore(this.canvas, host.querySelector('.mist'));
    this.scene = new THREE.Scene(); this.scene.environment = this.G.env; this.scene.environmentRotation = new THREE.Euler(0, this.o.envRot ?? 1.2, 0); this.scene.environmentIntensity = this.o.envK ?? 1;
    const key = new THREE.DirectionalLight(0xfff4ea, .6); key.position.set(-3, 5, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe2cc, .5); rim.position.set(4, 3, -3); this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(this.o.fov, 1, .1, 200); this.scene.add(this.camera);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.it = null; this.dirty = true; this.visible = false; this.hw = 0; this.hh = 0;
    this.setBg(this.o.bg);
    this.io = new IntersectionObserver(es => { this.visible = es[es.length - 1].isIntersecting; if (this.visible) this.kick(); }, { rootMargin: '160px' });
    this.io.observe(host);
    this.ro = new ResizeObserver(() => { this.layout(); this.kick(); }); this.ro.observe(host);
    views.add(this);
  }
  setBg(bg) { // the backdrop the glass refracts. It must be a real mesh: transmission does not see scene.background
    this.bg = typeof bg === 'string' ? [bg, bg] : bg;
    if (!this.backdrop) {
      this.bgCanvas = document.createElement('canvas'); this.bgCanvas.width = 512; this.bgCanvas.height = 256;
      const t = new THREE.CanvasTexture(this.bgCanvas); t.colorSpace = THREE.SRGBColorSpace;
      this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, depthWrite: false }));
      this.backdrop.renderOrder = -10; this.camera.add(this.backdrop);
    }
    this.paintBg(); this.kick();
  }
  // a photographer's set, seen only through the glass: the wall colour of the page, two soft black flags just
  // outside the bottle's edges and a faint table line. Refracted, they give the glass its dark edges and depth.
  paintBg() {
    const c = this.bgCanvas, g = c.getContext('2d'), W = c.width, H = c.height, bg = this.bg;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const s = 1 / 1.05, toU = f => ((f - .5) * s + .5) * W, toV = f => ((f - .5) * s + .5) * H;
    const cx = this.cw ? (this.o.pad[3] * this.hh + this.hw / 2) / this.cw : .5, half = this.cw ? this.hw / 2 / this.cw : .2;
    const tk = this.it ? Math.max(this.lying ? 1 : 0, this.tintK || 0) : 0;
    if (tk > 0) { g.globalAlpha = .8 * tk; g.fillStyle = JUICE[this.it.k][0]; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }   // lying, the thick base sees the juice, never a bright wall
    if (!this.lying) for (const side of [-1, 1]) {
      const x = toU(cx + side * half * .9), w = Math.max(4, half * W * .26);
      const fl = g.createLinearGradient(x - w, 0, x + w, 0);
      fl.addColorStop(0, 'rgba(38,30,26,0)'); fl.addColorStop(.5, 'rgba(34,27,23,.55)'); fl.addColorStop(1, 'rgba(38,30,26,0)');
      g.fillStyle = fl; g.fillRect(x - w, 0, w * 2, H);
    }
    const hy = this.ch ? (1 - ((this.o.pad[0] + 1) * this.hh) / this.ch) : .7, y = (1 - ((1 - hy) - .5) * s - .5) * H;
    const tl = g.createLinearGradient(0, y - 18, 0, y + 30); tl.addColorStop(0, 'rgba(255,255,255,0)'); tl.addColorStop(.4, 'rgba(255,252,248,.55)'); tl.addColorStop(1, 'rgba(120,96,80,.12)');
    if (tk < .5) { g.fillStyle = tl; g.fillRect(0, y - 18, W, 48); }
    if (this.it && this.ch && !this.lying) {   // the base glows with the juice above it, a bright line where the liquid sits on the glass
      const z = this.it.b.userData.zones, H3 = this.it.b.userData.height, yAt = wy => toV((this.o.pad[0] * this.hh + this.hh * (1 - wy / H3)) / this.ch);
      const x0 = toU(cx - half * .9), x1 = toU(cx + half * .9), J = JUICE[this.it.k];
      const yb0 = yAt(0), yb1 = yAt(z[0]), bg2 = g.createLinearGradient(0, yb1, 0, yb0);
      bg2.addColorStop(0, J[1] + 'aa'); bg2.addColorStop(.35, J[0] + '66'); bg2.addColorStop(1, J[0] + '10');
      g.fillStyle = bg2; g.fillRect(x0, yb1, x1 - x0, yb0 - yb1);
      g.fillStyle = 'rgba(255,253,248,.8)'; g.fillRect(x0, yb1 - 1.5, x1 - x0, 3);
      const yh0 = yAt(z[1]), yh1 = yAt(z[2]), hg = g.createLinearGradient(0, yh1, 0, yh0);
      hg.addColorStop(0, 'rgba(255,255,255,.35)'); hg.addColorStop(1, J[0] + '55');
      g.fillStyle = hg; g.fillRect(x0, yh1, x1 - x0, yh0 - yh1);
    }
    this.backdrop.material.map.needsUpdate = true; this.fitBackdrop(); this.dirty = true;
  }
  fitBackdrop() {
    const z = (this.dist || 10) + 6, hh = 2 * z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.backdrop.position.set(0, 0, -z); this.backdrop.scale.set(hh * Math.max(this.camera.aspect, .2) * 1.05, hh * 1.05, 1);
  }
  set(k) {
    if (this.it && this.it.k === k) return this.it;
    if (this.it) this.root.remove(this.it.b);
    const b = makeBottle(k); b.position.z = -b.userData.front; this.root.add(b); // the front face sits on the layout plane
    this.it = { b, k, rot: 0, rotT: 0, open: 0, openT: 0, sway: 0, swayT: 0, press: 0 };
    this.layout(); this.kick(); return this.it;
  }
  layout() { // canvas overflows the host by `pad` (in host heights); the closed bottle fills the host height
    const hw = this.host.offsetWidth, hh = this.host.offsetHeight; if (!hw || !hh || !this.it) return;
    this.hw = hw; this.hh = hh;
    const [pt, pr, pb, pl] = this.o.pad, cw = hw + (pl + pr) * hh, ch = hh * (1 + pt + pb);
    Object.assign(this.canvas.style, { left: -pl * hh + 'px', top: -pt * hh + 'px', width: cw + 'px', height: ch + 'px' });
    const H3 = this.it.b.userData.height, wpp = H3 / hh, vis = ch * wpp;
    const d = (vis / 2) / Math.tan(THREE.MathUtils.degToRad(this.o.fov / 2));
    const yc = H3 * (1 - pb + pt) / 2, xc = (pr - pl) * hh / 2 * wpp;
    this.camera.aspect = cw / ch; this.cam0 = { xc, yc, d };
    this.dist = d; this.cw = cw; this.ch = ch; this.applyLens(); this.paintBg();
  }
  // a macro lens: zoom in and pan to a height on the bottle (fraction of its height), the render stays sharp
  setLens(z, fy, fx = 0) { const L = this.lensV || (this.lensV = { z: 1, fy: null, fx: 0 }); if (L.z === z && L.fy === fy && L.fx === fx) return; L.z = z; L.fy = fy; L.fx = fx; this.applyLens(); this.dirty = true;
    const tk = Math.round(Math.min(1, Math.max(0, (z - 1.04) / .5)) * 10) / 10; if (tk !== (this.tintK || 0)) { this.tintK = tk; this.paintBg(); } }
  applyLens() {
    if (!this.cam0 || !this.it) return;
    const { xc, yc, d } = this.cam0, L = this.lensV || { z: 1, fy: null, fx: 0 }, H3 = this.it.b.userData.height;
    const k = Math.min(1, Math.max(0, (L.z - 1) / .6));                  // ease from the framing centre to the focus
    const ty = L.fy == null ? yc : yc + (L.fy * H3 - yc) * k, tx = xc + L.fx * H3 * k;
    this.camera.zoom = L.z; this.camera.position.set(tx, ty + d * this.o.tilt, d);
    this.camera.lookAt(tx, ty, 0); this.camera.updateProjectionMatrix();
  }
  setEnvRot(r) { if (this.scene.environmentRotation.y !== r) { this.scene.environmentRotation.y = r; this.dirty = true; } }
  kick() { this.dirty = true; if (raf === null) raf = requestAnimationFrame(loop); }
  now() { this.visible = true; this.step(16); this.draw(); } // draw synchronously (before a flip starts)
  step(dt) {
    const it = this.it; if (!it) return false;
    const f = a => 1 - Math.pow(1 - a, dt / 16.667);
    let moving = false;
    for (const [v, t, a] of [['rot', 'rotT', .1], ['sway', 'swayT', .08]]) {
      const dd = it[t] - it[v];
      if (Math.abs(dd) > .0006) { it[v] += dd * f(a); moving = true; } else it[v] = it[t];
    }
    // the cap moves on its own clock: about two seconds for the full gesture, eased in and out
    if (it.openT !== it.open) {
      if (!it.tw || it.tw.to !== it.openT) it.tw = { from: it.open, to: it.openT, el: 0, dur: (this.o.capDur || 2100) * Math.max(.35, Math.abs(it.openT - it.open)) };
      it.tw.el += dt; const k = Math.min(1, it.tw.el / it.tw.dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      it.open = k >= 1 ? it.tw.to : it.tw.from + (it.tw.to - it.tw.from) * e; moving = true;
      if (k >= 1) it.tw = null;
    } else it.tw = null;
    it.b.rotation.y = it.rot + it.sway;
    setOpen(it.b, it.open, this.o.side, this.o.mode); setPress(it.b, it.press); if (it.lay !== undefined) { setLay(it.b, it.lay); const ly = it.lay > .02; if (ly !== !!this.lying) { this.lying = ly; this.paintBg(); } }
    return moving;
  }
  draw() {
    if (!this.it || !this.cw) return;
    const R = this.G.R, dpr = Math.min(this.o.dpr, devicePixelRatio || 1), w = Math.round(this.cw * dpr), h = Math.round(this.ch * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const sz = R.getSize(new THREE.Vector2()); if (sz.x !== w || sz.y !== h) R.setSize(w, h, false);
    // color pass
    this.backdrop.visible = true; R.setClearColor(0xffffff, 1); 
    R.render(this.scene, this.camera);
    const c = this.ctx; c.globalCompositeOperation = 'copy'; c.drawImage(R.domElement, 0, 0);
    // silhouette pass
    this.backdrop.visible = false; const keep = [];
    this.root.traverse(o => { if (o.isMesh) { keep.push([o, o.material]); o.material = o.userData.isShadow ? shadowMask() : WHITE; } });
    R.setClearColor(0x000000, 0);
    R.render(this.scene, this.camera);
    for (const [o, m] of keep) o.material = m;
    c.globalCompositeOperation = 'destination-in'; c.drawImage(R.domElement, 0, 0); c.globalCompositeOperation = 'source-over';
    this.dirty = false;
    if (this.onDraw) this.onDraw();
  }
  // where the table (world y = 0, at the bottle) lands, as a fraction of the host height from its top
  tableFrac() { const v = new THREE.Vector3(0, 0, this.it ? -this.it.b.userData.front * 2.2 : 0); v.project(this.camera); return ((1 - v.y) / 2 * this.ch - this.o.pad[0] * this.hh) / this.hh; }
  // nozzle position as a fraction of the host box (so CSS and the hero spray can anchor to it)
  nozzleFrac() {
    const n = this.it.b.userData.nozzle.clone(); this.it.b.localToWorld(n); const p = n.project(this.camera);
    const x = (p.x + 1) / 2 * this.cw - this.o.pad[3] * this.hh, y = (1 - p.y) / 2 * this.ch - this.o.pad[0] * this.hh;
    return { x: x / this.hw, y: y / this.hh };
  }
}
/* renderers: one per group, so views of different sizes don't make each other reallocate every frame */
const GROUPS = {};
function group(name) {
  if (GROUPS[name]) return GROUPS[name];
  const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.NeutralToneMapping; R.toneMappingExposure = 1;
  const pm = new THREE.PMREMGenerator(R), env = pm.fromScene(studio(), 0.02).texture; pm.dispose();
  const G = (GROUPS[name] = { R, env });
  // a real photo studio (Poly Haven, CC0) replaces the drawn one as soon as it arrives
  hdr().then(t => { const p = new THREE.PMREMGenerator(R), sc = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(30, 64, 32), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: false })); sc.add(sky);
    const strip = (x, z, ry, k) => { const mm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }); mm.color.setScalar(k);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 16), mm); pl.position.set(x, 1, z); pl.rotation.y = ry; sc.add(pl); };
    strip(-7, 6, Math.PI * .8, 6); strip(7.5, 4, -Math.PI * .7, 4.5); strip(-3, -9, 0, 2.5);
    G.env = p.fromScene(sc, .01).texture; p.dispose();
    for (const v of views) if (v.G === G) { v.scene.environment = G.env; v.kick(); } }).catch(() => {});
  return G;
}
let HDR = null;
function hdr() { // the HDR ships as base64 inside a module so any static host serves it
  return HDR || (HDR = import('./env/studio-hdr.js').then(mod => {
    const bin = atob(mod.default), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const L = new RGBELoader(), d = L.parse(buf.buffer);
    const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
    t.colorSpace = THREE.LinearSRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.flipY = true; t.generateMipmaps = false;
    t.mapping = THREE.EquirectangularReflectionMapping; t.needsUpdate = true; return t;
  }));
}
let last = 0;
function loop(now) {
  const dt = Math.min(64, now - (last || now)); last = now;
  let again = false;
  for (const v of views) {
    if (!v.visible) continue;
    const moving = v.step(dt);
    if (moving || v.dirty) v.draw();
    again = again || moving;
  }
  raf = again ? requestAnimationFrame(loop) : (last = 0, null);
}
export function kickAll() { for (const v of views) v.kick(); }
export { THREE };
