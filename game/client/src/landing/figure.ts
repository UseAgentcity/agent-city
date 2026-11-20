// The landing page's mascot: the same designer-toy figure the visitor plays in the city, rendered live on the
// poster. It idles, blinks, waves now and then and turns toward the pointer. One small WebGL canvas, stopped
// and released as soon as the landing page goes away.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { makeRobot } from '../robot.ts';

export function mountFigure(host: HTMLElement, gone: () => boolean): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    host.classList.add('off');
    return () => {};
  }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight(0xfff0c2, 1.6);
  rim.position.set(-3, 2.5, -2.5);
  scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0xf0b90b, 0.5));

  const robot = makeRobot();
  scene.add(robot.root);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0.9, 3.7);
  camera.lookAt(0, 0.74, 0);

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole figure in frame on a narrow stage.
    camera.fov = w / h < 0.75 ? 30 : 26;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Turn a little toward the pointer.
  let aim = 0;
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    aim = THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / innerWidth, -0.5, 0.5) * 1.4;
  };
  addEventListener('pointermove', onMove, { passive: true });

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, last = performance.now(), t = 0, nextWave = 1.2, yaw = -0.3, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    removeEventListener('pointermove', onMove);
    scene.remove(robot.root);
    robot.dispose();
    env.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  const frame = (now: number) => {
    if (gone() || !host.isConnected) { stop(); return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (!still && t > nextWave) { robot.play('wave'); nextWave = t + 6 + Math.random() * 3; }
    yaw = THREE.MathUtils.damp(yaw, -0.3 + aim + (still ? 0 : 0.12 * Math.sin(t * 0.6)), 3, dt);
    robot.root.rotation.y = yaw;
    robot.update(still ? 0 : dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
