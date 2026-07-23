// Thin WebSocket client. The backend (see backend/app/api/ws.py) is the
// single source of truth for game rules; this just serializes/deserializes
// the small message protocol described in the project plan.

export interface CubeView {
  x: number;
  y: number;
  color: "white" | "black";
  isKing: boolean;
  value: number;
  north: number;
}

export type BendKind = "straight" | "x_then_y" | "y_then_x";

export interface LegalMoveView {
  x: number;
  y: number;
  bends: BendKind[];
  // Resulting top-face value per available bend -- lets the client
  // preview it on the tile before the move is made.
  values: Partial<Record<BendKind, number>>;
}

export interface LastMoveView {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  bend: BendKind;
}

export interface StateMessage {
  type: "state";
  board: CubeView[];
  turn: "white" | "black";
  winner: "white" | "black" | null;
  selected: [number, number] | null;
  legalMoves: LegalMoveView[];
  // Incremented on every applied move (human or AI) -- compare against the
  // previous state's value to notice a move happened, regardless of who
  // made it, and animate it via `lastMove`.
  moveNumber: number;
  lastMove: LastMoveView | null;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage = StateMessage | ErrorMessage;

type ClientMessage =
  | { type: "new_game"; vsAi?: boolean; difficulty?: "easy" | "hard" }
  | { type: "select"; x: number; y: number }
  | { type: "move"; fromX: number; fromY: number; toX: number; toY: number; bend?: "x" | "y" };

// In dev (`npm run dev`), the backend runs locally on its own port -- 8010
// sidesteps 8000, which was already occupied by an unrelated service on the
// dev machine this was built on. In production, nginx proxies /duel/ws/game
// on the same origin the page was served from (see deploy/nginx/nginx.conf),
// so the URL is derived from window.location instead of hardcoded.
const DEFAULT_URL = import.meta.env.DEV
  ? "ws://127.0.0.1:8010/ws/game"
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/duel/ws/game`;

export class GameSocket {
  private ws: WebSocket;
  private queue: ClientMessage[] = [];
  private onMessage: (msg: ServerMessage) => void;

  constructor(onMessage: (msg: ServerMessage) => void, url: string = DEFAULT_URL) {
    this.onMessage = onMessage;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => {
      for (const message of this.queue.splice(0)) {
        this.ws.send(JSON.stringify(message));
      }
    });
    this.ws.addEventListener("message", (event) => {
      this.onMessage(JSON.parse(event.data as string) as ServerMessage);
    });
  }

  newGame(vsAi = false, difficulty: "easy" | "hard" = "easy"): void {
    this.send({ type: "new_game", vsAi, difficulty });
  }

  select(x: number, y: number): void {
    this.send({ type: "select", x, y });
  }

  move(fromX: number, fromY: number, toX: number, toY: number, bend?: "x" | "y"): void {
    this.send({ type: "move", fromX, fromY, toX, toY, bend });
  }

  private send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.queue.push(message);
    }
  }
}
