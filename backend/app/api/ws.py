"""Single WebSocket endpoint driving one hot-seat GameEngine session per
connection. MVP scope only: no rooms, no auth, no persistence — see the
project plan for the multiplayer phase that will add rooms on top of this
same engine without changing engine.py.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..game.engine import GameEngine, IllegalMove
from ..schemas import CubeView, ErrorMessage, LastMoveView, LegalMoveView, StateMessage

router = APIRouter()

# Pause between sending the human's move and the AI's reply, purely so the
# human's own move finishes animating before the AI's move starts (mirrors
# the original's AIManager.aiDelay).
AI_REPLY_DELAY_SECONDS = 1.0


def _state_message(engine: GameEngine) -> StateMessage:
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
