import * as THREE from "three";
import { PIP_LAYOUTS } from "./cube";
import { tileCenter, bendSideAt } from "./board";
import type { BendKind, LegalMoveView } from "../net/socket";

// Port of the preview markers Assets/Scripts/BoardTurn.cs spawns over each
// reachable tile: for pawns, the marker shows what die value the moving
// cube will show on top after landing there. When a destination is only
// reachable one way (or both bend orders happen to leave the same face
// up), that's a single number; when the two bend orders leave *different*
// faces up, the marker is split diagonally in two, one number per order,
// positioned to match whichever half of the tile game/input.ts's
// resolveBend would actually resolve to that bend (see bendSideAt) --
// otherwise the marker can promise a value that clicking anywhere
// reasonable on the tile can't actually produce. The king shows no
// number at all -- its value never changes, so there's nothing useful to
// preview (the original's marker index 0 is a plain "you can move here"
// indicator).
const MARKER_SIZE = 0.7;
const MARKER_Y = 0.03;
const BG_COLOR = "#f2ede2";
const PIP_COLOR = "#2b2b2b";
const CANVAS_SIZE = 256;

function drawPipsCentered(
  ctx: CanvasRenderingContext2D,
  value: number,
  centerX: number,
  centerY: number,
  boxSize: number,
): void {
  ctx.fillStyle = PIP_COLOR;
  const radius = boxSize * 0.09;
  for (const [px, py] of PIP_LAYOUTS[value]) {
    const x = centerX + (px - 0.5) * boxSize;
    const y = centerY + (py - 0.5) * boxSize;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function clipTriangle(ctx: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip();
}

function bendKind(side: "x" | "y"): BendKind {
  return side === "x" ? "x_then_y" : "y_then_x";
}

// World-space canvas corners, in the same u/w convention as bendSideAt
// (canvas x -> world +x; canvas y, top-to-bottom -> world -z to +z, since
// scene/board.ts's tiles/markers lie flat facing +Y with rotation.x =
// -PI/2, which sends local +Y/canvas-up to world -Z).
function cornerBend(fromX: number, fromY: number, toX: number, toY: number, canvasX: number, canvasY: number): "x" | "y" {
  const center = tileCenter(toX, toY);
  const u = canvasX / CANVAS_SIZE - 0.5;
  const w = canvasY / CANVAS_SIZE - 0.5;
  return bendSideAt(fromX, fromY, toX, toY, center.x + u, center.z + w);
}

function buildMarkerTexture(fromX: number, fromY: number, move: LegalMoveView): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, CANVAS_SIZE - 4, CANVAS_SIZE - 4);

  const unique = [...new Set(Object.values(move.values))];
  const half = CANVAS_SIZE / 2;

  if (unique.length <= 1) {
    drawPipsCentered(ctx, unique[0], half, half, CANVAS_SIZE * 0.85);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // The dividing diagonal always passes exactly through the two corners
  // where the two bend orders are equally "near" (see bendSideAt); the
  // other two corners are strictly on one side each and get one value.
  const tl = cornerBend(fromX, fromY, move.x, move.y, 0, 0);
  const tr = cornerBend(fromX, fromY, move.x, move.y, CANVAS_SIZE, 0);
  const bl = cornerBend(fromX, fromY, move.x, move.y, 0, CANVAS_SIZE);
  const br = cornerBend(fromX, fromY, move.x, move.y, CANVAS_SIZE, CANVAS_SIZE);

  if (tl === br) {
    // "\" divider (top-left to bottom-right); top-right and bottom-left
    // are the two distinct halves.
    ctx.save();
    clipTriangle(ctx, [
      [0, 0],
      [CANVAS_SIZE, 0],
      [CANVAS_SIZE, CANVAS_SIZE],
    ]);
    drawPipsCentered(ctx, move.values[bendKind(tr)]!, half * 1.5, half * 0.5, CANVAS_SIZE * 0.42);
    ctx.restore();

    ctx.save();
    clipTriangle(ctx, [
      [0, 0],
      [0, CANVAS_SIZE],
      [CANVAS_SIZE, CANVAS_SIZE],
    ]);
    drawPipsCentered(ctx, move.values[bendKind(bl)]!, half * 0.5, half * 1.5, CANVAS_SIZE * 0.42);
    ctx.restore();

    ctx.strokeStyle = PIP_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE);
    ctx.stroke();
  } else {
    // "/" divider (top-right to bottom-left); top-left and bottom-right
    // are the two distinct halves.
    ctx.save();
    clipTriangle(ctx, [
      [0, 0],
      [CANVAS_SIZE, 0],
      [0, CANVAS_SIZE],
    ]);
    drawPipsCentered(ctx, move.values[bendKind(tl)]!, half * 0.5, half * 0.5, CANVAS_SIZE * 0.42);
    ctx.restore();

    ctx.save();
    clipTriangle(ctx, [
      [CANVAS_SIZE, 0],
      [CANVAS_SIZE, CANVAS_SIZE],
      [0, CANVAS_SIZE],
    ]);
    drawPipsCentered(ctx, move.values[bendKind(br)]!, half * 1.5, half * 1.5, CANVAS_SIZE * 0.42);
    ctx.restore();

    ctx.strokeStyle = PIP_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(CANVAS_SIZE, 0);
    ctx.lineTo(0, CANVAS_SIZE);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class MoveHintView {
  readonly group = new THREE.Group();
  private active: THREE.Mesh[] = [];

  update(moves: LegalMoveView[], selectedFrom: [number, number] | null, selectedIsKing: boolean): void {
    this.clear();
    if (selectedIsKing || !selectedFrom) return;
    const [fromX, fromY] = selectedFrom;

    for (const move of moves) {
      const geometry = new THREE.PlaneGeometry(MARKER_SIZE, MARKER_SIZE);
      const material = new THREE.MeshBasicMaterial({
        map: buildMarkerTexture(fromX, fromY, move),
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      const center = tileCenter(move.x, move.y);
      mesh.position.set(center.x, MARKER_Y, center.z);
      this.group.add(mesh);
      this.active.push(mesh);
    }
  }

  private clear(): void {
    for (const mesh of this.active) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.active = [];
  }
}
