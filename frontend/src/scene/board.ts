import * as THREE from "three";

// Same 9x8 grid and tile-center convention as the backend/original Unity
// board (Assets/Scripts/BoardManager.cs GetTileCenter: TILE_SIZE=1,
// TILE_OFFSET=0.5).
export const COLS = 9;
export const ROWS = 8;

const HIGHLIGHT_SELECTED = 0x4fa8ff;
const HIGHLIGHT_MOVE = 0x6fd07a;
const HIGHLIGHT_OPACITY = 0.55;

// The real GameBoard model's 9x8 grid turned out to be a physical relief
// -- tiles recessed slightly, with the dividers between them standing
// proud -- not a flat painted line or texture, and too subtle to read
// once converted at this scale/light. Reproduced here as actual raised
// ridges along each grid boundary (rather than flat lines drawn on top),
// so they genuinely catch light and cast a sliver of shadow onto the
// recessed tile floor like the original. The tile floor is the real
// board model's surface at y=0 (where piece bases already rest); the
// ridges rise above that.
const RIDGE_COLOR = 0xb0b026;
const RIDGE_WIDTH = 0.05;
const RIDGE_HEIGHT = 0.045;

export function tileCenter(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, 0, y + 0.5);
}

export interface BoardTile {
  x: number;
  y: number;
  mesh: THREE.Mesh;
}

/** The visible board surface is the real GameBoard model (see
 * scene/models.ts, added to the scene separately in main.ts) plus the
 * raised grid ridges built here. This class also builds the invisible
 * per-tile raycast targets used for click detection and the
 * selected/legal-move highlight overlay -- kept invisible (opacity 0,
 * not visible=false, since Raycaster skips invisible objects) until a
 * highlight needs to show through them. */
export class BoardView {
  readonly group = new THREE.Group();
  readonly tiles: BoardTile[] = [];
  private readonly byKey = new Map<string, BoardTile>();

  constructor() {
    this.group.add(buildGridRidges());

    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        const geometry = new THREE.BoxGeometry(0.98, 0.02, 0.98);
        const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
        const mesh = new THREE.Mesh(geometry, material);
        const center = tileCenter(x, y);
        mesh.position.set(center.x, 0.011, center.z);
        mesh.userData = { boardX: x, boardY: y };

        const tile: BoardTile = { x, y, mesh };
        this.tiles.push(tile);
        this.byKey.set(key(x, y), tile);
        this.group.add(mesh);
      }
    }
  }

  get raycastTargets(): THREE.Object3D[] {
    return this.tiles.map((t) => t.mesh);
  }

  clearHighlights(): void {
    for (const tile of this.tiles) {
      (tile.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  highlightSelected(x: number, y: number): void {
    this.paint(x, y, HIGHLIGHT_SELECTED);
  }

  highlightMove(x: number, y: number): void {
    this.paint(x, y, HIGHLIGHT_MOVE);
  }

  private paint(x: number, y: number, color: number): void {
    const tile = this.byKey.get(key(x, y));
    if (!tile) return;
    const material = tile.mesh.material as THREE.MeshBasicMaterial;
    material.color.set(color);
    material.opacity = HIGHLIGHT_OPACITY;
  }
}

function buildGridRidges(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: RIDGE_COLOR, roughness: 0.7 });

  for (let x = 0; x <= COLS; x++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(RIDGE_WIDTH, RIDGE_HEIGHT, ROWS), material);
    ridge.position.set(x, RIDGE_HEIGHT / 2, ROWS / 2);
    ridge.castShadow = true;
    ridge.receiveShadow = true;
    group.add(ridge);
  }
  for (let y = 0; y <= ROWS; y++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(COLS, RIDGE_HEIGHT, RIDGE_WIDTH), material);
    ridge.position.set(COLS / 2, RIDGE_HEIGHT / 2, y);
    ridge.castShadow = true;
    ridge.receiveShadow = true;
    group.add(ridge);
  }

  return group;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}
