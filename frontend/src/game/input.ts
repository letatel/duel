import * as THREE from "three";
import { bendSideAt } from "../scene/board";
import type { LegalMoveView } from "../net/socket";

// Touch has no separate "rotate the camera" button the way a mouse has a
// right button (see OrbitCameraController), so a single-finger touch has
// to serve both as "select this tile" and "drag to orbit". A tap (little
// movement, released quickly) is a selection; anything that moves more
// than this before release was a drag, not a tap.
const TAP_MOVE_THRESHOLD_PX = 10;
const TAP_MAX_DURATION_MS = 500;

/** Raycasts pointer clicks against the board's tile meshes and reports
 * which (boardX, boardY) tile was hit, plus the exact world hit point
 * (used to resolve an ambiguous bend direction -- see resolveBend). */
export class BoardInput {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly camera: THREE.Camera;
  private readonly domElement: HTMLElement;
  private readonly tiles: () => THREE.Object3D[];
  private readonly onTileClick: (x: number, y: number, hitPoint: THREE.Vector3) => void;
  private readonly isCameraGesturing: () => boolean;

  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    tiles: () => THREE.Object3D[],
    onTileClick: (x: number, y: number, hitPoint: THREE.Vector3) => void,
    isCameraGesturing: () => boolean = () => false,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.tiles = tiles;
    this.onTileClick = onTileClick;
    this.isCameraGesturing = isCameraGesturing;
    domElement.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    domElement.addEventListener("pointerup", (e) => this.handlePointerUp(e));
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.touchStartX = event.clientX;
      this.touchStartY = event.clientY;
      this.touchStartTime = performance.now();
      return;
    }
    if (event.button !== 0) return;
    this.raycastAndClick(event.clientX, event.clientY);
  }

  private handlePointerUp(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    const movedPx = Math.hypot(event.clientX - this.touchStartX, event.clientY - this.touchStartY);
    const elapsedMs = performance.now() - this.touchStartTime;
    if (movedPx > TAP_MOVE_THRESHOLD_PX || elapsedMs > TAP_MAX_DURATION_MS || this.isCameraGesturing()) return;
    this.raycastAndClick(event.clientX, event.clientY);
  }

  private raycastAndClick(clientX: number, clientY: number): void {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.tiles(), false);
    if (hits.length === 0) return;

    const hit = hits[0];
    const { boardX, boardY } = hit.object.userData as { boardX: number; boardY: number };
    this.onTileClick(boardX, boardY, hit.point);
  }
}

/** Picks which bend order to send with a move. If the destination only
 * has one valid order, or none (a straight move), there's nothing to
 * choose. If both orders are open, the player's click point within the
 * destination tile decides which -- whichever edge of the tile it's
 * closer to, where "closer" is judged relative to the tile's own center,
 * not raw distance to the (possibly many tiles away) corner square each
 * bend order's path actually turns at. That distinction matters: for any
 * move that isn't an exact 45-degree diagonal, one of those corner
 * squares is farther from the destination than the other by construction
 * (one is `dx` tiles out, the other `dy` tiles out), so comparing raw
 * distance to them picks the same bend almost everywhere on the tile
 * regardless of where you actually click -- the other option the preview
 * marker shows becomes unreachable in practice. Comparing local,
 * magnitude-independent position instead keeps both halves of the tile
 * meaningful. */
export function resolveBend(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  legalMove: LegalMoveView,
  hitPoint: THREE.Vector3,
): "x" | "y" | undefined {
  if (legalMove.bends.includes("straight")) return undefined;

  const hasXThenY = legalMove.bends.includes("x_then_y");
  const hasYThenX = legalMove.bends.includes("y_then_x");
  if (hasXThenY && !hasYThenX) return "x";
  if (hasYThenX && !hasXThenY) return "y";

  return bendSideAt(fromX, fromY, toX, toY, hitPoint.x, hitPoint.z);
}
