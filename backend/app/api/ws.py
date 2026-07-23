"""Two WebSocket endpoints:

- /ws/game: one hot-seat/vs-AI GameEngine session per connection (the
  original MVP scope -- no rooms, no auth, no persistence).
- /ws/room/{room_id}: a shared session for up to two human players plus
  any number of spectators, keyed by an opaque ID the client's share link
  carries (see game/room.py).
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..game.engine import GameEngine, IllegalMove
from ..game.room import Role, Room
from ..schemas import CubeView, ErrorMessage, LastMoveView, LegalMoveView, StateMessage

router = APIRouter()

# Pause between sending the human's move and the AI's reply, purely so the
# human's own move finishes animating before the AI's move starts (mirrors
# the original's AIManager.aiDelay).
AI_REPLY_DELAY_SECONDS = 1.0

# Rooms are looked up by the opaque ID in the client's share link and live
# only in this process's memory -- fine for a casual game between two
# people, but a restart drops every in-progress room.
_rooms: dict[str, Room] = {}


def _state_message(
    engine: GameEngine,
    role: Optional[Role] = None,
    both_players_present: Optional[bool] = None,
) -> StateMessage:
    board = [CubeView(**c) for c in engine.board.snapshot()]
    legal_moves = [
        LegalMoveView(
            x=m.x,
            y=m.y,
            bends=[b.value for b in m.bends],
            values={bend.value: value for bend, value in m.resulting_values.items()},
        )
        for m in engine.legal_moves_for_selected()
    ]
    last_move = None
    if engine.last_move is not None:
        lm = engine.last_move
        last_move = LastMoveView(fromX=lm.from_x, fromY=lm.from_y, toX=lm.to_x, toY=lm.to_y, bend=lm.bend.value)
    return StateMessage(
        board=board,
        turn=engine.turn,
        winner=engine.winner,
        selected=engine.selected,
        legalMoves=legal_moves,
        moveNumber=engine.move_count,
        lastMove=last_move,
        role=role,
        bothPlayersPresent=both_players_present,
    )


@router.websocket("/ws/game")
async def game_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    engine = GameEngine()
    await websocket.send_text(_state_message(engine).model_dump_json())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                msg_type = data.get("type")

                if msg_type == "new_game":
                    ai_color = "black" if data.get("vsAi") else None
                    difficulty = data.get("difficulty") or "easy"
                    engine.reset(ai_color=ai_color, ai_difficulty=difficulty)
                elif msg_type == "select":
                    engine.select(int(data["x"]), int(data["y"]))
                elif msg_type == "move":
                    engine.move(
                        int(data["fromX"]),
                        int(data["fromY"]),
                        int(data["toX"]),
                        int(data["toY"]),
                        data.get("bend"),
                    )
                else:
                    raise IllegalMove(f"unknown message type: {msg_type!r}")
            except IllegalMove as exc:
                await websocket.send_text(ErrorMessage(message=str(exc)).model_dump_json())
                continue
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                await websocket.send_text(ErrorMessage(message="malformed message").model_dump_json())
                continue

            await websocket.send_text(_state_message(engine).model_dump_json())

            if engine.maybe_ai_move():
                await asyncio.sleep(AI_REPLY_DELAY_SECONDS)
                await websocket.send_text(_state_message(engine).model_dump_json())
    except WebSocketDisconnect:
        pass


async def _send_state(websocket: WebSocket, room: Room, role: Role) -> None:
    both_present = room.white is not None and room.black is not None
    try:
        await websocket.send_text(_state_message(room.engine, role=role, both_players_present=both_present).model_dump_json())
    except Exception:
        pass  # the connection is already gone; its own handler will clean it up


async def _broadcast_room(room: Room) -> None:
    if room.white is not None:
        await _send_state(room.white, room, "white")
    if room.black is not None:
        await _send_state(room.black, room, "black")
    for spectator in list(room.spectators):
        await _send_state(spectator, room, "spectator")


@router.websocket("/ws/room/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str) -> None:
    await websocket.accept()
    room = _rooms.setdefault(room_id, Room())
    role = room.assign_role(websocket)
    # Broadcasts to everyone already in the room too, not just the new
    # connection -- e.g. so white's "waiting for an opponent" clears the
    # moment black actually joins.
    await _broadcast_room(room)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                msg_type = data.get("type")

                if msg_type == "new_game":
                    if role == "spectator":
                        raise IllegalMove("spectators can't start a new game")
                    room.engine.reset()
                elif msg_type == "select":
                    if role == "spectator":
                        raise IllegalMove("spectators can't play")
                    if role != room.engine.turn:
                        raise IllegalMove("it's not your turn")
                    room.engine.select(int(data["x"]), int(data["y"]))
                elif msg_type == "move":
                    if role == "spectator":
                        raise IllegalMove("spectators can't play")
                    if role != room.engine.turn:
                        raise IllegalMove("it's not your turn")
                    room.engine.move(
                        int(data["fromX"]),
                        int(data["fromY"]),
                        int(data["toX"]),
                        int(data["toY"]),
                        data.get("bend"),
                    )
                else:
                    raise IllegalMove(f"unknown message type: {msg_type!r}")
            except IllegalMove as exc:
                await websocket.send_text(ErrorMessage(message=str(exc)).model_dump_json())
                continue
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                await websocket.send_text(ErrorMessage(message="malformed message").model_dump_json())
                continue

            await _broadcast_room(room)
    except WebSocketDisconnect:
        pass
    finally:
        room.release(websocket)
        if room.is_empty():
            _rooms.pop(room_id, None)
        else:
            # Let whoever's left know a seat opened up (e.g. the client
            # can show "waiting for an opponent" again).
            await _broadcast_room(room)
