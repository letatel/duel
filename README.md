# Duel (Поединок) — web rewrite

A dice-chess web port of the original Unity game: three.js frontend,
Python (FastAPI) backend as the authoritative rules engine over WebSocket.

Current scope: local hot-seat only (see the project plan for the
multiplayer/AI phases this is designed to grow into without an engine
rewrite).

## Run it

**Backend** (Python 3.12+):

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8010
```

Runs on `ws://127.0.0.1:8010/ws/game`. Port 8010 (not the default 8000) is
deliberate — pick your own if it's also taken.

Tests: `pytest` (from `backend/`, with the venv active).

**Frontend** (Node 20+):

```sh
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:5173`. If you change the backend port, update
`DEFAULT_URL` in `frontend/src/net/socket.ts`.

## Layout

```
backend/app/game/    board + cube rules engine (pure Python, no I/O)
backend/app/api/     WebSocket endpoint wiring the engine to clients
backend/tests/       pytest coverage for move generation and victory rules
frontend/src/scene/  three.js board/cube/camera/model-loading construction
frontend/src/game/   input (raycasting + bend resolution) and roll animation
frontend/src/net/    WebSocket client
frontend/src/ui/     HUD (turn indicator, win banner, zoom slider)
frontend/public/models/  real piece meshes, converted from the original
                         Unity project's Assets/Prefabs/*.dae
```

## 3D models

Piece meshes (`frontend/public/models/*.glb`) are converted from the original
Unity project's `Assets/Prefabs/{cubWhite,cubBlack,kingWhite,kingBlack}.dae`
via headless Blender, since this repo has no Unity/asset-pipeline dependency
of its own:

```sh
blender --background --python tools/convert_dae.py -- <input.dae> <output.glb>
```

(`tools/convert_dae.py` — regenerate if the source `.dae` files ever change).
`scene/models.ts` then normalizes each piece on load (uniform scale to fit a
tile, centered on its own origin so main.ts can rotate it in place around
its center rather than its base) and applies a one-time corrective rotation
for the dice specifically: the converted mesh's raw/identity orientation
doesn't happen to show 1-up — empirically it's top=5, east=4, north=6 — so
it's rotated once so identity matches the same top=1/north=2/east=3
convention `scene/cube.ts`'s `orientationQuaternion` and the backend's
`Orientation.standard()` assume. The king model needed no such correction
(every face carries the same king emblem).

`GameBoard.glb` (the board itself) is also real, loaded by
`loadGameBoard()` in the same file. Its raw export is a thin yellow slab
authored standing up like a wall, with its edges swapped relative to our
9-wide x 8-deep grid — laid flat then spun 90 degrees, scaled so its
bounding box matches the 9:8 aspect ratio (confirmed empirically: the raw
model's own width:depth ratio is already ~8:9). The 9x8 grid pattern
visible in the original turned out to be carved into the mesh's geometry
(bevels) rather than a separate material or texture — too subtle to read
under normal lighting once converted — so `scene/board.ts` draws its own
thin grid lines on top to reproduce that look. `scene/board.ts`'s
per-tile meshes are now purely invisible raycast targets and
selected/legal-move highlight overlays (opacity 0 by default, never
`visible = false` since `Raycaster` skips invisible objects), sitting a
hair above the real board's surface.

## Known gaps / follow-ups

- Multiplayer, AI opponent, menus/settings/localization/chat are not
  built yet — see the project plan for how they layer on top of this
  without changing `backend/app/game/`.
