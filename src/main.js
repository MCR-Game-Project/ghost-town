import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildTown } from "./town.js";

const params = new URLSearchParams(location.search);
const shot = params.get("shot");

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, shot ? 2 : 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd7c3a2);
scene.fog = new THREE.FogExp2(0xd9c4a4, 0.00028);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3400, 28, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color("#6d92c2") },
      horizon: { value: new THREE.Color("#f2d4aa") },
      sunDir: { value: new THREE.Vector3(-0.85, 0.42, 0.2).normalize() },
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
      uniform vec3 sunDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y * 0.5 + 0.12, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.9));
        float disc = pow(max(dot(dir, sunDir), 0.0), 90.0);
        float glow = pow(max(dot(dir, sunDir), 0.0), 6.0);
        col += vec3(1.0, 0.86, 0.55) * disc;
        col += vec3(1.0, 0.72, 0.4) * glow * 0.28;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }),
);
scene.add(sky);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.25, 9000);
camera.rotation.order = "YXZ";

scene.add(new THREE.HemisphereLight(0xffe8c8, 0x6d5438, 0.62));
const sun = new THREE.DirectionalLight(0xffd7a8, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 1800;
sun.shadow.bias = -0.001;
sun.shadow.normalBias = 0.45;
scene.add(sun, sun.target);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI / 2.08;
orbit.minDistance = 30;
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
let town = null;
const keys = new Set();
const eye = 5.5;
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();

function lookVector() {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function applyWalkCamera() {
  camera.position.set(player.x, eye + bob, player.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
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

function enterOverview() {
  mode = "overview";
  if (document.pointerLockElement) document.exitPointerLock();
  canvas.classList.remove("looking");
  orbit.enabled = true;
  orbit.target.set(-160, 0, 20);
  camera.position.set(220, 860, 620);
  orbit.update();
  document.getElementById("mode").textContent = "Walk the streets";
  document.getElementById("where").textContent = "Looking down on Hail, Hurst, and the two railroads";
  document.getElementById("card").hidden = true;
}

function enterWalk() {
  mode = "walk";
  orbit.enabled = false;
  document.getElementById("mode").textContent = "See the whole town";
  applyWalkCamera();
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
  canvas.classList.toggle("looking", document.pointerLockElement === canvas);
});

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "KeyM") {
    document.getElementById("help").hidden = true;
    if (mode === "walk") enterOverview();
    else enterWalk();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

document.getElementById("start").addEventListener("click", () => {
  document.getElementById("help").hidden = true;
  enterWalk();
  canvas.requestPointerLock?.();
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
  if (mode === "walk" && document.getElementById("help").hidden) canvas.requestPointerLock?.();
});

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
        ? "toward West Main and the depot side"
        : "toward East Main";
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
  document.getElementById("card-tag").textContent =
    building.confidence === "sourced" ? "Named in the old records" : "A stand-in for this block";
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
    sun.position.set(player.x - 90, 120, player.z + 36);
    sun.target.position.set(player.x, 0, player.z);
    setShadow(150);
    describePlace();
    showBuilding();
  } else if (mode === "overview") {
    orbit.update();
    sun.position.set(orbit.target.x - 260, 340, orbit.target.z + 90);
    sun.target.position.copy(orbit.target);
    setShadow(900);
  }
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function main() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/bushnell-1880.json`);
  if (!response.ok) throw new Error("The town file did not load.");
  town = await response.json();
  const built = buildTown(town, scene);
  colliders = built.colliders;
  picks = built.picks;

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
  });

  goToPlace(town.places[0]);
  document.getElementById("status").hidden = true;

  if (shot) {
    document.body.classList.add("clean");
    document.getElementById("help").hidden = true;
    if (shot === "overhead") {
      enterOverview();
      camera.position.set(80, 1020, 700);
      orbit.target.set(-180, 0, 30);
      orbit.update();
    } else if (shot === "crossing") {
      goToPlace(town.places.find((place) => place.id === "crossing"));
    } else if (shot === "west-main") {
      goToPlace(town.places.find((place) => place.id === "west-main"));
    } else {
      goToPlace(town.places.find((place) => place.id === "hail-main"));
    }
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
