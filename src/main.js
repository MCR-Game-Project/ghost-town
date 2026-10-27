import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildTown } from "./town.js";
import { ORIENT, platToEnu, worldToPlat } from "./orient.js";

const params = new URLSearchParams(location.search);
const shot = params.get("shot");

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, shot ? 2 : 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe4c4a0);
scene.fog = new THREE.FogExp2(0xe4c4a0, 0.00036);
scene.environmentIntensity = 0.5;

const sunDir = new THREE.Vector3(-0.78, 0.36, 0.5).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3400, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color("#6e8eb8") },
      horizon: { value: new THREE.Color("#f0c08a") },
      haze: { value: new THREE.Color("#e7c3a0") },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 haze;
      uniform vec3 sunDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y * 0.9 + 0.02, 0.0, 1.0);
        vec3 col = mix(haze, horizon, smoothstep(0.0, 0.16, h));
        col = mix(col, top, pow(h, 0.72));
        float land = smoothstep(0.04, -0.12, dir.y);
        col = mix(col, vec3(0.55, 0.58, 0.36), land * 0.9);
        float cloud = sin(dir.x * 7.0 + dir.z * 3.5) * sin(dir.z * 5.5 - dir.x * 2.2);
        cloud = smoothstep(0.42, 0.9, cloud * 0.5 + 0.5);
        cloud *= smoothstep(0.12, 0.4, h);
        col = mix(col, vec3(0.97, 0.94, 0.88), cloud * 0.42);
        float disc = pow(max(dot(dir, sunDir), 0.0), 220.0);
        float glow = pow(max(dot(dir, sunDir), 0.0), 7.0);
        col += vec3(1.0, 0.9, 0.62) * disc * 1.2;
        col += vec3(1.0, 0.62, 0.32) * glow * 0.45;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }),
);
scene.add(sky);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.25, 9000);
camera.rotation.order = "YXZ";

scene.add(new THREE.HemisphereLight(0xffe0b8, 0x7a5a3c, 0.72));
const fill = new THREE.DirectionalLight(0xffd8b4, 0.32);
fill.position.set(120, 80, -40);
scene.add(fill);
const sun = new THREE.DirectionalLight(0xffc48a, 2.45);
sun.castShadow = true;
sun.shadow.mapSize.set(shot ? 4096 : 2048, shot ? 4096 : 2048);
sun.shadow.camera.near = 8;
sun.shadow.camera.far = 2200;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.22;
scene.add(sun, sun.target);

function bakeEnvironment() {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 14), sky.material);
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(40, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#8d623c", side: THREE.BackSide }),
  );
  env.add(dome, ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const map = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  scene.environment = map;
}
bakeEnvironment();

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.enableZoom = false;
orbit.maxPolarAngle = Math.PI / 2.08;
orbit.minDistance = 8;
orbit.maxDistance = 2400;
orbit.enabled = false;
orbit.target.set(-180, 0, 20);

const player = new THREE.Vector3(48, 0, -160);
let yaw = 1.05;
let pitch = -0.08;
let bob = 0;
let mode = "walk";
let colliders = [];
let picks = null;
let overviewLabels = null;
let town = null;
const keys = new Set();
const eye = 5.5;
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();

function lookVector() {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function vPlat(x, y, z) {
  const p = platToEnu(x, z);
  return new THREE.Vector3(p.x, y, p.z);
}

function applyWalkCamera() {
  camera.position.copy(vPlat(player.x, eye + bob, player.z));
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw + ORIENT;
  camera.rotation.x = pitch;
}

function blocked(x, z) {
  for (const c of colliders) {
    if (x > c.minX - 1.4 && x < c.maxX + 1.4 && z > c.minZ - 1.4 && z < c.maxZ + 1.4) return true;
  }
  return false;
}

function tryMove(nx, nz) {
  if (!blocked(nx, player.z)) player.x = nx;
  if (!blocked(player.x, nz)) player.z = nz;
}

function setShadow(size) {
  const cam = sun.shadow.camera;
  cam.left = -size;
  cam.right = size;
  cam.top = size;
  cam.bottom = -size;
  cam.updateProjectionMatrix();
}

const QUALITY = {
  fast: { dpr: 1, shadow: 1024, aniso: 2 },
  street: { dpr: 1.5, shadow: 2048, aniso: 8 },
  fine: { dpr: 2, shadow: 4096, aniso: 16 },
};

function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.street;
  const cap = renderer.capabilities.getMaxAnisotropy();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  sun.shadow.dispose();
  sun.shadow.needsUpdate = true;
  scene.traverse((obj) => {
    const list = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const mat of list) {
      for (const key of ["map", "normalMap", "roughnessMap"]) {
        const tex = mat[key];
        if (!tex) continue;
        tex.anisotropy = Math.min(q.aniso, cap);
        tex.needsUpdate = true;
      }
    }
  });
}

let lockExitReason = null;
let wasLocked = false;
let lockCooldown = false;

function menuIsOpen() {
  return !document.getElementById("help").hidden;
}

function syncHint() {
  const clean = document.body.classList.contains("clean");
  document.getElementById("walk-hint").hidden = clean || mode !== "walk" || menuIsOpen();
  document.getElementById("overview-hint").hidden = clean || mode !== "overview";
}

function showMenu(focusStart) {
  if (lockExitReason === "overview") return;
  if (document.pointerLockElement) {
    lockExitReason = "menu";
    document.exitPointerLock();
  }
  document.getElementById("help").hidden = false;
  if (focusStart) document.getElementById("menu-stop").hidden = false;
  syncHint();
  if (focusStart) document.getElementById("menu-stop").focus({ preventScroll: true });
}

function releaseToMenu() {
  lockCooldown = true;
  lockExitReason = "menu";
  keys.clear();
  showMenu(true);
  window.setTimeout(() => {
    lockCooldown = false;
  }, 400);
}

function enterOverview() {
  flight = null;
  mode = "overview";
  lockExitReason = "overview";
  if (document.pointerLockElement) document.exitPointerLock();
  else lockExitReason = null;
  canvas.classList.remove("looking");
  orbit.enabled = true;
  const focus = vPlat(-160, 0, 0);
  orbit.target.copy(focus);
  // Sit the camera due south of downtown so true north is toward the top of the picture.
  camera.position.set(focus.x, 980, focus.z + 820);
  orbit.update();
  document.getElementById("help").hidden = true;
  document.getElementById("mode").textContent = "Walk the streets";
  document.getElementById("where").textContent = "Looking down on Hail, Hurst, and the two railroads";
  document.getElementById("card").hidden = true;
  syncHint();
}

function enterWalk() {
  flight = null;
  mode = "walk";
  orbit.enabled = false;
  document.getElementById("mode").textContent = "See the whole town";
  applyWalkCamera();
  syncHint();
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _compassQuat = new THREE.Quaternion();
let flight = null;
let overviewClickTimer = 0;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function pointerNdc(event) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function groundUnderPointer(event) {
  raycaster.setFromCamera(pointerNdc(event), camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
  const plat = worldToPlat(hit.x, hit.z);
  plat.x = Math.max(-2200, Math.min(1700, plat.x));
  plat.z = Math.max(-1700, Math.min(1700, plat.z));
  return { world: vPlat(plat.x, 0, plat.z), plat };
}

function nearestClear(x, z) {
  if (!blocked(x, z)) return new THREE.Vector3(x, 0, z);
  for (let radius = 6; radius <= 96; radius += 6) {
    for (let step = 0; step < 10; step++) {
      const angle = (step / 10) * Math.PI * 2;
      const nx = x + Math.cos(angle) * radius;
      const nz = z + Math.sin(angle) * radius;
      if (!blocked(nx, nz)) return new THREE.Vector3(nx, 0, nz);
    }
  }
  return new THREE.Vector3(x, 0, z);
}

function startFlight(toPos, toTarget, seconds, land) {
  flight = {
    fromPos: camera.position.clone(),
    toPos,
    fromTarget: orbit.target.clone(),
    toTarget,
    started: performance.now(),
    seconds,
    land,
  };
  orbit.enabled = false;
}

function landAndWalk(stand, look) {
  player.set(stand.x, 0, stand.z);
  const dx = look.x - stand.x;
  const dz = look.z - stand.z;
  if (Math.hypot(dx, dz) > 1) yaw = Math.atan2(-dx, -dz);
  pitch = -0.06;
  bob = 0;
  flight = null;
  mode = "walk";
  orbit.enabled = false;
  document.getElementById("mode").textContent = "See the whole town";
  document.getElementById("help").hidden = true;
  applyWalkCamera();
  syncHint();
}

function flyToward(hit, allTheWay) {
  if (!hit || flight) return;
  const cam = camera.position.clone();
  if (allTheWay || cam.y < 26) {
    let dx = cam.x - hit.world.x;
    let dz = cam.z - hit.world.z;
    let len = Math.hypot(dx, dz);
    if (len < 8) {
      dx = 0;
      dz = 18;
      len = 18;
    }
    const standWorld = worldToPlat(hit.world.x + (dx / len) * 16, hit.world.z + (dz / len) * 16);
    const stand = nearestClear(standWorld.x, standWorld.z);
    startFlight(vPlat(stand.x, eye, stand.z), vPlat(hit.plat.x, 5, hit.plat.z), 1.15, {
      stand,
      look: hit.plat,
    });
    return;
  }
  const next = hit.world.clone().add(cam.clone().sub(hit.world).multiplyScalar(0.46));
  next.y = Math.max(next.y, 20);
  const delta = next.clone().sub(cam);
  startFlight(next, orbit.target.clone().add(delta), 0.72, null);
}

function zoomTowardPointer(event) {
  if (flight) return;
  const hit = groundUnderPointer(event);
  if (!hit) return;
  const cam = camera.position.clone();
  const dist = cam.distanceTo(hit.world);
  if (event.deltaY < 0 && (cam.y < 18 || dist < 24)) {
    flyToward(hit, true);
    return;
  }
  const factor = Math.exp(event.deltaY * 0.00115);
  const next = hit.world.clone().add(cam.clone().sub(hit.world).multiplyScalar(factor));
  if (next.y < 8) {
    flyToward(hit, true);
    return;
  }
  if (next.y > 1500) return;
  const delta = next.clone().sub(cam);
  camera.position.copy(next);
  orbit.target.add(delta);
  orbit.update();
}

function goToPlace(place) {
  player.set(place.x, 0, place.z);
  const dx = place.look[0] - place.x;
  const dz = place.look[1] - place.z;
  yaw = Math.atan2(-dx, -dz);
  pitch = -0.05;
  if (mode !== "walk") enterWalk();
  applyWalkCamera();
  const where = document.getElementById("where");
  if (place.blurb) where.textContent = place.blurb;
}

let dragging = false;
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  dragging = true;
});
window.addEventListener("pointerup", () => {
  dragging = false;
});
window.addEventListener("pointermove", (event) => {
  if (mode !== "walk") return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !dragging) return;
  const sens = locked ? 0.0022 : 0.0055;
  yaw -= event.movementX * sens;
  pitch = Math.max(-1.15, Math.min(1.05, pitch - event.movementY * sens));
});

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  canvas.classList.toggle("looking", locked);
  if (!locked && wasLocked && mode === "walk" && lockExitReason !== "overview") showMenu(true);
  wasLocked = locked;
  if (!locked) lockExitReason = null;
  syncHint();
});

function exitKey(event) {
  return event.code === "Escape" || event.code === "KeyQ" || event.code === "Tab";
}

window.addEventListener("keydown", (event) => {
  if (exitKey(event) && mode === "walk" && !menuIsOpen()) {
    if (event.code !== "Escape") event.preventDefault();
    releaseToMenu();
    return;
  }
  keys.add(event.code);
  if (event.code === "KeyM") {
    document.getElementById("help").hidden = true;
    if (mode === "walk") enterOverview();
    else enterWalk();
  }
}, true);
window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
  if (event.code === "Escape" && mode === "walk" && !menuIsOpen()) releaseToMenu();
}, true);

document.getElementById("start").addEventListener("click", () => {
  lockCooldown = false;
  document.getElementById("help").hidden = true;
  enterWalk();
  canvas.requestPointerLock?.();
});
document.getElementById("stop").addEventListener("click", () => {
  releaseToMenu();
});
document.getElementById("menu-stop").addEventListener("click", () => {
  releaseToMenu();
});
document.getElementById("overview").addEventListener("click", () => {
  document.getElementById("help").hidden = true;
  enterOverview();
});
document.getElementById("mode").addEventListener("click", () => {
  document.getElementById("help").hidden = true;
  if (mode === "walk") enterOverview();
  else enterWalk();
});
canvas.addEventListener("click", () => {
  if (lockCooldown || mode !== "walk" || menuIsOpen()) return;
  canvas.requestPointerLock?.();
});

let overviewPointer = null;
canvas.addEventListener("pointerdown", (event) => {
  if (mode !== "overview" || event.button !== 0) return;
  overviewPointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", (event) => {
  if (!overviewPointer || mode !== "overview") {
    overviewPointer = null;
    return;
  }
  const moved = Math.hypot(event.clientX - overviewPointer.x, event.clientY - overviewPointer.y);
  overviewPointer = null;
  if (moved > 7) return;
  const hit = groundUnderPointer(event);
  if (!hit) return;
  window.clearTimeout(overviewClickTimer);
  overviewClickTimer = window.setTimeout(() => flyToward(hit, false), 260);
});
canvas.addEventListener("dblclick", (event) => {
  if (mode !== "overview") return;
  event.preventDefault();
  window.clearTimeout(overviewClickTimer);
  flyToward(groundUnderPointer(event), true);
});
canvas.addEventListener(
  "wheel",
  (event) => {
    if (mode !== "overview") return;
    event.preventDefault();
    zoomTowardPointer(event);
  },
  { passive: false },
);

document.querySelectorAll("#touch button").forEach((btn) => {
  const code = btn.dataset.key;
  const down = (event) => {
    event.preventDefault();
    keys.add(code);
  };
  const up = (event) => {
    event.preventDefault();
    keys.delete(code);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
});

function describePlace() {
  if (!town) return;
  let cross = null;
  let para = null;
  let crossDist = Infinity;
  let paraDist = Infinity;
  for (const street of town.streets) {
    if (street.axis === "z") {
      const dist = Math.abs(player.x - street.at);
      if (dist < crossDist) {
        crossDist = dist;
        cross = street;
      }
    } else {
      const dist = Math.abs(player.z - street.at);
      if (dist < paraDist) {
        paraDist = dist;
        para = street;
      }
    }
  }
  const forward = lookVector();
  const facing =
    Math.abs(forward.x) > Math.abs(forward.z)
      ? forward.x > 0
        ? "toward Gridley and Galesburg"
        : "toward Hurst and Quincy"
      : forward.z > 0
        ? "toward East Main"
        : "toward West Main";
  const crossName = cross ? cross.name.replace(" Street", "") : "";
  const paraName = para ? para.name.replace(" Street", "") : "";
  let where = "Out on the prairie";
  if (crossDist < 42 && paraDist < 48) where = `Corner of ${crossName} and ${paraName}`;
  else if (paraDist <= crossDist) where = `${paraName} Street`;
  else where = `${crossName} Street`;
  document.getElementById("where").textContent = `${where}, looking ${facing}`;
}

function showBuilding() {
  const card = document.getElementById("card");
  if (!picks || mode !== "walk") {
    card.hidden = true;
    return;
  }
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(picks.children, false);
  const hit = hits.find((item) => item.distance < 90);
  if (!hit) {
    card.hidden = true;
    return;
  }
  const building = hit.object.userData.building;
  card.hidden = false;
  document.getElementById("card-tag").textContent = building.facade?.photoMatch
    ? "Matched to a historic photo"
    : building.confidence === "sourced"
      ? "Named in the old records"
      : "A stand-in for this block";
  document.getElementById("card-title").textContent = building.name;
  const stories = building.stories
    ? `${building.stories} ${building.stories > 1 ? "stories" : "story"}`
    : "";
  document.getElementById("card-use").textContent = [building.use, building.material, stories]
    .filter(Boolean)
    .join(" · ");
  document.getElementById("card-notes").textContent = building.notes || "";
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === "walk" && town) {
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 34 : 16;
    const forward = lookVector();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    let mx = 0;
    let mz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) {
      mx += forward.x;
      mz += forward.z;
    }
    if (keys.has("KeyS") || keys.has("ArrowDown")) {
      mx -= forward.x;
      mz -= forward.z;
    }
    if (keys.has("KeyD") || keys.has("ArrowRight")) {
      mx += right.x;
      mz += right.z;
    }
    if (keys.has("KeyA") || keys.has("ArrowLeft")) {
      mx -= right.x;
      mz -= right.z;
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      tryMove(player.x + (mx / len) * speed * dt, player.z + (mz / len) * speed * dt);
      bob = Math.sin(performance.now() * 0.012) * 0.1;
    } else {
      bob *= 0.85;
    }
    player.x = Math.max(-2300, Math.min(1300, player.x));
    player.z = Math.max(-1800, Math.min(1800, player.z));
    applyWalkCamera();
    const feet = vPlat(player.x, 0, player.z);
    sun.position.set(feet.x - 155, 72, feet.z + 100);
    sun.target.position.copy(feet);
    setShadow(260);
    describePlace();
    showBuilding();
  } else if (mode === "overview") {
    if (flight) {
      const u = easeInOut(Math.min(1, (performance.now() - flight.started) / (flight.seconds * 1000)));
      camera.position.lerpVectors(flight.fromPos, flight.toPos, u);
      orbit.target.lerpVectors(flight.fromTarget, flight.toTarget, u);
      if (u >= 1) {
        const land = flight.land;
        camera.position.copy(flight.toPos);
        orbit.target.copy(flight.toTarget);
        flight = null;
        if (land) landAndWalk(land.stand, land.look);
        else {
          orbit.enabled = true;
          orbit.update();
        }
      }
    } else {
      orbit.update();
    }
    const focus = orbit.target;
    sun.position.set(focus.x - 420, 190, focus.z + 180);
    sun.target.position.copy(focus);
    setShadow(1200);
  }
  if (overviewLabels) overviewLabels.visible = camera.position.y > 70;
  const compass = document.getElementById("compass");
  if (compass) {
    const show = mode === "overview";
    compass.hidden = !show;
    if (show) {
      const north = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(_compassQuat).invert());
      compass.querySelector(".rose").style.transform = `rotate(${Math.atan2(north.x, north.y)}rad)`;
    }
  }
  sky.position.copy(camera.position);
  sky.material.uniforms.sunDir.value.copy(sun.position).sub(camera.position).normalize();
  fill.position.set(sun.target.position.x + 160, sun.target.position.y + 90, sun.target.position.z - 50);
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function addNorthArrow(parent) {
  const group = new THREE.Group();
  group.name = "north-arrow";
  // Open ground west of Washington, beside Hail, then a step true north so it sits clear of the houses.
  const anchor = vPlat(40, 0, -1760);
  anchor.z -= 30;
  group.position.copy(anchor);

  const iron = new THREE.MeshLambertMaterial({ color: "#3a291c" });
  const brick = new THREE.MeshLambertMaterial({ color: "#7c342c" });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(16, 1.4, 120), iron);
  shaft.position.set(0, 1.2, -30);
  const head = new THREE.Mesh(new THREE.ConeGeometry(26, 52, 4), brick);
  head.rotation.x = -Math.PI / 2;
  head.position.set(0, 1.6, -116);
  group.add(shaft, head);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  g.fillStyle = "#f6ecd8";
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "#6d4b32";
  g.stroke();
  g.fillStyle = "#7c342c";
  g.font = "700 78px Georgia";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("N", 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  badge.position.set(0, 42, -150);
  badge.scale.set(54, 54, 1);
  group.add(badge);
  parent.add(group);
}

async function main() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/bushnell-1880.json`);
  if (!response.ok) throw new Error("The town file did not load.");
  town = await response.json();
  const townGroup = new THREE.Group();
  townGroup.name = "town";
  townGroup.rotation.y = ORIENT;
  scene.add(townGroup);
  const built = buildTown(town, townGroup);
  addNorthArrow(scene);
  colliders = built.colliders;
  picks = built.picks;
  overviewLabels = built.overviewLabels;

  const select = document.getElementById("places");
  for (const place of town.places) {
    const option = document.createElement("option");
    option.value = place.id;
    option.textContent = place.name;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const place = town.places.find((item) => item.id === select.value);
    if (place) goToPlace(place);
    document.getElementById("help").hidden = true;
    syncHint();
  });

  goToPlace(town.places[0]);
  const quality = document.getElementById("quality");
  quality.value = shot ? "fine" : "street";
  quality.addEventListener("change", () => applyQuality(quality.value));
  applyQuality(quality.value);
  document.getElementById("status").hidden = true;

  if (shot) {
    if (params.get("card") !== "1") document.body.classList.add("clean");
    document.getElementById("help").hidden = true;
    if (shot === "overhead") {
      enterOverview();
      const focus = vPlat(-200, 0, 0);
      orbit.target.copy(focus);
      camera.position.set(focus.x, 1280, focus.z + 980);
      orbit.update();
    } else if (shot === "overhead-500") {
      enterOverview();
      const focus = vPlat(200, 0, 0);
      orbit.target.copy(focus);
      camera.position.set(focus.x, 720, focus.z + 520);
      orbit.update();
    } else if (shot === "at") {
      goToPlace({
        x: Number(params.get("x")),
        z: Number(params.get("z")),
        look: [Number(params.get("lx")), Number(params.get("lz"))],
        blurb: params.get("blurb") || "",
      });
    } else {
      const named = town.places.find((place) => place.id === shot);
      goToPlace(named || town.places.find((place) => place.id === "hail-main"));
    }
    syncHint();
  }

  window.__townReady = true;
}

main().catch((error) => {
  const status = document.getElementById("status");
  status.hidden = false;
  status.textContent = `The town could not be opened. ${error.message}`;
  console.error(error);
});

requestAnimationFrame(frame);
