import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PIECE_SIZE } from "./cube";
import { COLS } from "./board";

// Real die/king meshes converted from the original Unity project's
// Assets/Prefabs/*.dae (COLLADA) via Blender, since this repo has no
// Unity/asset-pipeline dependency of its own. See README.md for the
// conversion steps if these ever need regenerating.
export interface CubeModelSet {
  cubWhite: THREE.Object3D;
  cubBlack: THREE.Object3D;
  kingWhite: THREE.Object3D;
  kingBlack: THREE.Object3D;
}

// These live in public/ (copied as-is, not bundled), so unlike imported
// modules they don't automatically pick up vite.config.ts's `base` --
// BASE_URL is Vite's own resolved value of that same setting (import.meta.env.BASE_URL, "/" in dev,
// "/duel/" in the production build), so this still works either way.
const MODEL_URLS: Record<keyof CubeModelSet, string> = {
  cubWhite: `${import.meta.env.BASE_URL}models/cubWhite.glb`,
  cubBlack: `${import.meta.env.BASE_URL}models/cubBlack.glb`,
  kingWhite: `${import.meta.env.BASE_URL}models/kingWhite.glb`,
  kingBlack: `${import.meta.env.BASE_URL}models/kingBlack.glb`,
};

const TARGET_SIZE = PIECE_SIZE;

// The converted die models don't happen to sit "value 1 up, value 2
// north" at their raw (identity) rotation -- verified by rendering each
// face straight-on: raw top=5, raw east=4, raw north=6. Since opposite
// faces sum to 7, that means (empirically) value 1 sits at raw south and
// value 2 sits at raw bottom. This one-time rotation re-aligns those two
// faces to the same canonical layout scene/cube.ts's procedural dice and
// orientationQuaternion() assume (top=1, north=2, east=3), baked into a
// wrapped child so it can't be clobbered by the per-piece game-state
// rotation main.ts applies to the returned object.
const RAW_VALUE_1_DIRECTION = new THREE.Vector3(0, 0, -1); // south
const RAW_VALUE_2_DIRECTION = new THREE.Vector3(0, -1, 0); // bottom

function twoVectorAlignment(
  sourceA: THREE.Vector3,
  targetA: THREE.Vector3,
  sourceB: THREE.Vector3,
  targetB: THREE.Vector3,
): THREE.Quaternion {
  const alignA = new THREE.Quaternion().setFromUnitVectors(sourceA, targetA);
  const rotatedB = sourceB.clone().applyQuaternion(alignA);
  const alignB = new THREE.Quaternion().setFromUnitVectors(rotatedB, targetB);
  return alignB.multiply(alignA);
}

const DIE_ORIENTATION_CORRECTION = twoVectorAlignment(
  RAW_VALUE_1_DIRECTION,
  new THREE.Vector3(0, 1, 0),
  RAW_VALUE_2_DIRECTION,
  new THREE.Vector3(0, 0, 1),
);

async function loadNormalized(
  loader: GLTFLoader,
  url: string,
  correction: THREE.Quaternion | null,
): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(url);
  const inner = gltf.scene;

  const rawBox = new THREE.Box3().setFromObject(inner);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  inner.scale.setScalar(TARGET_SIZE / Math.max(rawSize.x, rawSize.y, rawSize.z));

  if (correction) inner.quaternion.premultiply(correction);

  // Center on the wrapper's origin (not the base): the wrapper's rotation
  // is set per-piece from live game state (main.ts), and rotating anything
  // other than a pure spin around a base pivot swings the piece sideways
  // (or into the floor) instead of turning it in place. Grounding is done
  // separately, by main.ts positioning the wrapper's origin at
  // PIECE_HALF_HEIGHT above the tile instead of at 0.
  const finalBox = new THREE.Box3().setFromObject(inner);
  const center = finalBox.getCenter(new THREE.Vector3());
  inner.position.sub(center);

  inner.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Wrapped so callers can freely set rotation/position on the returned
  // object without disturbing the correction/normalization baked into `inner`.
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

/** Loads and places the board slab so it spans world x:[0,COLS], z:[0,ROWS]
 * with its top surface at y=0 (where piece bases rest). The raw model is a
 * thin yellow slab authored standing up like a wall (thin along its own
 * Z), with its long/short edges swapped relative to our 9-wide x 8-deep
 * board -- laid flat then spun 90 degrees so its long edge lines up with
 * the x axis (verified by comparing bounding-box aspect ratio to 9:8). */
export async function loadGameBoard(): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/GameBoard.glb`);
  const root = gltf.scene;

  const layFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const spinToAlign = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  root.quaternion.copy(spinToAlign.multiply(layFlat));

  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  root.scale.setScalar(COLS / rawSize.x);

  const scaledBox = new THREE.Box3().setFromObject(root);
  root.position.x -= scaledBox.min.x;
  root.position.z -= scaledBox.min.z;
  root.position.y -= scaledBox.max.y;

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.receiveShadow = true;
  });

  return root;
}

export async function loadCubeModels(): Promise<CubeModelSet> {
  const loader = new GLTFLoader();
  const [cubWhite, cubBlack, kingWhite, kingBlack] = await Promise.all([
    loadNormalized(loader, MODEL_URLS.cubWhite, DIE_ORIENTATION_CORRECTION),
    loadNormalized(loader, MODEL_URLS.cubBlack, DIE_ORIENTATION_CORRECTION),
    loadNormalized(loader, MODEL_URLS.kingWhite, null),
    loadNormalized(loader, MODEL_URLS.kingBlack, null),
  ]);
  return { cubWhite, cubBlack, kingWhite, kingBlack };
}
