# Duel (Поединок) — web rewrite

A dice-chess web game: three.js frontend,
Python (FastAPI) backend as the authoritative rules engine over WebSocket.

Local hot-seat, or against a simple built-in AI (human plays white; see
"AI opponent" below). Multiplayer over the network is not built yet — see
the project plan for how it layers on top of this without an engine
rewrite.

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
model's own width:depth ratio is already ~8:9). The 9x8 relief grid visible
in the original (tiles recessed, dividers standing proud) turned out to be
carved into the mesh's own geometry rather than a separate material or
texture — too subtle to read under normal lighting once converted — so
`scene/board.ts` builds its own raised ridge geometry along each grid
boundary (real 3D boxes catching light/shadow, not flat painted lines) to
reproduce that look on top of the real board's flat yellow surface.
`scene/board.ts`'s per-tile meshes are purely invisible raycast targets and
selected/legal-move highlight overlays (opacity 0 by default, never
`visible = false` since `Raycaster` skips invisible objects).

## Move-value preview

Selecting a pawn previews, per reachable tile, what value it'll show on top
after landing there — the same die-face marker the original shows
(`Assets/Scripts/BoardTurn.cs`). `Board.legal_moves` (`backend/app/game/board.py`)
computes this per bend order via `Board.resulting_cube` (shared with
`GameEngine.move`, which actually executes it) and ships it to the client as
`LegalMoveView.values`. When a tile is only reachable one way, or both bend
orders happen to leave the same face up, `scene/moveHints.ts` draws one
number; when the two orders leave *different* faces up, it draws a
diagonally-split marker, one number per order (matching whichever bend
`game/input.ts`'s `resolveBend` will actually send). The king shows no
number — its value is always 1, so there's nothing to preview.

## AI opponent

`backend/app/game/ai.py`'s `choose_move` is a deliberately simple one-ply
heuristic (prefer capturing, prefer capturing the king outright, prefer
advancing pawns and the center columns, avoid moves that leave the mover
immediately recapturable) — no search tree, no opening book. Clicking
"Play vs AI" in the HUD sends `new_game` with `vsAi: true`; the engine then
always gives the AI black (`GameEngine.ai_color`), and after every human
move, `ws.py` calls `GameEngine.maybe_ai_move()` and — if it moved — sends
a second `state` message a beat later (`AI_REPLY_DELAY_SECONDS`) so the
human's own move finishes animating first.

This is also what `StateMessage.moveNumber`/`lastMove` are for: the client
used to animate a move by remembering what *it* had just requested, which
breaks for a move the server made on its own initiative. Now every `state`
message carries the move that was just applied (if any) and an
incrementing counter, so `main.ts` animates by noticing the counter went
up, regardless of who moved — the same mechanism a future networked
opponent's moves would use too.

## Online play (rooms)

Clicking "Play online" generates a short random room ID client-side and
navigates to `?room=<id>`; that URL is the link to share. The frontend then
connects to `/ws/room/{id}` instead of `/ws/game` (`net/socket.ts`'s
`roomSocketUrl`) and `main.ts` reads `?room=` on load to decide which one to
use. `backend/app/game/room.py`'s `Room` holds one `GameEngine` shared by
everyone in it: the first connection becomes white, the second black, and
anyone after that just watches (`Room.assign_role`) — see `api/ws.py`'s
`room_socket` and `_broadcast_room`, which sends every connection its own
`StateMessage.role`/`bothPlayersPresent` alongside the identical shared board
state. The server rejects a `select`/`move` from a connection whose role
doesn't match whose turn it actually is (`engine.move`/`select` only check
the *cube's* color, not which connection asked, so the room endpoint has to
enforce that itself) and rejects spectators outright.

Rooms are plain in-memory dicts, gone on server restart, with no
reconnect-to-the-same-seat: if a player's connection drops, `Room.release`
frees their seat for the next person who opens the link, rather than holding
it for them. Good enough for two people sharing a link for a casual game; a
real lobby/matchmaking system is out of scope.

## Deploy

Served in production at `https://<host>/duel/` behind a bundled nginx +
Let's Encrypt on the standard port 443 (if that's already taken by something
else on your host, adjust `deploy/nginx/*.conf` and `docker-compose.yml`'s
port mappings). `frontend/vite.config.ts`'s `base: '/duel/'` and
`scene/models.ts`'s `import.meta.env.BASE_URL`-prefixed model URLs assume
this path; change both together if the path ever moves. `deploy/nginx/*.conf`
list both `letatel.com` and `dicefight.online` as `server_name`s -- same app,
two domains pointed at the same server; add/remove domains there (and in the
certbot `-d` flags below) as needed.

```sh
docker compose build
# first run only: bootstrap nginx (HTTP-only, no cert yet) then obtain one
docker compose up -d nginx backend
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d <your-domain> [-d <another-domain> ...] --email <your-email> --agree-tos --non-interactive
docker compose restart nginx   # entrypoint.sh picks up the now-present cert
```

Renewal: cron `docker compose run --rm certbot renew --quiet && docker compose exec nginx nginx -s reload`,
twice daily (nginx doesn't need a restart for a renewed cert — `-s reload` re-reads it from disk).

## Known gaps / follow-ups

- Rooms have no reconnect-to-the-same-seat (a dropped connection just frees
  the seat), no persistence across a server restart, and no lobby/matchmaking
  beyond "share a link" — see "Online play (rooms)" above.
- Menus/settings/localization/chat are not built yet.
