"use client";

// 3D view of the live map: the SLAM/AMCL occupancy grid as a floor with extruded walls, the
// lidar scan at sensor height, the Nav2 path, stations, and a to-scale model of Nova built
// from the URDF dimensions (lib/robotModel.ts). ROS axes: x/y on the floor, z up.
// Drag to orbit, right-drag/two fingers to pan, wheel/pinch to zoom. Loaded on demand
// (next/dynamic) so the 2D pages don't carry three.js.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MapData, RobotState, Station } from "@/lib/types";
import { ROBOT, WHEEL_R } from "@/lib/robotModel";
import { useRobot } from "./RobotProvider";

type Props = { follow: boolean; layers: { scan: boolean; plan: boolean; stations: boolean; grid: boolean }; fitSignal: number; className?: string };

const WALL_H = 0.3;
const MAX_WALLS = 80000;
const COL = {
  bg: 0x0b1120, free: [38, 48, 66], unknown: [17, 23, 36], wall: 0x8ea3c0, scan: 0xfb7185, plan: 0x22d3ee,
  station: 0xa78bfa, body: 0xcbd5e1, accent: 0x34d399, estop: 0xf43f5e, tyre: 0x0f172a, metal: 0x94a3b8,
};

export default function Map3D({ follow, layers, fitSignal, className = "" }: Props) {
  const { state: S, map, stations } = useRobot();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<ReturnType<typeof createScene> | null>(null);
  const live = useRef({ follow, layers });
  useEffect(() => { live.current = { follow, layers }; });

  useEffect(() => {
    const el = host.current!;
    const scene = createScene(el, () => live.current);
    api.current = scene;
    return () => { scene.dispose(); api.current = null; };
  }, []);

  useEffect(() => { if (map) api.current?.setMap(map); }, [map]);
  useEffect(() => { api.current?.setState(S); }, [S]);
  useEffect(() => { api.current?.setStations(stations); }, [stations]);
  useEffect(() => { if (fitSignal) api.current?.fit(); }, [fitSignal]);

  return (
    <div ref={host} className={"relative min-h-0 touch-none overflow-hidden " + className}>
      <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-slate-500">
        drag: orbit · right-drag: pan · wheel: zoom
      </div>
    </div>
  );
}

function createScene(el: HTMLDivElement, opts: () => { follow: boolean; layers: Props["layers"] }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  el.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.bg);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 500);
  camera.up.set(0, 0, 1);
  camera.position.set(-2.5, -2.5, 2.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the floor
  controls.minDistance = 0.3;
  controls.maxDistance = 120;

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0b1120, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 20 });
  scene.add(sun, sun.target);

  // ---- map: floor texture + instanced wall blocks ----
  const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.receiveShadow = true;
  floor.visible = false;
  scene.add(floor);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({ color: COL.wall, roughness: 0.7 });
  let walls: THREE.InstancedMesh | null = null;
  const grid = new THREE.GridHelper(40, 40, 0x334155, 0x1e293b);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0.001;
  scene.add(grid);
  let mapBox: THREE.Box3 | null = null;
  let fitted = false;

  const setMap = (m: MapData) => {
    const raw = atob(m.data), W = m.width, H = m.height, res = m.resolution;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!, im = ctx.createImageData(W, H);
    const occ: number[] = [];
    for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
      const v = raw.charCodeAt(row * W + col), o = ((H - 1 - row) * W + col) * 4;
      const c = v === 255 ? COL.unknown : v >= 65 ? COL.unknown : COL.free;
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
      if (v !== 255 && v >= 65) occ.push(col, row);
    }
    ctx.putImageData(im, 0, 0);
    floorMat.map?.dispose();
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    floorMat.map = tex;
    floorMat.needsUpdate = true;
    const [ox, oy, oyaw] = m.origin;
    // the grid's origin is its bottom-left cell corner (origin yaw is 0 for slam_toolbox/map_server)
    floor.scale.set(W * res, H * res, 1);
    floor.position.set(ox + (W * res) / 2, oy + (H * res) / 2, 0);
    floor.visible = true;

    if (walls) { scene.remove(walls); walls.dispose(); }
    const n = Math.min(occ.length / 2, MAX_WALLS);
    walls = new THREE.InstancedMesh(wallGeo, wallMat, n);
    walls.castShadow = walls.receiveShadow = true;
    const mtx = new THREE.Matrix4(), cos = Math.cos(oyaw), sin = Math.sin(oyaw);
    for (let i = 0; i < n; i++) {
      const lx = (occ[2 * i] + 0.5) * res, ly = (occ[2 * i + 1] + 0.5) * res;
      mtx.makeScale(res, res, WALL_H);
      mtx.setPosition(ox + lx * cos - ly * sin, oy + lx * sin + ly * cos, WALL_H / 2);
      walls.setMatrixAt(i, mtx);
    }
    walls.instanceMatrix.needsUpdate = true;
    scene.add(walls);
    mapBox = new THREE.Box3(new THREE.Vector3(ox, oy, 0), new THREE.Vector3(ox + W * res, oy + H * res, WALL_H));
    if (!fitted) fit();
  };

  // ---- robot model (base_link frame, lifted so the wheels touch the floor) ----
  const robot = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: COL.body, roughness: 0.45, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: COL.accent, emissive: COL.accent, emissiveIntensity: 0.35 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: COL.tyre, roughness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: COL.metal, roughness: 0.3, metalness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z + WHEEL_R);
    m.rotation.x = rx;
    m.castShadow = true;
    robot.add(m);
    return m;
  };
  const { chassis: ch, wheel: wh, caster, lidar } = ROBOT;
  const len = ch.x1 - ch.x0, cx = (ch.x0 + ch.x1) / 2;
  add(new THREE.BoxGeometry(len, 2 * ch.halfW, ch.h), bodyMat, cx, 0, ch.z0 + ch.h / 2);
  // accent stripe around the body + top plate
  add(new THREE.BoxGeometry(len + 0.004, 2 * ch.halfW + 0.004, 0.012), accentMat, cx, 0, ch.z0 + ch.h * 0.62);
  add(new THREE.BoxGeometry(len - 0.02, 2 * ch.halfW - 0.02, 0.006), darkMat, cx, 0, ch.z0 + ch.h + 0.003);
  // front "face" panel with two eyes
  add(new THREE.BoxGeometry(0.004, 2 * ch.halfW * 0.7, ch.h * 0.45), darkMat, ch.x1 + 0.002, 0, ch.z0 + ch.h * 0.4);
  for (const sgn of [1, -1]) add(new THREE.SphereGeometry(0.012, 16, 12), accentMat, ch.x1 + 0.004, sgn * 0.045, ch.z0 + ch.h * 0.42);
  // drive wheels (cylinder axis along y) with hubs
  for (const sgn of [1, -1]) {
    add(new THREE.CylinderGeometry(wh.r, wh.r, wh.w, 28), tyreMat, wh.x, sgn * wh.y, 0);
    add(new THREE.CylinderGeometry(wh.r * 0.45, wh.r * 0.45, wh.w + 0.004, 16), metalMat, wh.x, sgn * wh.y, 0);
  }
  add(new THREE.SphereGeometry(caster.r, 12, 10), metalMat, caster.x, 0, -WHEEL_R + caster.r);
  // lidar: post + puck + spinning head
  const lidarTop = lidar.z + lidar.h / 2;
  add(new THREE.CylinderGeometry(0.012, 0.012, lidar.z - ch.z0 - ch.h, 12), metalMat, lidar.x, 0, (ch.z0 + ch.h + lidar.z) / 2, Math.PI / 2);
  add(new THREE.CylinderGeometry(lidar.r, lidar.r, lidar.h, 32), darkMat, lidar.x, 0, lidar.z, Math.PI / 2);
  const head = new THREE.Group();
  head.position.set(lidar.x, 0, lidarTop + WHEEL_R + 0.004);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(lidar.r * 0.8, lidar.r * 0.8, 0.008, 32), metalMat);
  cap.rotation.x = Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(lidar.r * 0.6, 0.008, 0.006),
    new THREE.MeshBasicMaterial({ color: COL.scan }));
  beam.position.set(lidar.r * 0.4, 0, 0.006);
  head.add(cap, beam);
  robot.add(head);
  // heading arrow on the floor
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0.06, 0); arrowShape.lineTo(-0.02, 0.045); arrowShape.lineTo(0, 0); arrowShape.lineTo(-0.02, -0.045); arrowShape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: COL.accent, transparent: true, opacity: 0.8 }));
  arrow.position.set(ch.x1 + 0.08, 0, 0.003);
  robot.add(arrow);
  // footprint glow under the robot
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.1, 2 * ch.halfW + 0.12),
    new THREE.MeshBasicMaterial({ color: COL.accent, transparent: true, opacity: 0.18, depthWrite: false }));
  glow.position.set(cx, 0, 0.002);
  robot.add(glow);
  robot.visible = false;
  scene.add(robot);
  sun.target = robot;

  // ---- lidar points, path, goal, stations ----
  const scanGeo = new THREE.BufferGeometry();
  const scan = new THREE.Points(scanGeo, new THREE.PointsMaterial({ color: COL.scan, size: 0.035, sizeAttenuation: true }));
  scene.add(scan);
  const planGeo = new THREE.BufferGeometry();
  const plan = new THREE.Line(planGeo, new THREE.LineBasicMaterial({ color: COL.plan }));
  scene.add(plan);
  const goal = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.12, 32), new THREE.MeshBasicMaterial({ color: COL.plan, side: THREE.DoubleSide }));
  goal.visible = false;
  scene.add(goal);
  const stationGroup = new THREE.Group();
  scene.add(stationGroup);

  const target = { x: 0, y: 0, yaw: 0, have: false };
  let estop = false;

  const setState = (s: RobotState | null) => {
    const L = opts().layers;
    if (s?.pose) {
      if (!target.have) { robot.position.set(s.pose.x, s.pose.y, 0); robot.rotation.z = s.pose.yaw; }
      Object.assign(target, { x: s.pose.x, y: s.pose.y, yaw: s.pose.yaw, have: true });
      robot.visible = true;
    }
    if (!!s?.estop !== estop) {
      estop = !!s?.estop;
      const c = estop ? COL.estop : COL.accent;
      accentMat.color.setHex(c); accentMat.emissive.setHex(c);
      (arrow.material as THREE.MeshBasicMaterial).color.setHex(c);
      (glow.material as THREE.MeshBasicMaterial).color.setHex(c);
    }
    const sz = lidar.z + WHEEL_R;
    if (s && L.scan && s.scan.length) {
      const a = new Float32Array((s.scan.length / 2) * 3);
      for (let i = 0, j = 0; i < s.scan.length; i += 2, j += 3) { a[j] = s.scan[i]; a[j + 1] = s.scan[i + 1]; a[j + 2] = sz; }
      scanGeo.setAttribute("position", new THREE.BufferAttribute(a, 3));
      scanGeo.computeBoundingSphere();
      scan.visible = true;
    } else scan.visible = false;
    if (s && L.plan && s.plan.length > 3) {
      const a = new Float32Array((s.plan.length / 2) * 3);
      for (let i = 0, j = 0; i < s.plan.length; i += 2, j += 3) { a[j] = s.plan[i]; a[j + 1] = s.plan[i + 1]; a[j + 2] = 0.01; }
      planGeo.setAttribute("position", new THREE.BufferAttribute(a, 3));
      planGeo.computeBoundingSphere();
      plan.visible = true;
    } else plan.visible = false;
    const t = s?.nav.target;
    goal.visible = !!(s && t && t.x !== null && t.y !== null && ["sending", "navigating"].includes(s.nav.state));
    if (goal.visible && t) goal.position.set(t.x!, t.y!, 0.004);
  };

  const setStations = (list: Station[]) => {
    for (const c of [...stationGroup.children]) { stationGroup.remove(c); disposeTree(c); }
    for (const st of list) {
      const g = new THREE.Group();
      g.position.set(st.x, st.y, 0);
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), new THREE.MeshStandardMaterial({ color: COL.station, emissive: COL.station, emissiveIntensity: 0.3 }));
      pin.rotation.x = -Math.PI / 2;
      pin.position.z = 0.12;
      g.add(pin, label(st.name));
      stationGroup.add(g);
    }
  };

  const fit = () => {
    const box = mapBox ?? new THREE.Box3(new THREE.Vector3(-2, -2, 0), new THREE.Vector3(2, 2, 0.3));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.y, 2) * 0.9;
    controls.target.set(c.x, c.y, 0);
    camera.position.set(c.x - d * 0.35, c.y - d * 0.75, d * 0.8);
    fitted = true;
  };

  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px";
    renderer.domElement.style.height = h + "px";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  let raf = 0, last = performance.now(), wasFollow = false;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const o = opts();
    if (target.have) {
      // ease toward the latest pose (state arrives at ~5 Hz)
      const k = 1 - Math.exp(-dt * 10);
      const px = robot.position.x, py = robot.position.y;
      robot.position.x += (target.x - px) * k;
      robot.position.y += (target.y - py) * k;
      let dyaw = target.yaw - robot.rotation.z;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      robot.rotation.z += dyaw * k;
      if (o.follow && !wasFollow) {
        // Follow switched on: swing to a chase view just behind and above the robot
        const yaw = robot.rotation.z;
        controls.target.set(robot.position.x, robot.position.y, 0.1);
        camera.position.set(robot.position.x - Math.cos(yaw) * 1.1 + Math.sin(yaw) * 0.5,
          robot.position.y - Math.sin(yaw) * 1.1 - Math.cos(yaw) * 0.5, 0.75);
      } else if (o.follow) {
        const dx = robot.position.x - controls.target.x, dy = robot.position.y - controls.target.y;
        controls.target.x += dx; controls.target.y += dy;
        camera.position.x += dx; camera.position.y += dy;
      }
      sun.position.set(robot.position.x + 1.5, robot.position.y - 1, 4);
      wasFollow = o.follow;
    }
    head.rotation.z += dt * 12; // lidar spin
    grid.visible = o.layers.grid;
    stationGroup.visible = o.layers.stations;
    controls.update();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  const dispose = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    disposeTree(scene);
    walls?.dispose();
    floorMat.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { setMap, setState, setStations, fit, dispose };
}

/** Text sprite above a station. */
function label(text: string) {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d")!;
  const font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + 24; cv.height = 44;
  ctx.font = font;
  ctx.fillStyle = "rgba(11,16,32,0.85)"; ctx.beginPath(); ctx.roundRect(0, 0, cv.width, cv.height, 10); ctx.fill();
  ctx.fillStyle = "#ddd6fe"; ctx.textBaseline = "middle"; ctx.fillText(text, 12, cv.height / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  const h = 0.14;
  sp.scale.set((h * cv.width) / cv.height, h, 1);
  sp.position.z = 0.32;
  return sp;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) { (mat as THREE.MeshBasicMaterial).map?.dispose(); mat.dispose(); }
  });
}
