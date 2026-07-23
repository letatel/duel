import * as THREE from "three";
import { PIP_LAYOUTS } from "./cube";
import { tileCenter } from "./board";
import type { BendKind, LegalMoveView } from "../net/socket";

// Port of the preview markers Assets/Scripts/BoardTurn.cs spawns over each
// reachable tile: for pawns, the marker shows what die value the moving
// cube will show on top after landing there. When a destination is only
// reachable one way (or both bend orders happen to leave the same face
// up), that's a single number; when the two bend orders leave *different*
// faces up, the marker is split diagonally in two, one number per order,
// matching whichever bend the player's hover/click resolves to (see
// game/input.ts's resolveBend). The king shows no number at all -- its
// value never changes, so there's nothing useful to preview (the
// original's marker index 0 is a plain "you can move here" indicator).
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

function buildMarkerTexture(values: Partial<Record<BendKind, number>>): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, CANVAS_SIZE - 4, CANVAS_SIZE - 4);

  const unique = [...new Set(Object.values(values))];
  const half = CANVAS_SIZE / 2;

  if (unique.length <= 1) {
    drawPipsCentered(ctx, unique[0], half, half, CANVAS_SIZE * 0.85);
  } else {
    // Diagonal split (top-right / bottom-left), one value's pips
    // recentered into each half -- not just a clipped full-size layout,
    // so each half still reads as a complete, legible face.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(CANVAS_SIZE, 0);
    ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE);
    ctx.closePath();
    ctx.clip();
    drawPipsCentered(ctx, values.x_then_y!, half * 1.5, half * 0.5, CANVAS_SIZE * 0.42);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, CANVAS_SIZE);
    ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE);
    ctx.closePath();
    ctx.clip();
    drawPipsCentered(ctx, values.y_then_x!, half * 0.5, half * 1.5, CANVAS_SIZE * 0.42);
    ctx.restore();

    ctx.strokeStyle = PIP_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class MoveHintView {
  readonly group = new THREE.Group();
  private active: THREE.Mesh[] = [];

  update(moves: LegalMoveView[], selectedIsKing: boolean): void {
    this.clear();
    if (selectedIsKing) return;

    for (const move of moves) {
      const geometry = new THREE.PlaneGeometry(MARKER_SIZE, MARKER_SIZE);
      const material = new THREE.MeshBasicMaterial({
        map: buildMarkerTexture(move.values),
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
