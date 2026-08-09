# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Duel (Поединок) — a dice-chess web game. three.js frontend, Python
(FastAPI) backend as the *sole authoritative* rules engine, talking over a
small WebSocket JSON protocol. This is a from-scratch web rewrite of an
original Unity project; several source files reference the original
`Assets/Scripts/*.cs` files by name as the behavior spec being ported.

## Commands

**Backend** (Python 3.12+, from `backend/`):

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8010   # ws://127.0.0.1:8010/ws/game
pytest                                       # run all tests
pytest tests/test_engine.py::test_name       # run a single test
```

Port 8010 (not 8000) is deliberate.

**Frontend** (Node 20+, from `frontend/`):

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc typecheck + vite build
```

If the backend port changes, update `DEFAULT_URL` in `frontend/src/net/socket.ts`.

There is no frontend test suite; `npm run build`'s `tsc` step is the closest
thing to frontend verification.

## Architecture

### Backend is authoritative; frontend is a pure renderer

The backend (`backend/app/game/`) owns all rules and game state. The
frontend never computes legal moves or validates anything — it just
displays whatever `StateMessage` the server last sent and forwards clicks
as `select`/`move` messages. Keep it this way: any new rule logic belongs
in `backend/app/game/`, not in frontend code.

- `board.py` — `Board` (piece storage, `legal_moves`, path/bend validation).
  Core rule: a cube whose top face shows value T reaches squares at
  *exactly* Manhattan distance T (never less), optionally bending its path
  once by 90°. A move can be blocked in one bend direction and open in the
  other (see `_clear_bends`), and the two bend orders can even land the die
  in different final orientations (`resulting_cube`) — this is why
  `LegalMove.bends` and `LegalMove.resulting_values` are per-bend, not
  single values.
- `cube.py` — `Cube` + `Orientation`. A die's orientation is modeled as its
  six face values (opposite faces sum to 7), not Euler angles. Rolling one
  cell permutes these via `Orientation.rolled`. `Orientation.from_top_and_north`
  reconstructs a full orientation from just two faces including handling
  die *chirality* correctly (using a cross-product check) — getting this
  wrong silently desyncs the visual rotation from state after an east/west
  roll, since the frontend reconstructs mesh rotation from the same
  (top, north) pair independently.
- `engine.py` — `GameEngine`: turn order, `select`/`move` validation,
  applying moves, victory conditions (capture the king, or king reaches
  the opponent's home row square), and `maybe_ai_move()` hookup.
- `ai.py` — two independent AI strategies behind `choose_move(difficulty)`:
  `"easy"` (one-ply greedy heuristic + hang-check) and `"hard"` (minimax +
  alpha-beta, `_MINIMAX_DEPTH` plies). Both share `_all_moves`/`_simulate`;
  only scoring differs.
- `room.py` — in-memory `Room`: pairs two WebSocket connections as
  white/black, any further connections become spectators. No persistence,
  no reconnect-to-same-seat (a dropped connection just frees the seat).
- `api/ws.py` — two endpoints: `/ws/game` (one `GameEngine` per connection;
  hot-seat or vs-AI) and `/ws/room/{room_id}` (shared `GameEngine` per
  room, looked up in the module-level `_rooms` dict). The room endpoint
  additionally enforces that a `select`/`move` sender's assigned role
  matches whose turn it is — `GameEngine` itself only checks the cube's
  color, not which connection asked, so this check has to live here.

Every `StateMessage` carries `moveNumber` (incrementing counter) and
`lastMove` (the move just applied, if any) — this is what lets the client
animate a move regardless of who made it (human, AI, or a room opponent),
by noticing the counter went up, rather than only animating moves it
itself just requested. See `main.ts`'s `handleServerMessage`.

### Frontend structure

- `scene/` — three.js construction: board/cube/camera building,
  model-loading. `models.ts` normalizes loaded `.glb` meshes (uniform
  scale, centered origin) and applies a corrective rotation for the die
  model specifically (its raw orientation shows top=5/east=4/north=6,
  rotated once so identity matches the top=1/north=2/east=3 convention
  `cube.ts` and the backend's `Orientation.standard()` both assume).
- `game/` — `input.ts` (raycasting + `resolveBend`, which decides which
  bend direction a click maps to), `animate.ts` (roll animation), `path.ts`
  (expands a bend choice into concrete roll steps, mirroring
  `Board.path_steps` on the backend).
- `net/socket.ts` — thin WebSocket client; `DEFAULT_URL`/`roomSocketUrl`
  derive dev vs. prod URLs from `import.meta.env.DEV` and
  `window.location`, since prod is served behind nginx on the same origin
  under `/duel/`.
- `ui/hud.ts` — turn indicator, win banner, zoom slider, room share UI.

`vite.config.ts`'s `base: '/duel/'` (build-only) and `models.ts`'s
`import.meta.env.BASE_URL`-prefixed model URLs assume the production
deploy path `/duel/`; change both together if that path ever moves.

### 3D models

Piece meshes are converted from the original Unity project's `.dae` files
via headless Blender (`tools/convert_dae.py`) — regenerate only if the
source `.dae` files change; there's no other asset-pipeline dependency in
this repo.

### Deploy

`docker-compose.yml` + `deploy/nginx/` run nginx (TLS via Let's Encrypt) in
front of the backend, serving the built frontend at `/duel/` on port 443.
`deploy/nginx/*.conf.template` are envsubst templates, not static configs —
`NGINX_SERVER_NAMES`/`NGINX_CERT_NAME` (defaulted in `docker-compose.yml` to
this repo's original single-host setup, `letatel.com dicefight.online`) let a
second, independent host serve a different domain via its own gitignored
`.env` without touching the first host's behavior. See README.md's "Deploy"
section for the first-run cert-bootstrap sequence and renewal cron if you
need to touch deploy config.

## Known gaps

- Rooms: no reconnect-to-the-same-seat, no persistence across a restart,
  no lobby/matchmaking beyond "share a link".
- No menus/settings/localization/chat.
- Multiplayer beyond same-process rooms (e.g. horizontal scaling) is not
  built — `_rooms` is a plain in-process dict.
