// Mirrors backend/app/game/board.py's Board.path_steps. This duplication
// is intentional (see project plan): the server is the sole authority on
// whether a move is *legal*, but the client needs the concrete step
// sequence purely to animate an already-approved move rolling across the
// board tile by tile.
import type { BendKind } from "../net/socket";

export type Direction = "north" | "south" | "east" | "west";

export function pathSteps(dx: number, dy: number, bend: BendKind): Direction[] {
  const xSteps: Direction[] = new Array(Math.abs(dx)).fill(dx > 0 ? "east" : "west");
  const ySteps: Direction[] = new Array(Math.abs(dy)).fill(dy > 0 ? "north" : "south");
  if (bend === "straight") return xSteps.length > 0 ? xSteps : ySteps;
  if (bend === "x_then_y") return [...xSteps, ...ySteps];
  return [...ySteps, ...xSteps];
}
