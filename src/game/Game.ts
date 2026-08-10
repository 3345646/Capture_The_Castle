import * as THREE from "three";
import { buildWorld, type Collider, type CapturePointDef } from "./world";

export type Team = "player" | "enemy";
export type Weapon = "sword" | "bow";

export interface PointState {
  id: string;
  name: string;
  owner: Team | "neutral";
  progress: number; // -1 (enemy) .. 1 (player)
  contested: boolean;
  x: number;
  z: number;
}

export interface HudState {
  health: number;
  maxHealth: number;
  weapon: Weapon;
  arrows: number;
  draw: number;
  points: PointState[];
  allies: number;
  enemies: number;
  kills: number;
  status: "playing" | "won" | "lost";
  respawn: number;
  message: string;
  hitFlash: number;
  damageFlash: number;
  time: number;
  gateHp: number;
  gateMaxHp: number;
  gateNear: boolean;
  gateDown: boolean;
  enemyWave: number;
  enemyReserve: number;
}

const GRAVITY = 22;
const STEP_UP = 1.1;
const PLAYER_HEIGHT = 1.72;
const PLAYER_RADIUS = 0.45;

const TEAM_COLOR: Record<Team, number> = { player: 0x2f6fd0, enemy: 0xb02b2b };

interface Arrow {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  team: Team;
  life: number;
  dmg: number;
}

class Agent {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp = 100;
  maxHp = 100;
  team: Team;
  kind: Weapon;
  speed: number;
  attackCd = 0;
  alive = true;
  targetPoint: PointState | null = null;
  strafe = 0;
  strafeTimer = 0;
  swing = 0;
  deadTimer = 0;
  armR: THREE.Object3D;
  weaponMesh: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  walkPhase = Math.random() * 10;
  onWall = false;
  guard = false;
  home = new THREE.Vector3();

  constructor(team: Team, kind: Weapon, x: number, z: number, y = 0) {
    this.team = team;
    this.kind = kind;
    this.pos.set(x, y, z);
    this.home.set(x, y, z);
    this.speed = kind === "sword" ? 4.6 : 3.9;
    this.maxHp = kind === "sword" ? 110 : 80;
    this.hp = this.maxHp;

    const cloth = new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team] });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8a877 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3b3b45 });
    const metal = new THREE.MeshLambertMaterial({ color: 0xb9bdc4 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.42), cloth);
    torso.position.y = 1.18;
    this.group.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), skin);
    head.position.y = 1.78;
    this.group.add(head);
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.44), metal);
    helm.position.y = 1.95;
    this.group.add(helm);

    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.78, 0.28), dark);
    this.legL.position.set(-0.19, 0.39, 0);
    this.group.add(this.legL);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.78, 0.28), dark);
    this.legR.position.set(0.19, 0.39, 0);
    this.group.add(this.legR);

    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), cloth);
    armL.position.set(-0.48, 1.2, 0);
    this.group.add(armL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.48, 1.5, 0);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), cloth);
    armMesh.position.y = -0.32;
    this.armR.add(armMesh);
    this.group.add(this.armR);

    if (kind === "sword") {
      const w = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.02), metal);
      blade.position.y = 0.62;
      w.add(blade);
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.08, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x8a6a2f }),
      );
      guard.position.y = 0.08;
      w.add(guard);
      w.position.set(0, -0.62, 0.1);
      this.weaponMesh = w;
    } else {
      const w = new THREE.Group();
      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.045, 6, 14, Math.PI * 1.1),
        new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
      );
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = Math.PI / 2;
      w.add(bow);
      w.position.set(0, -0.5, 0.25);
      this.weaponMesh = w;
    }
    this.armR.add(this.weaponMesh);

    // shield for swordsmen
    if (kind === "sword") {
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.55), cloth);
      shield.position.set(-0.6, 1.15, 0.05);
      this.group.add(shield);
    }
  }

  eyePos(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + 1.6, this.pos.z);
  }
}

export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  minimap: HTMLCanvasElement | null = null;

  colliders: Collider[] = [];
  points: PointState[] = [];
  pointMeshes: {
    def: CapturePointDef;
    ring: THREE.Mesh;
    cloth: THREE.Mesh;
    pole: THREE.Object3D;
  }[] = [];

  agents: Agent[] = [];
  arrows: Arrow[] = [];

  // player
  pPos = new THREE.Vector3(0, 0, 78);
  pVel = new THREE.Vector3();
  yaw = Math.PI;
  pitch = 0;
  hp = 100;
  maxHp = 100;
  weapon: Weapon = "sword";
  arrowsLeft = 30;
  drawAmount = 0;
  drawing = false;
  swingTimer = 0;
  swingCd = 0;
  onGround = true;
  kills = 0;
  status: "playing" | "won" | "lost" = "playing";
  respawnTimer = 0;
  message = "";
  messageTimer = 0;
  hitFlash = 0;
  damageFlash = 0;
  elapsed = 0;

  viewGroup = new THREE.Group();
  swordView!: THREE.Group;
  bowView!: THREE.Group;

  keys: Record<string, boolean> = {};
  locked = false;
  running = true;
  clock = new THREE.Clock();
  onHud: (s: HudState) => void;
  hudAcc = 0;
  enemySpawnTimer = 0;
  allySpawnTimer = 0;

  // ---- destructible gate ----
  gateGroup = new THREE.Group();
  gateCollider: Collider | null = null;
  gateHp = 900;
  gateMaxHp = 900;
  gateDown = false;
  gateFallTimer = 0;
  gateShake = 0;
  gateBox = { minX: -5.2, maxX: 5.2, minZ: 33.6, maxZ: 37.4, top: 6.2, bottom: 0 };

  // ---- enemy reinforcements ----
  enemyReserve = 26;
  waveTimer = 12;
  waveInterval = 12;

  constructor(container: HTMLElement, onHud: (s: HudState) => void) {
    this.container = container;
    this.onHud = onHud;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x8fb6d8);
    this.scene.fog = new THREE.Fog(0x8fb6d8, 90, 260);

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 600);
    this.scene.add(this.camera);

    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a5533, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.15);
    sun.position.set(60, 100, 40);
    this.scene.add(sun);

    const world = buildWorld(this.scene);
    this.colliders = world.colliders;

    for (const def of world.points) {
      const owner: Team | "neutral" = def.id === "A" ? "player" : "enemy";
      this.points.push({
        id: def.id,
        name: def.name,
        owner,
        progress: owner === "player" ? 1 : -1,
        contested: false,
        x: def.x,
        z: def.z,
      });
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(def.radius - 0.5, def.radius, 40),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(def.x, 0.06, def.z);
      this.scene.add(ring);

      const pole = new THREE.Group();
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 7),
        new THREE.MeshLambertMaterial({ color: 0x5a4126 }),
      );
      stick.position.y = 3.5;
      pole.add(stick);
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 1.6),
        new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      );
      cloth.position.set(1.3, 6, 0);
      pole.add(cloth);
      pole.position.set(def.x, 0, def.z);
      this.scene.add(pole);
      this.pointMeshes.push({ def, ring, cloth, pole });
    }

    this.buildGate();
    this.buildViewModels();
    this.spawnInitialForces();
    this.updatePointVisuals();

    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.addEventListener("click", this.requestLock);

    this.loop();
  }

  // ---------------- gate ----------------
  buildGate() {
    const plank = new THREE.MeshLambertMaterial({ color: 0x5a3a1e });
    const iron = new THREE.MeshLambertMaterial({ color: 0x3a3a42 });
    const g = this.gateGroup;
    // vertical planks
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 0.55), plank);
      p.position.set(-4.5 + i * 1.5, 3, 0);
      g.add(p);
    }
    // iron bands
    for (const y of [1.1, 3, 4.9]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.4, 0.7), iron);
      b.position.set(0, y, 0);
      g.add(b);
    }
    // studs + rings
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), iron);
      s.position.set(-4.2 + i * 1.7, 3, 0.4);
      g.add(s);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 6, 12), iron);
    ring.position.set(0, 2.2, 0.45);
    g.add(ring);

    g.position.set(0, 0, 35.5);
    this.scene.add(g);

    this.gateCollider = {
      minX: this.gateBox.minX,
      maxX: this.gateBox.maxX,
      minZ: this.gateBox.minZ,
      maxZ: this.gateBox.maxZ,
      top: this.gateBox.top,
      bottom: 0,
    };
    this.colliders.push(this.gateCollider);
  }

  gateInRange(x: number, z: number, r: number) {
    if (this.gateDown) return false;
    const cx = Math.max(this.gateBox.minX, Math.min(x, this.gateBox.maxX));
    const cz = Math.max(this.gateBox.minZ, Math.min(z, this.gateBox.maxZ));
    return Math.hypot(x - cx, z - cz) < r;
  }

  damageGate(dmg: number) {
    if (this.gateDown) return;
    this.gateHp -= dmg;
    this.gateShake = 0.22;
    if (this.gateHp <= 0) {
      this.gateHp = 0;
      this.gateDown = true;
      this.gateFallTimer = 1.4;
      if (this.gateCollider) {
        const i = this.colliders.indexOf(this.gateCollider);
        if (i >= 0) this.colliders.splice(i, 1);
        this.gateCollider = null;
      }
      this.setMessage("The gate is breached! Storm the castle!");
    } else if (this.gateHp / this.gateMaxHp < 0.35 && this.messageTimer <= 0) {
      this.setMessage("The gate is splintering...");
    }
  }

  updateGate(dt: number) {
    if (this.gateShake > 0) {
      this.gateShake -= dt;
      this.gateGroup.position.x = (Math.random() - 0.5) * 0.16;
      this.gateGroup.rotation.z = (Math.random() - 0.5) * 0.03;
    } else {
      this.gateGroup.position.x *= 0.7;
      this.gateGroup.rotation.z *= 0.7;
    }
    if (!this.gateDown) {
      // progressive damage: gate sags and darkens
      const f = this.gateHp / this.gateMaxHp;
      this.gateGroup.rotation.x = (1 - f) * 0.06;
      return;
    }
    if (this.gateFallTimer > 0) {
      this.gateFallTimer -= dt;
      const t = 1 - Math.max(0, this.gateFallTimer) / 1.4;
      this.gateGroup.rotation.x = -t * (Math.PI / 2.1);
      this.gateGroup.position.y = -t * 0.2;
      if (this.gateFallTimer <= 0) this.gateGroup.visible = true;
    }
  }

  // ---------------- setup ----------------
  buildViewModels() {
    this.viewGroup.position.set(0, 0, 0);
    this.camera.add(this.viewGroup);

    const metal = new THREE.MeshLambertMaterial({ color: 0xd2d7de });
    const sword = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.02), metal);
    blade.position.y = 0.55;
    sword.add(blade);
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.06, 0.07),
      new THREE.MeshLambertMaterial({ color: 0x9a7a33 }),
    );
    sword.add(guard);
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.28),
      new THREE.MeshLambertMaterial({ color: 0x4a3520 }),
    );
    grip.position.y = -0.15;
    sword.add(grip);
    sword.position.set(0.36, -0.42, -0.6);
    sword.rotation.set(-0.5, 0.2, 0.25);
    this.swordView = sword;
    this.viewGroup.add(sword);

    const bow = new THREE.Group();
    const limb = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.03, 6, 16, Math.PI * 1.2),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
    );
    limb.rotation.z = Math.PI * 0.9;
    bow.add(limb);
    const nock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.8),
      new THREE.MeshLambertMaterial({ color: 0xc9b48b }),
    );
    nock.rotation.z = Math.PI / 2;
    nock.position.set(0.1, 0, 0);
    nock.name = "shaft";
    bow.add(nock);
    bow.position.set(0.3, -0.3, -0.7);
    bow.rotation.set(0, -0.25, 0);
    bow.visible = false;
    this.bowView = bow;
    this.viewGroup.add(bow);
  }

  spawnInitialForces() {
    // Defenders: wall archers
    const wallSpots: [number, number, number][] = [
      [-20, 8.2, -33], [0, 8.2, -33], [20, 8.2, -33],
      [-35, 8.2, -15], [-35, 8.2, 15], [35, 8.2, -15], [35, 8.2, 15],
      [-20, 8.2, 33], [20, 8.2, 33],
    ];
    for (const [x, y, z] of wallSpots) {
      const g = this.addAgent("enemy", "bow", x, z, y);
      g.guard = true;
    }
    // Courtyard defenders
    const ground: [number, number, Weapon][] = [
      [-8, 8, "sword"], [8, 10, "sword"], [0, 16, "sword"],
      [-14, -2, "sword"], [14, -2, "sword"], [0, -8, "sword"],
      [-4, -18, "bow"], [4, -18, "bow"], [0, 26, "sword"],
    ];
    for (const [x, z, k] of ground) this.addAgent("enemy", k, x, z, 0);

    // Allies at the siege camp
    for (let i = 0; i < 8; i++) {
      const k: Weapon = i % 3 === 0 ? "bow" : "sword";
      this.addAgent("player", k, -10 + (i % 4) * 6, 56 + Math.floor(i / 4) * 5, 0);
    }
  }

  addAgent(team: Team, kind: Weapon, x: number, z: number, y = 0) {
    const a = new Agent(team, kind, x, z, y);
    this.scene.add(a.group);
    this.agents.push(a);
    return a;
  }

  // ---------------- input ----------------
  requestLock = () => {
    if (this.status === "playing" && !this.locked) this.renderer.domElement.requestPointerLock();
  };
  onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
  };
  onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
  onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (e.code === "Digit1") this.setWeapon("sword");
    if (e.code === "Digit2") this.setWeapon("bow");
    if (e.code === "KeyQ") this.setWeapon(this.weapon === "sword" ? "bow" : "sword");
    if (e.code === "Space") e.preventDefault();
  };
  onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };
  onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.yaw -= e.movementX * 0.0022;
    this.pitch -= e.movementY * 0.0022;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
  };
  onMouseDown = (e: MouseEvent) => {
    if (!this.locked || this.status !== "playing" || this.respawnTimer > 0) return;
    if (e.button === 0) {
      if (this.weapon === "sword") this.trySwing();
      else this.drawing = true;
    }
  };
  onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 && this.weapon === "bow" && this.drawing) {
      this.drawing = false;
      if (this.drawAmount > 0.25) this.fireArrow();
      this.drawAmount = 0;
    }
  };
  setWeapon(w: Weapon) {
    if (this.weapon === w) return;
    this.weapon = w;
    this.drawing = false;
    this.drawAmount = 0;
    this.swordView.visible = w === "sword";
    this.bowView.visible = w === "bow";
  }

  // ---------------- physics ----------------
  resolve(pos: THREE.Vector3, radius: number, height: number): { supportY: number } {
    let supportY = 0;
    // horizontal push-out
    for (const c of this.colliders) {
      if (c.top <= pos.y + 0.02) continue; // below feet
      if (c.bottom >= pos.y + height) continue; // above head
      if (c.top <= pos.y + STEP_UP) continue; // steppable
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2);
        if (d < 0.0001) {
          // deep inside: push along smallest axis
          const px = pos.x < (c.minX + c.maxX) / 2 ? c.minX - radius : c.maxX + radius;
          const pz = pos.z < (c.minZ + c.maxZ) / 2 ? c.minZ - radius : c.maxZ + radius;
          if (Math.abs(px - pos.x) < Math.abs(pz - pos.z)) pos.x = px;
          else pos.z = pz;
        } else {
          const push = (radius - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    }
    // support height
    for (const c of this.colliders) {
      if (c.top > pos.y + STEP_UP) continue;
      if (pos.x < c.minX - radius * 0.5 || pos.x > c.maxX + radius * 0.5) continue;
      if (pos.z < c.minZ - radius * 0.5 || pos.z > c.maxZ + radius * 0.5) continue;
      if (c.top > supportY) supportY = c.top;
    }
    return { supportY };
  }

  // ---------------- combat ----------------
  trySwing() {
    if (this.swingCd > 0) return;
    this.swingCd = 0.55;
    this.swingTimer = 0.42;
    const dir = this.forward(new THREE.Vector3());
    let hitAny = false;
    // chop the gate
    if (this.gateInRange(this.pPos.x, this.pPos.z, 3.2) && this.pPos.y < 6) {
      const toGate = new THREE.Vector3(0 - this.pPos.x, 0, 35.5 - this.pPos.z).normalize();
      if (toGate.dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) > 0.3) {
        this.damageGate(45);
        hitAny = true;
      }
    }
    for (const a of this.agents) {
      if (!a.alive || a.team === "player") continue;
      const to = new THREE.Vector3(a.pos.x - this.pPos.x, a.pos.y - this.pPos.y, a.pos.z - this.pPos.z);
      if (Math.abs(to.y) > 2.2) continue;
      const dist = Math.hypot(to.x, to.z);
      if (dist > 2.8) continue;
      to.y = 0;
      to.normalize();
      if (to.dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) < 0.5) continue;
      this.damageAgent(a, 60, "player");
      hitAny = true;
    }
    if (hitAny) this.hitFlash = 0.25;
  }

  fireArrow() {
    if (this.arrowsLeft <= 0) return;
    this.arrowsLeft--;
    const dir = this.forward(new THREE.Vector3());
    const origin = new THREE.Vector3(this.pPos.x, this.pPos.y + PLAYER_HEIGHT - 0.15, this.pPos.z).addScaledVector(dir, 0.6);
    this.spawnArrow(origin, dir.multiplyScalar(34 + 30 * this.drawAmount), "player", 45 + 45 * this.drawAmount);
  }

  spawnArrow(origin: THREE.Vector3, vel: THREE.Vector3, team: Team, dmg: number) {
    const geo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: team === "player" ? 0xe8d9a8 : 0x8a6a3a }));
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.arrows.push({ mesh, vel: vel.clone(), team, life: 6, dmg });
  }

  damageAgent(a: Agent, dmg: number, by: Team) {
    if (!a.alive) return;
    a.hp -= dmg;
    if (a.hp <= 0) {
      a.alive = false;
      a.deadTimer = 6;
      a.group.rotation.x = -Math.PI / 2.2;
      a.group.position.y = a.pos.y + 0.2;
      if (by === "player") {
        this.kills++;
        this.setMessage("Enemy slain!");
      }
    }
  }

  damagePlayer(dmg: number) {
    if (this.respawnTimer > 0 || this.status !== "playing") return;
    this.hp -= dmg;
    this.damageFlash = 0.5;
    if (this.hp <= 0) {
      this.hp = 0;
      this.respawnTimer = 5;
      this.setMessage("You were slain — respawning at your nearest flag");
    }
  }

  setMessage(m: string) {
    this.message = m;
    this.messageTimer = 2.5;
  }

  forward(out: THREE.Vector3) {
    return out.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  // ---------------- AI ----------------
  chooseObjective(team: Team): PointState | null {
    // attack the nearest point not owned by team, in frontline order
    if (team === "player") {
      // attackers push toward the first flag they do not hold
      for (const p of this.points) if (p.owner !== "player") return p;
      return null;
    }
    // defenders hold the front-most flag that is still theirs (or contested)
    for (const p of this.points) if (p.owner !== "player") return p;
    return this.points[this.points.length - 1] ?? null;
  }

  updateAgent(a: Agent, dt: number) {
    if (!a.alive) {
      a.deadTimer -= dt;
      if (a.deadTimer <= 0) {
        this.scene.remove(a.group);
      }
      return;
    }
    a.attackCd -= dt;
    a.swing = Math.max(0, a.swing - dt * 3);

    // find target: nearest enemy (agents or the player)
    let bestDist = Infinity;
    let targetPos: THREE.Vector3 | null = null;
    let targetAgent: Agent | null = null;
    let targetIsPlayer = false;
    const range = a.kind === "bow" ? 60 : 34;
    for (const o of this.agents) {
      if (!o.alive || o.team === a.team) continue;
      const d = a.pos.distanceTo(o.pos);
      if (d < bestDist && d < range) {
        bestDist = d;
        targetPos = o.pos;
        targetAgent = o;
      }
    }
    if (a.team === "enemy" && this.respawnTimer <= 0 && this.status === "playing") {
      const d = a.pos.distanceTo(this.pPos);
      if (d < bestDist && d < range) {
        bestDist = d;
        targetPos = this.pPos;
        targetAgent = null;
        targetIsPlayer = true;
      }
    }

    // objective
    const obj = this.chooseObjective(a.team);
    const dest = new THREE.Vector3();
    let wantAttack = false;

    // --- gate assault: attackers stuck outside must break the gate ---
    const mustBreach =
      a.team === "player" &&
      !this.gateDown &&
      a.pos.z > 36.5 &&
      obj !== null &&
      obj.z < 36;
    if (mustBreach && (!targetPos || bestDist > 5)) {
      dest.set((a.pos.x - 0) * 0.15, 0, 37.6);
      a.yaw = Math.atan2(0 - a.pos.x, 35.5 - a.pos.z);
      if (this.gateInRange(a.pos.x, a.pos.z, a.kind === "sword" ? 3.0 : 18)) {
        if (a.attackCd <= 0) {
          if (a.kind === "sword") {
            a.attackCd = 1.0 + Math.random() * 0.4;
            a.swing = 1;
            this.damageGate(16);
          } else {
            a.attackCd = 2.2 + Math.random();
            const from = a.eyePos(new THREE.Vector3());
            const dir = new THREE.Vector3(-from.x * 0.02, 0.06, 35.5 - from.z).normalize();
            this.spawnArrow(from.addScaledVector(dir, 0.8), dir.multiplyScalar(42), "player", 14);
          }
        }
        dest.copy(a.pos);
      }
      this.finishAgent(a, dest, dt, false);
      return;
    }

    if (targetPos) {
      const desired = a.kind === "bow" ? 16 : 1.9;
      if (a.kind === "bow" && a.guard) {
        dest.copy(a.home);
        wantAttack = bestDist < 60;
      } else if (a.kind === "bow") {
        if (bestDist < 11) {
          dest.copy(a.pos).addScaledVector(new THREE.Vector3().subVectors(a.pos, targetPos).setY(0).normalize(), 6);
        } else if (bestDist > 40) {
          dest.copy(targetPos);
        } else {
          dest.copy(a.pos);
          wantAttack = true;
        }
        if (bestDist <= 40 && bestDist >= 11) wantAttack = true;
      } else {
        dest.copy(targetPos);
        if (bestDist < 2.4) wantAttack = true;
      }
      // face target
      a.yaw = Math.atan2(targetPos.x - a.pos.x, targetPos.z - a.pos.z);
      void desired;
    } else if (a.guard) {
      dest.copy(a.home);
    } else if (obj) {
      dest.set(obj.x, 0, obj.z);
      // funnel through the gate when approaching the castle from outside
      if (a.pos.z > 40 && dest.z < 40) dest.set(0, 0, 39);
      const dd = Math.hypot(dest.x - a.pos.x, dest.z - a.pos.z);
      if (dd < 5) {
        dest.copy(a.pos);
      }
      a.yaw = Math.atan2(dest.x - a.pos.x, dest.z - a.pos.z);
    } else {
      dest.copy(a.pos);
    }

    const moving = this.moveAgent(a, dest, dt);
    this.agentAttack(a, dt, wantAttack, targetPos, targetAgent, targetIsPlayer);
    this.animateAgent(a, dt, moving);
  }

  moveAgent(a: Agent, dest: THREE.Vector3, dt: number): boolean {
    const dx = dest.x - a.pos.x;
    const dz = dest.z - a.pos.z;
    const dl = Math.hypot(dx, dz);
    let moving = false;
    if (dl > 1.2) {
      moving = true;
      let mx = dx / dl;
      let mz = dz / dl;
      a.strafeTimer -= dt;
      if (a.strafeTimer <= 0) {
        a.strafe = 0;
        a.strafeTimer = 0.4 + Math.random();
      }
      if (a.strafe !== 0) {
        mx += -mz * a.strafe * 0.9;
        mz += mx * a.strafe * 0.9;
      }
      const before = a.pos.clone();
      a.pos.x += mx * a.speed * dt;
      a.pos.z += mz * a.speed * dt;
      // separation from other agents
      for (const o of this.agents) {
        if (o === a || !o.alive) continue;
        const ox = a.pos.x - o.pos.x;
        const oz = a.pos.z - o.pos.z;
        const od2 = ox * ox + oz * oz;
        if (od2 < 1.1 && od2 > 0.0001 && Math.abs(a.pos.y - o.pos.y) < 1.5) {
          const od = Math.sqrt(od2);
          a.pos.x += (ox / od) * (1.05 - od) * 0.6;
          a.pos.z += (oz / od) * (1.05 - od) * 0.6;
        }
      }
      const { supportY } = this.resolve(a.pos, 0.5, 1.8);
      // fall / step
      if (supportY > a.pos.y) a.pos.y = Math.min(supportY, a.pos.y + STEP_UP);
      else if (supportY < a.pos.y) {
        a.vel.y -= GRAVITY * dt;
        a.pos.y += a.vel.y * dt;
        if (a.pos.y < supportY) {
          a.pos.y = supportY;
          a.vel.y = 0;
        }
      } else a.vel.y = 0;

      const moved = Math.hypot(a.pos.x - before.x, a.pos.z - before.z);
      if (moved < a.speed * dt * 0.4 && a.strafe === 0) {
        a.strafe = Math.random() < 0.5 ? -1 : 1;
        a.strafeTimer = 0.8 + Math.random();
      }
    } else {
      const { supportY } = this.resolve(a.pos, 0.5, 1.8);
      if (supportY < a.pos.y) {
        a.vel.y -= GRAVITY * dt;
        a.pos.y += a.vel.y * dt;
        if (a.pos.y < supportY) {
          a.pos.y = supportY;
          a.vel.y = 0;
        }
      } else if (supportY > a.pos.y) a.pos.y = supportY;
    }
    return moving;
  }

  agentAttack(
    a: Agent,
    _dt: number,
    wantAttack: boolean,
    targetPos: THREE.Vector3 | null,
    targetAgent: Agent | null,
    targetIsPlayer: boolean,
  ) {
    if (wantAttack && a.attackCd <= 0 && targetPos) {
      if (a.kind === "sword") {
        a.attackCd = 1.1 + Math.random() * 0.4;
        a.swing = 1;
        if (targetIsPlayer) this.damagePlayer(18);
        else if (targetAgent) this.damageAgent(targetAgent, 34, a.team);
      } else {
        a.attackCd = 1.8 + Math.random() * 1.2;
        const from = a.eyePos(new THREE.Vector3());
        const to = targetPos.clone().add(new THREE.Vector3(0, 1.2, 0));
        const d = from.distanceTo(to);
        const speed = 42;
        const t = d / speed;
        // lead + gravity compensation
        to.y += 0.5 * 9.5 * t * t;
        const dir = to.sub(from).normalize();
        dir.x += (Math.random() - 0.5) * 0.05;
        dir.y += (Math.random() - 0.5) * 0.03;
        dir.z += (Math.random() - 0.5) * 0.05;
        this.spawnArrow(from.addScaledVector(dir, 0.8), dir.multiplyScalar(speed), a.team, 26);
      }
    }

  }

  finishAgent(a: Agent, dest: THREE.Vector3, dt: number, _unused: boolean) {
    const moving = this.moveAgent(a, dest, dt);
    this.animateAgent(a, dt, moving);
    void _unused;
  }

  animateAgent(a: Agent, dt: number, moving: boolean) {
    a.group.position.set(a.pos.x, a.pos.y, a.pos.z);
    a.group.rotation.y = a.yaw + Math.PI;
    if (moving) {
      a.walkPhase += dt * 9;
      a.legL.rotation.x = Math.sin(a.walkPhase) * 0.6;
      a.legR.rotation.x = -Math.sin(a.walkPhase) * 0.6;
    } else {
      a.legL.rotation.x *= 0.85;
      a.legR.rotation.x *= 0.85;
    }
    a.armR.rotation.x = a.kind === "sword" ? -0.4 - a.swing * 1.6 : -1.4;
  }

  // ---------------- objectives ----------------
  updatePoints(dt: number) {
    let allCaptured = true;
    for (const p of this.points) {
      let att = 0;
      let def = 0;
      for (const a of this.agents) {
        if (!a.alive) continue;
        const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
        if (d < 8 && Math.abs(a.pos.y) < 20) {
          if (a.team === "player") att++;
          else def++;
        }
      }
      if (this.respawnTimer <= 0 && Math.hypot(this.pPos.x - p.x, this.pPos.z - p.z) < 8) att += 2;
      p.contested = att > 0 && def > 0;
      const net = att - def;
      if (net !== 0) {
        const rate = Math.sign(net) * Math.min(3, Math.abs(net)) * 0.13;
        const prev = p.progress;
        p.progress = Math.max(-1, Math.min(1, p.progress + rate * dt));
        const newOwner: Team | "neutral" = p.progress >= 1 ? "player" : p.progress <= -1 ? "enemy" : "neutral";
        if (newOwner !== p.owner) {
          p.owner = newOwner;
          if (newOwner === "player") this.setMessage(`${p.name} captured!`);
          else if (newOwner === "enemy") this.setMessage(`${p.name} lost!`);
        }
        void prev;
      }
      if (p.owner !== "player") allCaptured = false;
    }
    this.updatePointVisuals();
    if (allCaptured && this.status === "playing") {
      this.status = "won";
      this.setMessage("Victory! The castle is yours.");
      document.exitPointerLock();
    }
  }

  updatePointVisuals() {
    for (let i = 0; i < this.pointMeshes.length; i++) {
      const pm = this.pointMeshes[i];
      const p = this.points[i];
      const col =
        p.owner === "player" ? 0x3f8ae0 : p.owner === "enemy" ? 0xd03a3a : 0xe6cf4a;
      (pm.ring.material as THREE.MeshBasicMaterial).color.setHex(col);
      (pm.cloth.material as THREE.MeshLambertMaterial).color.setHex(col);
      pm.cloth.position.y = 2.4 + (p.progress + 1) * 1.8;
    }
  }

  spawnDefender() {
    if (this.enemyReserve <= 0) return;
    this.enemyReserve--;
    const r = Math.random();
    // deepest enemy-held flag is the muster point; the keep is the last resort
    const held = this.points.filter((p) => p.owner !== "player");
    const sp = held[held.length - 1] ?? { x: 0, z: -21 };
    if (r < 0.22) {
      // archer reinforces the battlements
      const spots: [number, number, number][] = [
        [-24, 8.2, -33], [24, 8.2, -33], [-35, 8.2, 0], [35, 8.2, 0],
        [-26, 8.2, 33], [26, 8.2, 33], [0, 18.8, -21],
      ];
      const s = spots[Math.floor(Math.random() * spots.length)];
      const g = this.addAgent("enemy", "bow", s[0], s[2], s[1]);
      g.guard = true;
      return;
    }
    const kind: Weapon = r < 0.42 ? "bow" : "sword";
    this.addAgent(
      "enemy",
      kind,
      sp.x + (Math.random() - 0.5) * 10,
      sp.z + (Math.random() - 0.5) * 8 - 4,
      0,
    );
  }

  // ---------------- spawns ----------------
  updateSpawns(dt: number) {
    const aliveEnemies = this.agents.filter((a) => a.alive && a.team === "enemy").length;
    const aliveAllies = this.agents.filter((a) => a.alive && a.team === "player").length;
    const enemyPoints = this.points.filter((p) => p.owner === "enemy").length;

    // --- trickle reinforcements: keep the garrison topped up ---
    const cap = 5 + enemyPoints * 3;
    this.enemySpawnTimer -= dt;
    if (this.enemySpawnTimer <= 0 && aliveEnemies < cap && this.enemyReserve > 0) {
      this.enemySpawnTimer = 3.5;
      this.spawnDefender();
    }

    // --- reinforcement waves: a squad sallies out on a timer ---
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = this.waveInterval;
      if (this.enemyReserve > 0 && aliveEnemies < cap + 5) {
        const size = Math.min(3 + (4 - enemyPoints), this.enemyReserve);
        for (let i = 0; i < size; i++) this.spawnDefender();
        this.setMessage(`Enemy reinforcements! (${size} defenders)`);
      }
    }

    this.allySpawnTimer -= dt;
    if (this.allySpawnTimer <= 0 && aliveAllies < 10) {
      this.allySpawnTimer = 5;
      const kind: Weapon = Math.random() < 0.3 ? "bow" : "sword";
      const owned = this.points.filter((p) => p.owner === "player");
      const sp = owned[owned.length - 1];
      const x = (sp ? sp.x : 0) + (Math.random() - 0.5) * 8;
      const z = (sp ? sp.z : 60) + 6 + Math.random() * 4;
      this.addAgent("player", kind, x, z, 0);
    }

    // cull removed corpses
    this.agents = this.agents.filter((a) => a.alive || a.deadTimer > 0);
  }

  // ---------------- player ----------------
  updatePlayer(dt: number) {
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        const owned = this.points.filter((p) => p.owner === "player");
        const sp = owned[owned.length - 1] ?? { x: 0, z: 70 };
        this.pPos.set(sp.x + (Math.random() - 0.5) * 6, 0, sp.z + 6);
        this.hp = this.maxHp;
        this.arrowsLeft = Math.max(this.arrowsLeft, 20);
      }
      this.camera.position.set(this.pPos.x, this.pPos.y + 0.5, this.pPos.z);
      return;
    }

    const speedBase = this.keys["ShiftLeft"] || this.keys["ShiftRight"] ? 8.4 : 5.6;
    const speed = this.drawing ? speedBase * 0.5 : speedBase;
    let mx = 0;
    let mz = 0;
    if (this.keys["KeyW"]) mz += 1;
    if (this.keys["KeyS"]) mz -= 1;
    if (this.keys["KeyA"]) mx -= 1;
    if (this.keys["KeyD"]) mx += 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = -fz;
      const rz = fx;
      this.pPos.x += (fx * mz + rx * mx) * speed * dt;
      this.pPos.z += (fz * mz + rz * mx) * speed * dt;
    }

    if (this.keys["Space"] && this.onGround) {
      this.pVel.y = 7.4;
      this.onGround = false;
    }

    this.pVel.y -= GRAVITY * dt;
    this.pPos.y += this.pVel.y * dt;

    const { supportY } = this.resolve(this.pPos, PLAYER_RADIUS, PLAYER_HEIGHT);
    if (this.pPos.y <= supportY) {
      this.pPos.y = supportY;
      this.pVel.y = 0;
      this.onGround = true;
    } else if (this.pVel.y <= 0 && supportY > this.pPos.y - 0.01) {
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    if (this.pPos.y < -20) {
      this.pPos.set(0, 0, 70);
      this.pVel.set(0, 0, 0);
    }
    // Emergency unstick: if the player is somehow fully inside a solid collider
    // (top well above head AND bottom at feet), shove them southward to the road.
    for (const c of this.colliders) {
      if (
        this.pPos.x > c.minX && this.pPos.x < c.maxX &&
        this.pPos.z > c.minZ && this.pPos.z < c.maxZ &&
        this.pPos.y + 0.05 >= c.bottom && this.pPos.y + 0.5 < c.top
      ) {
        this.pPos.z = c.maxZ + PLAYER_RADIUS + 0.3;
        break;
      }
    }

    // camera
    const bob = len > 0 && this.onGround ? Math.sin(this.elapsed * 11) * 0.05 : 0;
    this.camera.position.set(this.pPos.x, this.pPos.y + PLAYER_HEIGHT + bob, this.pPos.z);
    this.camera.rotation.set(0, 0, 0, "YXZ");
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // weapon anim
    this.swingCd = Math.max(0, this.swingCd - dt);
    if (this.swingTimer > 0) {
      this.swingTimer -= dt;
      const t = 1 - this.swingTimer / 0.42;
      const s = Math.sin(t * Math.PI);
      this.swordView.rotation.set(-0.5 - s * 1.9, 0.2 + s * 0.9, 0.25 - s * 1.2);
      this.swordView.position.set(0.36 - s * 0.35, -0.42 + s * 0.28, -0.6 - s * 0.25);
    } else {
      this.swordView.rotation.set(-0.5, 0.2, 0.25);
      this.swordView.position.set(0.36, -0.42 + Math.sin(this.elapsed * 2) * 0.01, -0.6);
    }
    if (this.drawing) {
      this.drawAmount = Math.min(1, this.drawAmount + dt * 1.4);
      if (this.arrowsLeft <= 0) {
        this.drawing = false;
        this.drawAmount = 0;
      }
    }
    const shaft = this.bowView.getObjectByName("shaft");
    if (shaft) shaft.position.x = 0.1 - this.drawAmount * 0.25;
    this.bowView.position.z = -0.7 + this.drawAmount * 0.12;
  }

  updateArrows(dt: number) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const ar = this.arrows[i];
      ar.life -= dt;
      ar.vel.y -= 9.5 * dt;
      const step = ar.vel.clone().multiplyScalar(dt);
      const next = ar.mesh.position.clone().add(step);
      let dead = ar.life <= 0;

      // agents
      if (!dead) {
        for (const a of this.agents) {
          if (!a.alive || a.team === ar.team) continue;
          const dxz = Math.hypot(next.x - a.pos.x, next.z - a.pos.z);
          if (dxz < 0.65 && next.y > a.pos.y && next.y < a.pos.y + 2.05) {
            const head = next.y > a.pos.y + 1.6;
            this.damageAgent(a, head ? ar.dmg * 2 : ar.dmg, ar.team);
            if (ar.team === "player") this.hitFlash = 0.25;
            dead = true;
            break;
          }
        }
      }
      // player
      if (!dead && ar.team === "enemy" && this.respawnTimer <= 0) {
        const dxz = Math.hypot(next.x - this.pPos.x, next.z - this.pPos.z);
        if (dxz < 0.6 && next.y > this.pPos.y && next.y < this.pPos.y + PLAYER_HEIGHT + 0.2) {
          this.damagePlayer(ar.dmg);
          dead = true;
        }
      }
      // gate
      if (!dead && !this.gateDown) {
        const gb = this.gateBox;
        if (next.x > gb.minX && next.x < gb.maxX && next.z > gb.minZ && next.z < gb.maxZ && next.y < gb.top) {
          if (ar.team === "player") this.damageGate(ar.dmg * 0.45);
          dead = true;
        }
      }
      // world
      if (!dead) {
        if (next.y <= 0) dead = true;
        else {
          for (const c of this.colliders) {
            if (next.x > c.minX && next.x < c.maxX && next.z > c.minZ && next.z < c.maxZ && next.y < c.top && next.y > c.bottom) {
              dead = true;
              break;
            }
          }
        }
      }

      if (dead) {
        this.scene.remove(ar.mesh);
        ar.mesh.geometry.dispose();
        this.arrows.splice(i, 1);
      } else {
        ar.mesh.position.copy(next);
        ar.mesh.lookAt(next.clone().add(ar.vel));
      }
    }
  }

  drawMinimap() {
    const cv = this.minimap;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const S = cv.width;
    const scale = S / 200;
    const tx = (x: number) => S / 2 + x * scale;
    const tz = (z: number) => S / 2 + z * scale;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(15,20,15,0.65)";
    ctx.fillRect(0, 0, S, S);
    // castle outline
    ctx.strokeStyle = "#9a958c";
    ctx.lineWidth = 2;
    ctx.strokeRect(tx(-37), tz(-37), 74 * scale, 74 * scale);
    // gate
    ctx.strokeStyle = this.gateDown ? "#6ee06e" : "#e0a13a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tx(-5), tz(35.5));
    ctx.lineTo(tx(5), tz(35.5));
    ctx.stroke();
    // points
    for (const p of this.points) {
      ctx.beginPath();
      ctx.arc(tx(p.x), tz(p.z), 6, 0, Math.PI * 2);
      ctx.fillStyle = p.owner === "player" ? "#3f8ae0" : p.owner === "enemy" ? "#d03a3a" : "#e6cf4a";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "9px sans-serif";
      ctx.fillText(p.id, tx(p.x) - 3, tz(p.z) + 3);
    }
    for (const a of this.agents) {
      if (!a.alive) continue;
      ctx.beginPath();
      ctx.arc(tx(a.pos.x), tz(a.pos.z), 2, 0, Math.PI * 2);
      ctx.fillStyle = a.team === "player" ? "#7fc0ff" : "#ff8080";
      ctx.fill();
    }
    // player
    ctx.save();
    ctx.translate(tx(this.pPos.x), tz(this.pPos.z));
    ctx.rotate(-this.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  pushHud() {
    this.onHud({
      health: Math.max(0, Math.round(this.hp)),
      maxHealth: this.maxHp,
      weapon: this.weapon,
      arrows: this.arrowsLeft,
      draw: this.drawAmount,
      points: this.points.map((p) => ({ ...p })),
      allies: this.agents.filter((a) => a.alive && a.team === "player").length,
      enemies: this.agents.filter((a) => a.alive && a.team === "enemy").length,
      kills: this.kills,
      status: this.status,
      respawn: Math.max(0, this.respawnTimer),
      message: this.messageTimer > 0 ? this.message : "",
      hitFlash: this.hitFlash,
      damageFlash: this.damageFlash,
      time: this.elapsed,
      gateHp: Math.max(0, Math.round(this.gateHp)),
      gateMaxHp: this.gateMaxHp,
      gateNear: !this.gateDown && Math.hypot(this.pPos.x, this.pPos.z - 35.5) < 26,
      gateDown: this.gateDown,
      enemyWave: Math.max(0, this.waveTimer),
      enemyReserve: this.enemyReserve,
    });
  }

  loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    this.messageTimer = Math.max(0, this.messageTimer - dt);

    if (this.status === "playing") {
      this.updatePlayer(dt);
      for (const a of this.agents) this.updateAgent(a, dt);
      this.updateArrows(dt);
      this.updateGate(dt);
      this.updatePoints(dt);
      this.updateSpawns(dt);
    }

    for (const pm of this.pointMeshes) {
      pm.cloth.rotation.y = Math.sin(this.elapsed * 2 + pm.def.x) * 0.25;
    }

    this.renderer.render(this.scene, this.camera);

    this.hudAcc += dt;
    if (this.hudAcc > 0.08) {
      this.hudAcc = 0;
      this.pushHud();
      this.drawMinimap();
    }
  };

  dispose() {
    this.running = false;
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.removeEventListener("click", this.requestLock);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
