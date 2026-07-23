"""Single WebSocket endpoint driving one hot-seat GameEngine session per
connection. MVP scope only: no rooms, no auth, no persistence — see the
project plan for the multiplayer phase that will add rooms on top of this
same engine without changing engine.py.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..game.engine import GameEngine, IllegalMove
from ..schemas import CubeView, ErrorMessage, LegalMoveView, StateMessage

router = APIRouter()


def _state_message(engine: GameEngine) -> StateMessage:
    board = [CubeView(**c) for c in engine.board.snapshot()]
    legal_moves = [
        LegalMoveView(x=m.x, y=m.y, bends=[b.value for b in m.bends])
        for m in engine.legal_moves_for_selected()
    ]
    return StateMessage(
        board=board,
        turn=engine.turn,
        winner=engine.winner,
        selected=engine.selected,
        legalMoves=legal_moves,
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
                    engine.reset()
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
    except WebSocketDisconnect:
        pass
