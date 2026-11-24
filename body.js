// Stylised 3D body built from primitives (no third-party models), used for the
// training heatmap and the soreness map. Requires three.min.js (MIT) loaded first.
(function (root) {
  'use strict';
  const THREE = root.THREE;
  let inst = null;

  const BASE = 0x2a2f38;
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
        fetch('model/body.json').then((r) => { if (!r.ok) throw new Error('model json'); return r.json(); }),
        fetch('model/body.bin').then((r) => { if (!r.ok) throw new Error('model bin'); return r.arrayBuffer(); }),
      ]).then(([meta, buf]) => {
        const group = new THREE.Group();
        const meshes = [];
        for (const g of meta.groups) {
          const geom = new THREE.BufferGeometry();
          const pos = new Float32Array(buf, g.vStart * 12, g.vCount * 3);
          const idx = new Uint32Array(buf, meta.vertexBytes + g.iStart * 4, g.iCount);
          geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geom.setIndex(new THREE.BufferAttribute(idx, 1));
          geom.computeVertexNormals();
          const isOther = g.region === 'other';
          const base = isOther ? 0x6b4a45 : BASE;
          const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: base, roughness: 0.55, metalness: 0.02 }));
          mesh.userData.region = isOther ? null : g.region;
          mesh.userData.base = base;
          group.add(mesh);
          if (!isOther) meshes.push(mesh);
        }
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
    if (!region) return opts.baseFor ? opts.baseFor : BASE;
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
    camera.position.set(0, 0.95, 4.2);
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

    canvas.addEventListener('pointerdown', (e) => {
      state.down = { x: e.clientX, y: e.clientY };
      state.moved = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!state.down) return;
      const dx = e.clientX - state.down.x;
      state.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      fig.group.rotation.y += e.movementX * 0.01;
      state.down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasTap = state.down && state.moved < 6;
      state.down = null;
      if (!wasTap || !state.opts) return;
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(fig.meshes, false)[0];
      if (hit && hit.object.userData.region && state.opts.onTap) state.opts.onTap(hit.object.userData.region);
    });

    function paint(opts) {
      for (const m of fig.meshes) m.material.color.setHex(colorFor(m.userData.region, opts));
      for (const m of fig.allMeshes || []) if (!m.userData.region) m.material.color.setHex(m.userData.base);
    }

    let raf = null;
    function loop() {
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
