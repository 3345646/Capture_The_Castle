import * as THREE from "three";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number; // walkable top height
  bottom: number;
}

export interface CapturePointDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface WorldData {
  colliders: Collider[];
  points: CapturePointDef[];
}

const MAT = {
  stone: new THREE.MeshLambertMaterial({ color: 0x9a958c }),
  stoneDark: new THREE.MeshLambertMaterial({ color: 0x7d786f }),
  wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
  roof: new THREE.MeshLambertMaterial({ color: 0x5c2f2f }),
  grass: new THREE.MeshLambertMaterial({ color: 0x4f7a3a }),
  dirt: new THREE.MeshLambertMaterial({ color: 0x6b5a3e }),
};

function addBox(
  scene: THREE.Object3D,
  colliders: Collider[] | null,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);
  if (colliders) {
    colliders.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      top: y + h,
      bottom: y,
    });
  }
  return mesh;
}

function crenellations(
  scene: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  y: number,
) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  const count = Math.max(1, Math.floor(len / 2.4));
  const geo = new THREE.BoxGeometry(1.2, 1.4, 1.2);
  const inst = new THREE.InstancedMesh(geo, MAT.stoneDark, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const p = from.clone().addScaledVector(dir, (i + 0.5) * (len / count));
    m.makeTranslation(p.x, y + 0.7, p.z);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
}

export function buildWorld(scene: THREE.Scene): WorldData {
  const colliders: Collider[] = [];

  // ---- Ground ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), MAT.grass);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // road to gate
  const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 70), MAT.dirt);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 66);
  scene.add(road);

  // ---- Outer walls ----
  const W = 34; // half extent to inner face
  const T = 3; // thickness
  const H = 9; // wall height

  // north wall
  addBox(scene, colliders, 0, 0, -W - T / 2, 2 * W + 2 * T, H, T, MAT.stone);
  // west wall
  addBox(scene, colliders, -W - T / 2, 0, 0, T, H, 2 * W, MAT.stone);
  // east wall
  addBox(scene, colliders, W + T / 2, 0, 0, T, H, 2 * W, MAT.stone);
  // south wall with gate gap (|x| < 5)
  addBox(scene, colliders, -(W + T) / 2 - 2.5, 0, W + T / 2, W + T - 5, H, T, MAT.stone);
  addBox(scene, colliders, (W + T) / 2 + 2.5, 0, W + T / 2, W + T - 5, H, T, MAT.stone);
  // gate lintel (above passage)
  addBox(scene, colliders, 0, 6, W + T / 2, 10, 3, T, MAT.stoneDark);

  // crenellations
  crenellations(scene, new THREE.Vector3(-W - T, 0, -W - T), new THREE.Vector3(W + T, 0, -W - T), H);
  crenellations(scene, new THREE.Vector3(-W - T, 0, -W - T), new THREE.Vector3(-W - T, 0, W + T), H);
  crenellations(scene, new THREE.Vector3(W + T, 0, -W - T), new THREE.Vector3(W + T, 0, W + T), H);
  crenellations(scene, new THREE.Vector3(-W - T, 0, W + T), new THREE.Vector3(-8, 0, W + T), H);
  crenellations(scene, new THREE.Vector3(8, 0, W + T), new THREE.Vector3(W + T, 0, W + T), H);

  // ---- Corner towers ----
  const corners: [number, number][] = [
    [-W - T, -W - T],
    [W + T, -W - T],
    [-W - T, W + T],
    [W + T, W + T],
  ];
  for (const [cx, cz] of corners) {
    addBox(scene, colliders, cx, 0, cz, 10, 13, 10, MAT.stoneDark);
    crenellations(scene, new THREE.Vector3(cx - 5, 0, cz - 5), new THREE.Vector3(cx + 5, 0, cz - 5), 13);
    crenellations(scene, new THREE.Vector3(cx - 5, 0, cz + 5), new THREE.Vector3(cx + 5, 0, cz + 5), 13);
    const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6), MAT.wood);
    flag.position.set(cx, 16, cz);
    scene.add(flag);
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 1.8),
      new THREE.MeshLambertMaterial({ color: 0xb02b2b, side: THREE.DoubleSide }),
    );
    cloth.position.set(cx + 1.5, 18, cz);
    scene.add(cloth);
  }

  // ---- Gatehouse towers ----
  addBox(scene, colliders, -9, 0, W + T / 2, 8, 14, 8, MAT.stoneDark);
  addBox(scene, colliders, 9, 0, W + T / 2, 8, 14, 8, MAT.stoneDark);

  // ---- Keep ----
  // Keep occupies north part of the courtyard: x -11..11, z -30..-12
  addBox(scene, colliders, -8.5, 0, -21, 5, 17, 18, MAT.stone);
  addBox(scene, colliders, 8.5, 0, -21, 5, 17, 18, MAT.stone);
  addBox(scene, colliders, 0, 0, -27, 12, 17, 6, MAT.stone);
  addBox(scene, colliders, 0, 5, -14, 12, 12, 4, MAT.stone); // doorway lintel wall
  // keep roof (walkable slab)
  addBox(scene, colliders, 0, 17, -21, 22, 1.5, 20, MAT.stoneDark);
  crenellations(scene, new THREE.Vector3(-11, 0, -11), new THREE.Vector3(11, 0, -11), 18.5);
  crenellations(scene, new THREE.Vector3(-11, 0, -31), new THREE.Vector3(11, 0, -31), 18.5);

  // ---- Wall walkways (inner ledge) ----
  const ledge = 2.6;
  addBox(scene, colliders, 0, 0, -W + ledge / 2, 2 * W, H - 0.8, ledge, MAT.stoneDark);
  addBox(scene, colliders, -W + ledge / 2, 0, 0, ledge, H - 0.8, 2 * W, MAT.stoneDark);
  addBox(scene, colliders, W - ledge / 2, 0, 0, ledge, H - 0.8, 2 * W, MAT.stoneDark);
  // South inner ledge is split into two halves so the gate passage stays open.
  // Gate opening is |x| < 5 — leave a clear 12-wide corridor for the player + AI.
  const southLedgeGap = 6; // half-width of the opening
  const southLen = W - southLedgeGap;
  addBox(
    scene,
    colliders,
    -(southLedgeGap + southLen / 2),
    0,
    W - ledge / 2,
    southLen,
    H - 0.8,
    ledge,
    MAT.stoneDark,
  );
  addBox(
    scene,
    colliders,
    southLedgeGap + southLen / 2,
    0,
    W - ledge / 2,
    southLen,
    H - 0.8,
    ledge,
    MAT.stoneDark,
  );
  // A short wooden bridge across the gap so defenders can still run the full wall walk.
  addBox(scene, colliders, 0, H - 0.8, W - ledge / 2, 2 * southLedgeGap, 0.4, ledge, MAT.wood);

  // ---- Stairs to the wall walk (east side, climbable via step-up) ----
  for (let i = 0; i < 14; i++) {
    addBox(scene, colliders, W - ledge - 1.6, 0, 8 + i * 1.2, 3.2, 0.59 * (i + 1), 1.2, MAT.stoneDark);
  }
  // stairs on the west side
  for (let i = 0; i < 14; i++) {
    addBox(scene, colliders, -W + ledge + 1.6, 0, -8 - i * 1.2, 3.2, 0.59 * (i + 1), 1.2, MAT.stoneDark);
  }

  // ---- Siege ramp outside (lets attackers climb the east wall) ----
  for (let i = 0; i < 16; i++) {
    addBox(scene, colliders, W + T + 4 + i * 0.9, 0, 20, 0.9, 0.56 * (16 - i), 6, MAT.wood);
  }

  // ---- Courtyard props ----
  addBox(scene, colliders, -22, 0, 20, 6, 4, 6, MAT.wood); // shed
  addBox(scene, colliders, 22, 0, -6, 5, 3, 5, MAT.wood);
  addBox(scene, colliders, -24, 0, -4, 4, 3, 8, MAT.wood);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addBox(scene, colliders, Math.cos(a) * 45 + 30, 0, Math.sin(a) * 30 + 60, 2, 2.5, 2, MAT.wood);
  }

  // trees around the field
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 4);
  const leafGeo = new THREE.ConeGeometry(2.6, 6, 7);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f5c2a });
  for (let i = 0; i < 40; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 70 + Math.random() * 90;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const t = new THREE.Mesh(trunkGeo, MAT.wood);
    t.position.set(x, 2, z);
    scene.add(t);
    const l = new THREE.Mesh(leafGeo, leafMat);
    l.position.set(x, 6.5, z);
    scene.add(l);
  }

  const points: CapturePointDef[] = [
    { id: "A", name: "Siege Camp", x: 0, z: 52, radius: 7 },
    { id: "B", name: "Gatehouse", x: 0, z: 24, radius: 7 },
    { id: "C", name: "Courtyard", x: 0, z: 0, radius: 8 },
    { id: "D", name: "The Keep", x: 0, z: -21, radius: 8 },
  ];

  return { colliders, points };
}

export { MAT };
