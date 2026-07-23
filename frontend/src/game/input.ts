import * as THREE from "three";
import { tileCenter } from "../scene/board";
import type { LegalMoveView } from "../net/socket";

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

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    tiles: () => THREE.Object3D[],
    onTileClick: (x: number, y: number, hitPoint: THREE.Vector3) => void,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.tiles = tiles;
    this.onTileClick = onTileClick;
    domElement.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

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
 * choose. If both orders are open, the player's click point decides --
 * whichever L-path corner it landed closer to -- mirroring
 * BoardManager.Direction's point-in-triangle test, simplified to a
 * nearest-corner check since the server re-validates the choice anyway. */
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

  const xThenYCorner = tileCenter(toX, fromY);
  const yThenXCorner = tileCenter(fromX, toY);
  const distToXThenY = hitPoint.distanceTo(xThenYCorner);
  const distToYThenX = hitPoint.distanceTo(yThenXCorner);
  return distToXThenY <= distToYThenX ? "x" : "y";
}
