import * as THREE from "three";
import "./style.css";

import { BoardView, tileCenter } from "./scene/board";
import { MoveHintView } from "./scene/moveHints";
import { buildCubeMesh, orientationQuaternion, PIECE_HALF_HEIGHT } from "./scene/cube";
import { loadCubeModels, loadGameBoard } from "./scene/models";
import { OrbitCameraController, ZOOM_MIN } from "./scene/camera";
import { GameSocket, roomSocketUrl, type RoomRole, type ServerMessage, type StateMessage } from "./net/socket";
import { BoardInput, resolveBend } from "./game/input";
import { RollAnimation } from "./game/animate";
import { pathSteps } from "./game/path";
import { Hud } from "./ui/hud";

const appRoot = document.querySelector<HTMLDivElement>("#app")!;
appRoot.innerHTML = `<div id="viewport"></div><div id="hud-root"></div>`;
const viewport = appRoot.querySelector<HTMLDivElement>("#viewport")!;
const hudRoot = appRoot.querySelector<HTMLDivElement>("#hud-root")!;

// A silently-failed model/board load leaves nothing but the background
// color on screen, with no way to see *why* on a phone that isn't hooked
// up to remote devtools -- surface it directly instead.
let fatalErrorEl: HTMLPreElement | null = null;
function showFatalError(message: string): void {
  if (!fatalErrorEl) {
    fatalErrorEl = document.createElement("pre");
    fatalErrorEl.id = "fatal-error";
    fatalErrorEl.style.cssText =
      "position:fixed;inset:auto 0 0 0;margin:0;padding:10px;background:#a02828;color:#fff;" +
      "font:11px/1.4 monospace;white-space:pre-wrap;word-break:break-word;z-index:9999;" +
      "max-height:40vh;overflow:auto;";
    document.body.appendChild(fatalErrorEl);
  }
  fatalErrorEl.textContent += message + "\n";
}
window.addEventListener("error", (e) => showFatalError(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => showFatalError(`unhandled rejection: ${String(e.reason)}`));

// A room ID in the URL means "join this shared multiplayer game" instead
// of the default local hot-seat/vs-AI session -- see backend/app/api/ws.py's
// /ws/room/{id}. Generating a short random one client-side and navigating
// there (see the "Play online" button below) is enough to create a room;
// the server makes it real on first connection.
const roomId = new URLSearchParams(window.location.search).get("room");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function navigateToNewRoom(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("room", generateRoomId());
  window.location.href = url.toString();
}

// ── Scene setup ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f24);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
const boardCenter = new THREE.Vector3(4.5, 0, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

// Set once Hud exists (see start() below) so a resize/rotation can keep
// its zoom slider's range in sync with the camera's aspect-dependent
// zoomed-out limit -- see OrbitCameraController.refitToViewport().
let onViewportChanged: (() => void) | null = null;

function handleViewportChange(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cameraController.refitToViewport();
  onViewportChanged?.();
}
window.addEventListener("resize", handleViewportChange);
// Some mobile browsers haven't updated innerWidth/innerHeight yet at the
// moment "orientationchange" fires -- resize almost always follows right
// behind it, but this catches the rare case it doesn't.
window.addEventListener("orientationchange", () => setTimeout(handleViewportChange, 100));

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
// Directly overhead so shadows fall straight down under each piece,
// rather than off to one side.
sun.position.set(boardCenter.x, 12, boardCenter.z);
sun.target.position.copy(boardCenter);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
// Tight frustum around the 9x8 board (instead of the default +/-5),
// so the shadow map isn't wasted on empty space.
const shadowSpan = 6.5;
sun.shadow.camera.left = -shadowSpan;
sun.shadow.camera.right = shadowSpan;
sun.shadow.camera.top = shadowSpan;
sun.shadow.camera.bottom = -shadowSpan;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 20;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

const board = new BoardView();
scene.add(board.group);

const moveHints = new MoveHintView();
scene.add(moveHints.group);

const cameraController = new OrbitCameraController(camera, boardCenter, renderer.domElement);

// Everything below depends on the real piece models being loaded first,
// so the very first board render already shows them (no placeholder ->
// real-model flicker on startup).
async function start(): Promise<void> {
  const [cubeModels, gameBoard] = await Promise.all([loadCubeModels(), loadGameBoard()]);
  scene.add(gameBoard);

  // ── Cube bookkeeping ─────────────────────────────────────────────────
  interface CubeEntry {
    object: THREE.Object3D;
    color: "white" | "black";
    isKing: boolean;
  }

  const cubesByPosition = new Map<string, CubeEntry>();
  const posKey = (x: number, y: number): string => `${x},${y}`;

  function rebuildAllCubes(state: StateMessage): void {
    for (const entry of cubesByPosition.values()) scene.remove(entry.object);
    cubesByPosition.clear();

    for (const c of state.board) {
      const object = buildCubeMesh(c.color, c.isKing, cubeModels);
      const center = tileCenter(c.x, c.y);
      object.position.set(center.x, PIECE_HALF_HEIGHT, center.z);
      object.quaternion.copy(orientationQuaternion(c.value, c.north));
      scene.add(object);
      cubesByPosition.set(posKey(c.x, c.y), { object, color: c.color, isKing: c.isKing });
    }
  }

  // ── Networking / game state ──────────────────────────────────────────
  let latestState: StateMessage | null = null;
  // Tracks the last move we've already animated, by the server's
  // move-count -- not our own memory of what we last requested, since an
  // AI move (or a room opponent's move) arrives unprompted and still
  // needs to be animated the same way a move we ourselves requested would.
  let lastAnimatedMoveNumber = 0;
  let awaitingFullRebuild = true;
  let vsAi = false;
  // Which seat this connection holds in a room (null outside room mode).
  // Unlike vsAi's local hot-seat flip, a room player is a different
  // physical device on each side and should just always look at the
  // board from their own side -- set once, the first time it's known.
  let myRole: RoomRole | null = null;
  let cameraFixedForRole = false;
  const activeAnimations: RollAnimation[] = [];

  function applyHighlights(state: StateMessage): void {
    board.clearHighlights();
    let selectedIsKing = false;
    if (state.selected) {
      const [sx, sy] = state.selected;
      board.highlightSelected(sx, sy);
      selectedIsKing = cubesByPosition.get(posKey(sx, sy))?.isKing ?? false;
    }
    for (const move of state.legalMoves) {
      board.highlightMove(move.x, move.y);
    }
    moveHints.update(state.legalMoves, state.selected, selectedIsKing, (x, y) => cubesByPosition.has(posKey(x, y)));
  }

  function handleServerMessage(msg: ServerMessage): void {
    if (msg.type === "error") {
      hud.showError(msg.message);
      return;
    }

    const state = msg;

    if (awaitingFullRebuild) {
      rebuildAllCubes(state);
      awaitingFullRebuild = false;
      lastAnimatedMoveNumber = state.moveNumber;
    } else if (state.moveNumber > lastAnimatedMoveNumber && state.lastMove) {
      const { fromX, fromY, toX, toY, bend } = state.lastMove;
      const moving = cubesByPosition.get(posKey(fromX, fromY));
      const captured = cubesByPosition.get(posKey(toX, toY));

      if (captured) {
        scene.remove(captured.object);
        cubesByPosition.delete(posKey(toX, toY));
      }
      if (moving) {
        cubesByPosition.delete(posKey(fromX, fromY));
        cubesByPosition.set(posKey(toX, toY), moving);
        const steps = pathSteps(toX - fromX, toY - fromY, bend);
        activeAnimations.push(new RollAnimation(moving.object, steps));
      }
      lastAnimatedMoveNumber = state.moveNumber;
    }

    if (state.role) myRole = state.role;

    if (!cameraFixedForRole && (myRole === "white" || myRole === "black")) {
      if (myRole === "white") cameraController.setWhiteTurn();
      else cameraController.setBlackTurn();
      cameraFixedForRole = true;
    }

    // Against the AI the human always plays white and watches from the
    // same side throughout; a room player is fixed to their own side
    // above. Only hot-seat (two humans sharing one screen) and room
    // spectators (watching over either shoulder in turn) need the camera
    // to flip to face whoever's turn it is.
    const followsTurn = !vsAi && myRole !== "white" && myRole !== "black";
    if (followsTurn && (!latestState || latestState.turn !== state.turn)) {
      if (state.turn === "white") cameraController.setWhiteTurn();
      else cameraController.setBlackTurn();
    }

    latestState = state;
    applyHighlights(state);
    hud.setTurn(state.turn, vsAi);
    hud.setRoomStatus(state.role, state.bothPlayersPresent);
    hud.setWinner(state.winner);
  }

  const socket = new GameSocket(handleServerMessage, roomId ? roomSocketUrl(roomId) : undefined);

  // ── Input ────────────────────────────────────────────────────────────
  new BoardInput(
    camera,
    renderer.domElement,
    () => board.raycastTargets,
    (x, y, hitPoint) => {
      if (!latestState || latestState.winner || activeAnimations.length > 0) return;
      if (vsAi && latestState.turn === "black") return; // AI's turn
      if (myRole === "spectator") return;
      if ((myRole === "white" || myRole === "black") && latestState.turn !== myRole) return;

      const legalMove = latestState.legalMoves.find((m) => m.x === x && m.y === y);
      if (latestState.selected && legalMove) {
        const [fromX, fromY] = latestState.selected;
        const bendChoice = resolveBend(fromX, fromY, x, y, legalMove, hitPoint);
        const bend = legalMove.bends.includes("straight") ? undefined : bendChoice;
        socket.move(fromX, fromY, x, y, bend);
      } else {
        socket.select(x, y);
      }
    },
    () => cameraController.isPinching(),
  );

  const hud = new Hud(
    hudRoot,
    (newVsAi, difficulty) => {
      vsAi = newVsAi;
      awaitingFullRebuild = true;
      if (!roomId) cameraController.setWhiteTurn(); // a fresh hot-seat/vs-AI game always starts on white
      socket.newGame(vsAi, difficulty);
    },
    () => navigateToNewRoom(),
    {
      min: ZOOM_MIN,
      max: cameraController.getMaxDistance(),
      initial: cameraController.getDistance(),
      onChange: (distance) => cameraController.setDistance(distance),
    },
    roomId ? { shareUrl: window.location.href } : undefined,
  );
  onViewportChanged = () => hud.setZoomRange(ZOOM_MIN, cameraController.getMaxDistance());

  // ── Render loop ──────────────────────────────────────────────────────
  const clock = new THREE.Clock();

  function tick(): void {
    const deltaSeconds = clock.getDelta();
    cameraController.update(deltaSeconds);
    hud.setZoomDistance(cameraController.getDistance());

    for (let i = activeAnimations.length - 1; i >= 0; i--) {
      activeAnimations[i].update(deltaSeconds * 1000);
      if (activeAnimations[i].finished) activeAnimations.splice(i, 1);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  tick();
}

start();
