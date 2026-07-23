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
}

export interface StateMessage {
  type: "state";
  board: CubeView[];
  turn: "white" | "black";
  winner: "white" | "black" | null;
  selected: [number, number] | null;
  legalMoves: LegalMoveView[];
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage = StateMessage | ErrorMessage;

type ClientMessage =
  | { type: "new_game" }
  | { type: "select"; x: number; y: number }
  | { type: "move"; fromX: number; fromY: number; toX: number; toY: number; bend?: "x" | "y" };

// Port 8000 is a common default but was already occupied by an unrelated
// service on the dev machine this was built on -- 8010 sidesteps that.
const DEFAULT_URL = "ws://127.0.0.1:8010/ws/game";

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

  newGame(): void {
    this.send({ type: "new_game" });
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
