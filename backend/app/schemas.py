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


class StateMessage(BaseModel):
    type: Literal["state"] = "state"
    board: list[CubeView]
    turn: Literal["white", "black"]
    winner: Optional[Literal["white", "black"]] = None
    selected: Optional[tuple[int, int]] = None
    legalMoves: list[LegalMoveView] = []


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str
