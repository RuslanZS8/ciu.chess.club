import * as THREE from '/vendor/three.js';

/**
 * Decorative 3D backdrop behind the whole app: chess pieces floating above a
 * board that fades into the page colour. Colours come from the CSS tokens, so it
 * follows light/dark mode. With reduced motion it draws a single still frame.
 */

const canvas = document.getElementById('backdrop');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const darkScheme = matchMedia('(prefers-color-scheme: dark)');

const CAMERA_Z = 40;
const FLOOR_Y = -20;
const FOV = 45;

const v2 = (x, y) => new THREE.Vector2(x, y);
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- piece geometry ----------
// Turned pieces are lathed from [radius, height] profiles, bottom to top.

function arc(cy, r, from, to, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

const foot = (r) => [[0, 0], [r, 0], [r, 0.4], [r - 0.3, 0.65], [r - 0.3, 0.95], [r - 0.75, 1.25]];

const PROFILES = {
  pawn: [...foot(2), [0.95, 1.7], [0.7, 2.9], [1.25, 3.1], [1.25, 3.3], [0.6, 3.45], ...arc(4.3, 0.95, -1.1, Math.PI / 2)],
  rook: [...foot(2.2), [1.25, 1.8], [1.1, 4], [1.6, 4.25], [1.6, 4.45], [1.35, 4.6], [1.5, 5], [0, 5]],
  knight: [...foot(2.2), [1.35, 1.6], [0, 1.6]],
  bishop: [...foot(2), [0.95, 1.7], [0.6, 3.7], [1.15, 3.9], [1.15, 4.1], [0.55, 4.25], [0.9, 4.6], [1.05, 5.1],
    [0.95, 5.6], [0.65, 6.1], [0.3, 6.45], ...arc(6.75, 0.3, -1, Math.PI / 2, 6)],
  queen: [...foot(2.3), [1.1, 2], [0.7, 4.6], [1.35, 4.85], [1.35, 5.05], [0.75, 5.2], [0.9, 5.45], [1.5, 6.5],
    [1.55, 6.7], [1.1, 6.75], [0.75, 6.95], ...arc(7.35, 0.45, -1, Math.PI / 2, 8)],
  king: [...foot(2.4), [1.15, 2.1], [0.8, 5], [1.45, 5.25], [1.45, 5.45], [0.85, 5.6], [1, 5.85], [1.6, 6.9],
    [1.6, 7.1], [0.9, 7.35], [0.5, 7.45], [0, 7.5]],
};

// Side silhouette of the horse's head (facing +x), extruded and bevelled.
function knightHead() {
  const s = new THREE.Shape();
  s.moveTo(-1.7, 1.4);
  s.lineTo(1.6, 1.4);
  s.splineThru([
    v2(1.3, 2.2), v2(0.9, 2.9), v2(1.3, 3.3), v2(2.2, 3.45), v2(2.9, 3.6), v2(3.1, 3.95), v2(3, 4.3),
    v2(2.4, 4.8), v2(1.6, 5.5), v2(1.2, 6.1),
  ]);
  s.lineTo(0.95, 7.2); // ear
  s.lineTo(0.5, 6.55);
  s.splineThru([v2(-0.2, 6.45), v2(-1, 6), v2(-1.6, 5), v2(-1.9, 3.6), v2(-2, 2.4), v2(-1.7, 1.4)]);
  const eye = new THREE.Path();
  eye.absarc(1.45, 5.05, 0.2, 0, Math.PI * 2, true);
  s.holes.push(eye);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 1.4, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.25, bevelSegments: 3,
  }).translate(0, 0, -0.7);
  // Narrow the muzzle so the head looks carved rather than cut from a slab.
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const taper = THREE.MathUtils.smoothstep(pos.getX(i), 0.8, 3.1);
    pos.setZ(i, pos.getZ(i) * (1 - 0.45 * taper));
  }
  return g;
}

/** All parts of one piece, centred on its middle so it turns around its own centre. */
function pieceParts(type, segments) {
  const parts = [new THREE.LatheGeometry(PROFILES[type].map(([x, y]) => v2(x, y)), segments)];
  const ring = (n, r, y, make) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(make().rotateY(-a).translate(Math.cos(a) * r, y, Math.sin(a) * r));
    }
  };
  if (type === 'rook') ring(6, 1.29, 5.3, () => new THREE.BoxGeometry(0.42, 0.6, 0.75));
  if (type === 'queen') ring(8, 1.5, 6.85, () => new THREE.SphereGeometry(0.2, 8, 6));
  if (type === 'knight') parts.push(knightHead());
  if (type === 'king') {
    parts.push(new THREE.BoxGeometry(0.4, 1.4, 0.4).translate(0, 8.1, 0));
    parts.push(new THREE.BoxGeometry(1.2, 0.4, 0.4).translate(0, 8.3, 0));
  }
  const top = Math.max(...parts.map((g) => (g.computeBoundingBox(), g.boundingBox.max.y)));
  return parts.map((g) => g.translate(0, -top / 2, 0));
}

const TYPES = Object.keys(PROFILES);
const solidParts = Object.fromEntries(TYPES.map((t) => [t, pieceParts(t, 40)]));
// Fewer segments for the outline pieces so their edges read as clean facets.
const lineParts = Object.fromEntries(TYPES.map((t) => [t, pieceParts(t, 14).map((g) => new THREE.EdgesGeometry(g, 15))]));

// ---------- scene ----------

function start(renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Fog starts close so even the nearest pieces are softened towards the page colour.
  scene.fog = new THREE.Fog(0xffffff, 25, 125);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0b3d1f, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(25, 40, 30);
  const rim = new THREE.DirectionalLight(0x22c55e, 2.6);
  rim.position.set(-40, 10, -10);
  scene.add(key, rim);

  const mats = {
    ink: new THREE.MeshPhongMaterial({ specular: 0x555555, shininess: 70 }),
    green: new THREE.MeshPhongMaterial({ specular: 0x888888, shininess: 90 }),
    line: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 }),
  };

  // The board: an endless checker floor that drifts slowly towards the viewer.
  const checker = document.createElement('canvas');
  checker.width = checker.height = 2;
  const floorMap = new THREE.CanvasTexture(checker);
  floorMap.colorSpace = THREE.SRGBColorSpace;
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.magFilter = THREE.NearestFilter;
  floorMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
  floorMap.repeat.set(30, 30);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshBasicMaterial({ map: floorMap, transparent: true, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, -60);
  scene.add(floor);

  // Pieces are spread over a jittered grid so they never clump, at random depths.
  const count = innerWidth < 700 ? 9 : 16;
  const cols = Math.max(2, Math.round(Math.sqrt((count * innerWidth) / innerHeight)));
  const rows = Math.ceil(count / cols);
  const cells = [...Array(cols * rows).keys()].sort(() => Math.random() - 0.5);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  const pieces = Array.from({ length: count }, (_, i) => {
    const type = TYPES[i % TYPES.length];
    const look = ['ink', 'ink', 'green', 'line'][Math.floor(Math.random() * 4)];
    const group = new THREE.Group();
    for (const g of (look === 'line' ? lineParts : solidParts)[type]) {
      group.add(look === 'line' ? new THREE.LineSegments(g, mats.line) : new THREE.Mesh(g, mats[look]));
    }
    group.userData = {
      size: rand(0.75, 1.15),
      u: ((cells[i] % cols) + rand(0.15, 0.85)) / cols,
      v: (Math.floor(cells[i] / cols) + rand(0.15, 0.85)) / rows,
      dist: rand(44, 100),
      tiltX: rand(-0.5, 0.5),
      tiltZ: rand(-0.5, 0.5),
      spin: rand(0.08, 0.25) * (Math.random() < 0.5 ? -1 : 1),
      bob: rand(0.25, 0.5),
      amp: rand(0.8, 1.8),
      phase: rand(0, Math.PI * 2),
    };
    group.rotation.y = rand(0, Math.PI * 2);
    scene.add(group);
    return group;
  });

  // Map each piece's grid spot onto the visible area at its depth, above the floor.
  // Narrow (portrait) screens get smaller pieces so they don't fill the width.
  function layout() {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fit = Math.min(1, 0.35 + camera.aspect * 0.55);
    for (const p of pieces) {
      const d = p.userData;
      p.scale.setScalar(d.size * fit);
      const halfH = d.dist * tan;
      const halfW = halfH * camera.aspect;
      const yMin = Math.max(-halfH, FLOOR_Y + 5 * p.scale.y);
      d.x = (d.u * 2 - 1) * halfW * 0.95;
      d.y = yMin + d.v * (halfH * 0.95 - yMin);
      p.position.set(d.x, d.y, CAMERA_Z - d.dist);
    }
  }

  function applyTheme() {
    mats.ink.color.set(token('--ink'));
    mats.green.color.set(token('--sq-dark'));
    mats.line.color.set(token('--brass'));
    scene.fog.color.set(token('--paper'));
    const ctx = checker.getContext('2d');
    ctx.clearRect(0, 0, 2, 2);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = token('--sq-dark');
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(1, 1, 1, 1);
    floorMap.needsUpdate = true;
  }

  const pointer = { x: 0, y: 0 };
  const eye = { x: 0, y: 0 };
  let last = 0;

  function update(t) {
    const dt = Math.min(t - last, 0.05);
    last = t;
    eye.x += (pointer.x * 3 - eye.x) * 0.04;
    eye.y += (pointer.y * 2 - eye.y) * 0.04;
    const scroll = Math.min(scrollY * 0.005, 8);
    camera.position.set(eye.x, eye.y - scroll, CAMERA_Z);
    camera.lookAt(0, -scroll, 0);

    for (const p of pieces) {
      const d = p.userData;
      p.rotation.y += d.spin * dt;
      p.rotation.x = d.tiltX + Math.sin(t * d.bob + d.phase) * 0.15;
      p.rotation.z = d.tiltZ + Math.cos(t * d.bob + d.phase) * 0.15;
      p.position.y = d.y + Math.sin(t * d.bob * 1.3 + d.phase) * d.amp;
    }
    floorMap.offset.y = (t * 0.02) % 1;
  }

  const still = () => { update(last); renderer.render(scene, camera); };

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    layout();
    if (reducedMotion.matches) still();
  }

  function retheme() {
    applyTheme();
    if (reducedMotion.matches) still();
  }

  function setMotion() {
    renderer.setAnimationLoop(reducedMotion.matches ? null : (ms) => { update(ms / 1000); renderer.render(scene, camera); });
    if (reducedMotion.matches) still();
  }

  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  }, { passive: true });
  darkScheme.addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  reducedMotion.addEventListener('change', setMotion);

  applyTheme();
  resize();
  setMotion();
}

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
} catch {
  canvas.remove(); // no WebGL: the plain page background is fine
}
if (renderer) start(renderer);
