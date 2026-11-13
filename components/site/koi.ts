// The crystal-glass koi (spec section 11): a GLB loaded with Three.js, bent by a swim wave in the vertex shader,
// placed by scroll between six section poses. Loaded only in the browser (dynamic import from SiteEffects).
// Returns a cleanup that stops the loop, removes listeners and releases the WebGL context.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { easeInOutCubic, pointer } from "./pointer";

const GLB = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261104_151843_47d87652-1c40-465c-b0d6-cd94c22a9d3e.glb";

interface Pose { x: number; y: number; s: number; yaw: number; pitch: number; roll: number }
const POSES: Record<string, Pose> = {
  hero: { x: 0.02, y: 0.16, s: 0.72, yaw: 0.18, pitch: -0.92, roll: 0.05 },
  statement: { x: -0.66, y: -0.6, s: 0.42, yaw: 0.5, pitch: 0.2, roll: -0.1 },
  dash: { x: 0.5, y: -0.5, s: 0.46, yaw: -0.35, pitch: 0.32, roll: 0.1 },
  packs: { x: 0.4, y: -0.78, s: 0.5, yaw: 0.55, pitch: -0.05, roll: 0.08 },
  uses: { x: -0.42, y: -0.42, s: 0.6, yaw: 3.0, pitch: 0.12, roll: -0.06 },
  end: { x: -0.7, y: 0.56, s: 0.48, yaw: 0.3, pitch: -0.14, roll: 0.05 },
};
const PHONE: Record<string, [number, number, number]> = {
  hero: [0.12, 0.38, 0.46],
  statement: [0.42, -0.72, 0.3],
  dash: [-0.35, -0.74, 0.3],
  packs: [0.38, -0.74, 0.3],
  uses: [-0.3, -0.76, 0.32],
  end: [0.3, -0.74, 0.32],
};
const KEYS = Object.keys(POSES);
const KEYS_N = ["x", "y", "s", "yaw", "pitch", "roll"] as const;

export function startKoi(canvas: HTMLCanvasElement, reduced: boolean): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.add(new THREE.HemisphereLight(0xc6b2ff, 0x2a1c80, 0.7));
  const key = new THREE.DirectionalLight(0xffc8f0, 1.6);
  key.position.set(3, 5, 6);
  const rim = new THREE.DirectionalLight(0x8c7bff, 2.8);
  rim.position.set(-5, -1, -4);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 10);
  const fh = 2 * Math.tan((15 * Math.PI) / 180) * 10;

  const rig = new THREE.Group();
  const body = new THREE.Group();
  rig.add(body);
  rig.rotation.order = "XYZ";
  scene.add(rig);

  const uniforms = { uTime: { value: 0 }, uFreq: { value: 5.2 }, uSpeed: { value: 6.5 }, uAmp: { value: 0.075 } };
  const disposables: { dispose: () => void }[] = [];

  // ---- scroll anchors ----
  let anchors: number[] = [0, 0, 0, 0, 0, 0];
  const top = (id: string) => {
    const el = document.getElementById(id);
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  };
  const measure = () => {
    const h = window.innerHeight;
    const dash = document.getElementById("dash");
    const dashMid = dash ? top("dash") + dash.offsetHeight / 2 - 0.5 * h : 0;
    const maxScroll = document.documentElement.scrollHeight - h;
    anchors = [0, top("studio") + 0.2 * h, dashMid, top("packs") + 0.3 * h, top("uses") + 0.3 * h, Math.min(top("end"), maxScroll)];
  };
  const poseAt = (y: number): Pose => {
    const phone = window.innerWidth <= 820;
    const get = (k: string): Pose => {
      const p = { ...POSES[k] };
      if (phone) [p.x, p.y, p.s] = PHONE[k];
      return p;
    };
    if (y <= anchors[0]) return get(KEYS[0]);
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (y < b) {
        const t = easeInOutCubic(b > a ? (y - a) / (b - a) : 1);
        const p = get(KEYS[i]), q = get(KEYS[i + 1]);
        const out = { ...p };
        for (const n of KEYS_N) out[n] = p[n] + (q[n] - p[n]) * t;
        return out;
      }
    }
    return get(KEYS[KEYS.length - 1]);
  };

  measure();
  const cur: Pose = poseAt(window.scrollY);
  let vel = 0;
  let lastY = window.scrollY;
  let needsDraw = true;

  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    measure();
    needsDraw = true;
  };
  const onScroll = () => { needsDraw = true; };
  window.addEventListener("resize", onResize);
  window.addEventListener("load", measure);
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---- model ----
  let disposed = false;
  new GLTFLoader().load(
    GLB,
    (gltf) => {
      if (disposed) return;
      let mesh: THREE.Mesh | null = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) return;
      const m = mesh as THREE.Mesh;
      const geo = (m.geometry as THREE.BufferGeometry).clone();
      geo.applyMatrix4(m.matrixWorld);
      geo.computeBoundingBox();
      let size = new THREE.Vector3();
      geo.boundingBox!.getSize(size);
      if (size.z >= size.x && size.z >= size.y) geo.rotateY(Math.PI / 2);
      else if (size.y >= size.x && size.y >= size.z) geo.rotateZ(-Math.PI / 2);
      geo.rotateY(Math.PI);
      geo.computeBoundingBox();
      const c = new THREE.Vector3();
      geo.boundingBox!.getCenter(c);
      geo.translate(-c.x, -c.y, -c.z);
      size = new THREE.Vector3();
      geo.boundingBox!.getSize(size);
      const len = Math.max(size.x, size.y, size.z) || 1;
      geo.scale(1 / len, 1 / len, 1 / len);
      geo.computeVertexNormals();

      const old = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const map = old && "map" in old ? old.map : null;
      const mat = new THREE.MeshPhysicalMaterial({
        color: map ? 0xc9b4ff : 0xb8a4ff,
        map,
        emissiveMap: map,
        roughness: 0.18,
        metalness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        iridescence: 0.85,
        iridescenceIOR: 1.4,
        iridescenceThicknessRange: [260, 700],
        emissive: 0x7a46ff,
        emissiveIntensity: 0.55,
        sheen: 0.25,
        sheenColor: 0xff9ce6,
        transparent: true,
        opacity: 0.95,
        envMapIntensity: 0.75,
        side: THREE.DoubleSide,
      });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uFreq;\nuniform float uSpeed;\nuniform float uAmp;")
          .replace(
            "#include <begin_vertex>",
            [
              "vec3 transformed = vec3( position );",
              "float tail = clamp((0.32 - transformed.x) / 0.82, 0.0, 1.0);",
              "transformed.z += sin(transformed.x * uFreq - uTime * uSpeed) * uAmp * (0.15 + 1.6 * tail * tail);",
              "transformed.y += cos(transformed.x * uFreq * 0.5 - uTime * uSpeed * 0.5) * uAmp * 0.12 * tail;",
            ].join("\n"),
          );
      };
      const fish = new THREE.Mesh(geo, mat);
      body.add(fish);
      disposables.push(geo, mat);
      if (map) disposables.push(map);
      gltf.scene.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh && mm !== m) mm.geometry.dispose();
      });
      m.geometry.dispose();
      needsDraw = true;
    },
    undefined,
    () => {
      /* model failed to load: the page works without the fish */
    },
  );

  // ---- loop ----
  const t0 = performance.now();
  let last = t0;
  let raf = 0;
  let camRX = 0, camRY = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (now - t0) / 1000;
    const y = window.scrollY;
    const instant = dt > 0 ? (y - lastY) / dt : 0;
    lastY = y;
    vel += (instant - vel) * 0.1;
    if (reduced && !needsDraw) return;
    needsDraw = false;

    const target = poseAt(y);
    const k = reduced ? 1 : 1 - Math.exp(-3.2 * dt);
    for (const n of KEYS_N) cur[n] += (target[n] - cur[n]) * k;

    if (!reduced) {
      const speedUp = Math.min(Math.abs(vel) / 1800, 1.4);
      uniforms.uTime.value += dt * (1 + speedUp);
      uniforms.uAmp.value = 0.07 + 0.03 * speedUp;
    }
    const fw = fh * camera.aspect;
    const bob = reduced ? 0 : Math.sin(0.9 * t) * 0.018;
    rig.position.set((cur.x * fw) / 2, ((cur.y + bob) * fh) / 2, 0);
    rig.rotation.set(cur.roll + (reduced ? 0 : Math.sin(0.7 * t) * 0.04), cur.yaw + (reduced ? 0 : Math.sin(0.5 * t) * 0.06), cur.pitch);
    body.scale.setScalar(cur.s * fh);

    if (!reduced) {
      const kc = 1 - Math.exp(-dt / 0.1);
      camRY += (-pointer.tx * 0.01745 - camRY) * kc;
      camRX += (pointer.ty * 0.01745 - camRX) * kc;
      camera.rotation.set(camRX, camRY, 0);
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("load", measure);
    window.removeEventListener("scroll", onScroll);
    disposables.forEach((d) => d.dispose());
    envRT.dispose();
    pmrem.dispose();
    room.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
