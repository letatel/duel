"""Outgoing WebSocket message shapes (server -> client). Incoming messages
are simple untyped JSON dicts handled directly in api/ws.py — they're
trivial enough (3 message types, few fields) that a full parsed request
model isn't worth the indirection; these response models are worth it
because the client needs a stable, typed contract to render against.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class CubeView(BaseModel):
    x: int
    y: int
    color: Literal["white", "black"]
    isKing: bool
    value: int
    north: int


class LegalMoveView(BaseModel):
    x: int
    y: int
    bends: list[Literal["straight", "x_then_y", "y_then_x"]]
    # Resulting top-face value per bend, so the client can preview it on
    # the tile before the move is made (see app/game/board.py's
    # LegalMove.resulting_values for why this is keyed per bend rather
    # than being a single number).
    values: dict[Literal["straight", "x_then_y", "y_then_x"], int]


class LastMoveView(BaseModel):
    fromX: int
    fromY: int
    toX: int
    toY: int
    bend: Literal["straight", "x_then_y", "y_then_x"]


class StateMessage(BaseModel):
    type: Literal["state"] = "state"
    board: list[CubeView]
    turn: Literal["white", "black"]
    winner: Optional[Literal["white", "black"]] = None
    selected: Optional[tuple[int, int]] = None
    legalMoves: list[LegalMoveView] = []
    # Incremented on every applied move (human or AI). The client uses
    # this to notice "a move just happened, animate it" independent of
    # whether it was the one that requested it -- an AI move arrives
    # unprompted, so it can't rely on remembering its own last request.
    moveNumber: int = 0
    lastMove: Optional[LastMoveView] = None
    # Which seat *this* connection holds in a multiplayer room (see
    # api/ws.py's /ws/room/{id}) -- unset for the single-connection
    # hot-seat/vs-AI endpoint, which has no such concept. Every recipient
    # in a room gets their own copy of this message with their own role,
    # even though the rest of the state is identical for everyone.
    role: Optional[Literal["white", "black", "spectator"]] = None
    # Whether both player seats in the room are currently filled -- lets
    # the client show "waiting for an opponent" instead of a live game
    # state. Unset for the single-connection endpoint, which has no
    # concept of seats to wait on.
    bothPlayersPresent: Optional[bool] = None


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str
