import * as THREE from "three";
import type { CubeModelSet } from "./models";

// Every piece object (procedural or real model) is centered on its own
// origin -- that's what makes rotating it in place (around its own
// center) correct for any orientation, not just a spin around the
// vertical axis. main.ts places a piece's origin at PIECE_HALF_HEIGHT
// above a tile's ground so it still visually rests on the board.
export const PIECE_SIZE = 0.85;
export const PIECE_HALF_HEIGHT = PIECE_SIZE / 2;

// Canonical (identity-rotation) die layout: top=1, north(+z)=2, east(+x)=3,
// bottom(-y)=6, south(-z)=5, west(-x)=4. This mirrors
// backend/app/game/cube.py's Orientation.standard() exactly, so a mesh
// left at identity rotation always represents that same reference
// orientation, and rolling it via game/animate.ts's RollAnimation keeps
// the visible top face in sync with the server-authoritative value
// without ever reading the value back from the server mid-roll.
export const PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
};

function pipTexture(value: number, background: string, pip: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = pip;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, size - 12, size - 12);

  ctx.fillStyle = pip;
  const radius = size * 0.085;
  for (const [px, py] of PIP_LAYOUTS[value]) {
    ctx.beginPath();
    ctx.arc(px * size, py * size, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildPawnMesh(color: "white" | "black"): THREE.Mesh {
  const bg = color === "white" ? "#f2ede2" : "#2b2b2b";
  const pip = color === "white" ? "#2b2b2b" : "#f2ede2";
  const geometry = new THREE.BoxGeometry(PIECE_SIZE, PIECE_SIZE, PIECE_SIZE);
  // BoxGeometry material array order: +x, -x, +y, -y, +z, -z
  const materials = [
    new THREE.MeshStandardMaterial({ map: pipTexture(3, bg, pip) }), // east
    new THREE.MeshStandardMaterial({ map: pipTexture(4, bg, pip) }), // west
    new THREE.MeshStandardMaterial({ map: pipTexture(1, bg, pip) }), // top
    new THREE.MeshStandardMaterial({ map: pipTexture(6, bg, pip) }), // bottom
    new THREE.MeshStandardMaterial({ map: pipTexture(2, bg, pip) }), // north
    new THREE.MeshStandardMaterial({ map: pipTexture(5, bg, pip) }), // south
  ];
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  return mesh;
}

function buildKingMesh(color: "white" | "black"): THREE.Group {
  // The black king uses a lighter bronze (not nearly-black) so it stays
  // visible against the dark board tiles and background.
  const bodyColor = color === "white" ? 0xe8d48a : 0x8a6a2a;
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(PIECE_SIZE, PIECE_SIZE, PIECE_SIZE),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.3, roughness: 0.5 }),
  );
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.35, 4),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.5, roughness: 0.3 }),
  );
  crown.position.y = PIECE_HALF_HEIGHT + 0.175;
  crown.rotation.y = Math.PI / 4;

  group.add(body, crown);
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  return group;
}

/** Builds a piece mesh. When `models` (the real converted meshes -- see
 * scene/models.ts) is given, clones from those; otherwise falls back to
 * the procedural placeholder so the game still renders if the models
 * ever fail to load. */
export function buildCubeMesh(
  color: "white" | "black",
  isKing: boolean,
  models?: CubeModelSet,
): THREE.Object3D {
  if (models) {
    const key = isKing ? (color === "white" ? "kingWhite" : "kingBlack") : color === "white" ? "cubWhite" : "cubBlack";
    return models[key].clone(true);
  }
  return isKing ? buildKingMesh(color) : buildPawnMesh(color);
}

// Same canonical face->direction assignment as the pip textures above,
// expressed as unit vectors so a starting orientation can be turned into
// an actual mesh rotation (a freshly-placed die isn't necessarily showing
// a 1 on top -- see backend/app/game/board.py's starting layout).
const CANONICAL_DIRECTION: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
};

/** Any two adjacent die faces fully determine its orientation. Rotates the
 * canonical mesh so the face showing `topValue` points +Y (up) and the
 * face showing `northValue` points +Z (board "north"); the remaining
 * faces then land correctly too since a rotation preserves handedness and
 * the canonical layout already agrees with the backend's Orientation. */
export function orientationQuaternion(topValue: number, northValue: number): THREE.Quaternion {
  const worldUp = new THREE.Vector3(0, 1, 0);
  const worldNorth = new THREE.Vector3(0, 0, 1);

  const alignTop = new THREE.Quaternion().setFromUnitVectors(CANONICAL_DIRECTION[topValue], worldUp);
  const rotatedNorth = CANONICAL_DIRECTION[northValue].clone().applyQuaternion(alignTop);
  const alignNorth = new THREE.Quaternion().setFromUnitVectors(rotatedNorth, worldNorth);

  return alignNorth.multiply(alignTop);
}
