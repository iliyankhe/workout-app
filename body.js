// Stylised 3D body built from primitives (no third-party models), used for the
// training heatmap and the soreness map. Requires three.min.js (MIT) loaded first.
(function (root) {
  'use strict';
  const THREE = root.THREE;
  let inst = null;

  const BASE = 0x7d7d95; // muscle colour for unhighlighted body
  const SEAM = 0x2c2c3c; // dark lines between muscle groups
  const SKIN = 0x464658; // head, hands, feet and joints (darker)
  const HEAT = new THREE.Color(0xef6461);
  const SORE_COLORS = [null, 0xf0b429, 0xf0893b, 0xef4444];

  // Parts: region name (or null for plain body), geometry kind, and placement.
  // Coordinates: y up, z toward the viewer, body about 1.8 units tall.
  const PARTS = [
    // Plain body
    { r: null, k: 'sphere', p: [0, 1.62, 0], s: [0.11, 0.13, 0.11] },
    { r: null, k: 'box', p: [0, 1.2, 0], s: [0.3, 0.36, 0.16] },
    { r: null, k: 'box', p: [0, 0.9, 0], s: [0.3, 0.14, 0.16] },
    // Neck
    { r: 'neck', k: 'cyl', a: [0, 1.5, 0], b: [0, 1.46, 0], rad: 0.05 },
    // Front
    { r: 'chest', k: 'sphere', p: [-0.09, 1.3, 0.1], s: [0.13, 0.11, 0.08] },
    { r: 'chest', k: 'sphere', p: [0.09, 1.3, 0.1], s: [0.13, 0.11, 0.08] },
    { r: 'abs', k: 'box', p: [0, 1.06, 0.1], s: [0.16, 0.22, 0.05] },
    { r: 'shoulders', k: 'sphere', p: [-0.22, 1.37, 0], s: [0.07, 0.07, 0.07] },
    { r: 'shoulders', k: 'sphere', p: [0.22, 1.37, 0], s: [0.07, 0.07, 0.07] },
    { r: 'biceps', k: 'cyl', a: [-0.24, 1.34, 0.04], b: [-0.28, 1.1, 0.04], rad: 0.045 },
    { r: 'biceps', k: 'cyl', a: [0.24, 1.34, 0.04], b: [0.28, 1.1, 0.04], rad: 0.045 },
    { r: 'forearms', k: 'cyl', a: [-0.28, 1.08, 0.03], b: [-0.31, 0.8, 0.03], rad: 0.04 },
    { r: 'forearms', k: 'cyl', a: [0.28, 1.08, 0.03], b: [0.31, 0.8, 0.03], rad: 0.04 },
    { r: 'quads', k: 'cyl', a: [-0.1, 0.9, 0.05], b: [-0.1, 0.48, 0.05], rad: 0.1 },
    { r: 'quads', k: 'cyl', a: [0.1, 0.9, 0.05], b: [0.1, 0.48, 0.05], rad: 0.1 },
    { r: 'adductors', k: 'cyl', a: [-0.04, 0.85, 0.0], b: [-0.04, 0.5, 0.0], rad: 0.05 },
    { r: 'adductors', k: 'cyl', a: [0.04, 0.85, 0.0], b: [0.04, 0.5, 0.0], rad: 0.05 },
    { r: 'calves', k: 'cyl', a: [-0.1, 0.44, 0], b: [-0.1, 0.06, 0], rad: 0.065 },
    { r: 'calves', k: 'cyl', a: [0.1, 0.44, 0], b: [0.1, 0.06, 0], rad: 0.065 },
    // Back
    { r: 'upper_back', k: 'box', p: [0, 1.32, -0.1], s: [0.3, 0.26, 0.05] },
    { r: 'lats', k: 'sphere', p: [-0.17, 1.2, -0.08], s: [0.07, 0.16, 0.07] },
    { r: 'lats', k: 'sphere', p: [0.17, 1.2, -0.08], s: [0.07, 0.16, 0.07] },
    { r: 'triceps', k: 'cyl', a: [-0.24, 1.34, -0.04], b: [-0.28, 1.1, -0.04], rad: 0.045 },
    { r: 'triceps', k: 'cyl', a: [0.24, 1.34, -0.04], b: [0.28, 1.1, -0.04], rad: 0.045 },
    { r: 'lower_back', k: 'box', p: [0, 1.0, -0.09], s: [0.2, 0.14, 0.05] },
    { r: 'glutes', k: 'sphere', p: [-0.1, 0.88, -0.09], s: [0.11, 0.1, 0.1] },
    { r: 'glutes', k: 'sphere', p: [0.1, 0.88, -0.09], s: [0.11, 0.1, 0.1] },
    { r: 'hamstrings', k: 'cyl', a: [-0.1, 0.8, -0.07], b: [-0.1, 0.48, -0.07], rad: 0.09 },
    { r: 'hamstrings', k: 'cyl', a: [0.1, 0.8, -0.07], b: [0.1, 0.48, -0.07], rad: 0.09 },
    { r: 'calves', k: 'cyl', a: [-0.1, 0.4, -0.06], b: [-0.1, 0.1, -0.06], rad: 0.06 },
    { r: 'calves', k: 'cyl', a: [0.1, 0.4, -0.06], b: [0.1, 0.1, -0.06], rad: 0.06 },
  ];

  // Real muscle model (Z-Anatomy, CC BY-SA 4.0). Falls back to the simple figure if it fails to load.
  let modelPromise = null;
  function loadModel() {
    if (!modelPromise) {
      modelPromise = Promise.all([
        fetch('model/body.json?v=19').then((r) => { if (!r.ok) throw new Error('model json'); return r.json(); }),
        fetch('model/body.bin?v=19').then((r) => { if (!r.ok) throw new Error('model bin'); return r.arrayBuffer(); }),
        fetch('model/seams.bin?v=19').then((r) => { if (!r.ok) throw new Error('model seams'); return r.arrayBuffer(); }),
      ]).then(([meta, buf, seamBuf]) => {
        if (meta.format !== 'v4') throw new Error('model format');
        const total = meta.totalVertices;
        const positions = new Float32Array(buf, 0, total * 3);
        const normals = new Float32Array(buf, meta.normalsOffset, total * 3);
        const shade = new Float32Array(buf, meta.shadeOffset, total);
        const group = new THREE.Group();
        const meshes = [];
        for (const g of meta.groups) {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.BufferAttribute(positions.subarray(g.vStart * 3, (g.vStart + g.vCount) * 3), 3));
          geom.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(g.vStart * 3, (g.vStart + g.vCount) * 3), 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, meta.indexOffset + g.iStart * 4, g.iCount), 1));
          const unmapped = g.region === 'skin' || g.region === 'other';
          const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
            color: unmapped ? SKIN : BASE, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          }));
          mesh.userData.region = unmapped ? null : g.region;
          mesh.userData.base = unmapped ? SKIN : BASE;
          group.add(mesh);
          if (!unmapped) meshes.push(mesh);
        }
        // Dark seam lines where two muscle groups meet
        const seamPos = new Float32Array(seamBuf, 0, meta.seamSegments * 6);
        const seamGeom = new THREE.BufferGeometry();
        seamGeom.setAttribute('position', new THREE.BufferAttribute(seamPos, 3));
        const seams = new THREE.LineSegments(seamGeom, new THREE.LineBasicMaterial({ color: SEAM }));
        group.add(seams);
        return { group, meshes, source: 'model' };
      });
    }
    return modelPromise;
  }

  function buildFigure() {
    const group = new THREE.Group();
    const meshes = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const part of PARTS) {
      let geom;
      let mesh;
      if (part.k === 'cyl') {
        const a = new THREE.Vector3(...part.a);
        const b = new THREE.Vector3(...part.b);
        const len = a.distanceTo(b);
        geom = new THREE.CylinderGeometry(part.rad, part.rad, len, 14);
        mesh = new THREE.Mesh(geom);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      } else if (part.k === 'sphere') {
        geom = new THREE.SphereGeometry(1, 18, 14);
        mesh = new THREE.Mesh(geom);
        mesh.position.set(...part.p);
        mesh.scale.set(...part.s);
      } else {
        geom = new THREE.BoxGeometry(1, 1, 1);
        mesh = new THREE.Mesh(geom);
        mesh.position.set(...part.p);
        mesh.scale.set(...part.s);
      }
      mesh.material = new THREE.MeshStandardMaterial({ color: BASE, roughness: 0.6, metalness: 0.05 });
      mesh.userData.region = part.r;
      mesh.userData.base = BASE;
      group.add(mesh);
      if (part.r) meshes.push(mesh);
    }
    return { group, meshes };
  }

  function colorFor(region, opts) {
    if (!region) return SKIN;
    if (opts.mode === 'heat') {
      const max = Math.max(1, ...Object.values(opts.load));
      const v = opts.load[region] || 0;
      if (!v) return BASE;
      const t = 0.2 + 0.8 * (v / max);
      return new THREE.Color(BASE).lerp(HEAT, t).getHex();
    }
    const s = opts.sore[region];
    if (!s || !s.level) return BASE;
    return SORE_COLORS[Math.min(3, s.level)];
  }

  function ensure(container) {
    if (inst) {
      if (inst.renderer.domElement.parentNode !== container) container.appendChild(inst.renderer.domElement);
      inst.resize();
      return inst;
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.9, 4.2);
    camera.lookAt(0, 0.9, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fig = { group: new THREE.Group(), meshes: [], allMeshes: [] };
    scene.add(fig.group);
    const attach = (part) => {
      fig.group.add(part.group);
      fig.meshes = part.meshes;
      fig.allMeshes = part.group.children;
      if (inst && inst.state.opts) inst.paint(inst.state.opts);
    };
    loadModel().then(attach).catch(() => attach(buildFigure()));

    const state = { opts: null, down: null, moved: 0 };
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function resize() {
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 440;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    // Drag to turn: horizontal drag spins through a full 360 degrees; vertical drag tilts (about +/-70 degrees).
    const view = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
    const PITCH_MAX = 0.6;
    const ORBIT_R = 4.2;
    const TARGET_Y = 0.9;
    function applyRotation() {
      fig.group.rotation.set(0, view.yaw, 0);
      const elev = Math.max(-0.6, Math.min(0.6, view.pitch));
      camera.position.set(0, TARGET_Y + ORBIT_R * Math.sin(elev), ORBIT_R * Math.cos(elev));
      camera.lookAt(0, TARGET_Y, 0);
    }
    let last = null;
    let lastT = 0;
    canvas.addEventListener('pointerdown', (e) => {
      state.down = { x: e.clientX, y: e.clientY };
      state.moved = 0;
      last = { x: e.clientX, y: e.clientY };
      lastT = performance.now();
      view.vyaw = 0; view.vpitch = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!state.down) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      state.moved += Math.abs(dx) + Math.abs(dy);
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      view.yaw += dx * 0.012;
      view.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, view.pitch + dy * 0.008));
      // Track speed so the figure keeps turning briefly after you let go.
      view.vyaw = (dx * 0.012) / dt * 16;
      view.vpitch = (dy * 0.008) / dt * 16;
      last = { x: e.clientX, y: e.clientY };
      lastT = now;
      applyRotation();
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasTap = state.down && state.moved < 6;
      state.down = null;
      if (!wasTap) return;
      if (!state.opts) return;
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(fig.meshes, false)[0];
      // Anything that is not a muscle (empty space, skin, joints) is reported as null, so the app can clear its choice.
      const region = hit && hit.object.userData.region !== 'skin' ? hit.object.userData.region : null;
      if (state.opts.onTap) state.opts.onTap(region || null, e.clientX - rect.left, e.clientY - rect.top);
    });
    canvas.addEventListener('pointercancel', () => { state.down = null; });

    // Every mode is flat: muscles in the base colour, or in the region colour for Training and Soreness.
    function paint(opts) {
      for (const m of fig.allMeshes || []) {
        m.material.color.setHex(m.userData.region ? colorFor(m.userData.region, opts) : SKIN);
      }
    }

    let raf = null;
    function loop() {
      if (!state.down && (Math.abs(view.vyaw) > 0.0005 || Math.abs(view.vpitch) > 0.0005)) {
        view.yaw += view.vyaw;
        view.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, view.pitch + view.vpitch));
        view.vyaw *= 0.92; view.vpitch *= 0.88;
        applyRotation();
      }
      renderer.render(scene, camera);
      raf = root.requestAnimationFrame(loop);
    }
    loop();

    inst = { renderer, paint, resize, state, scene, camera, raf: () => raf };
    inst.resize();
    return inst;
  }

  function render(container, opts) {
    const b = ensure(container);
    b.state.opts = opts;
    b.paint(opts);
  }

  root.BodyMap = { render };
})(typeof self !== 'undefined' ? self : globalThis);
