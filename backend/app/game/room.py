"""In-memory multiplayer room: pairs two human players behind a shared
link and lets any further connections to that same link watch as
spectators. Rooms are created lazily by whichever ID a client's URL
carries and dropped once everyone leaves -- no persistence, and no
reconnect-to-the-same-seat: if a player's connection drops, their seat is
simply open for whoever connects to that room next. Good enough for a
casual game between two people sharing a link; a real matchmaking/lobby
system is out of scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from fastapi import WebSocket

from .engine import GameEngine

Role = Literal["white", "black", "spectator"]


@dataclass
class Room:
    engine: GameEngine = field(default_factory=GameEngine)
    white: Optional[WebSocket] = None
    black: Optional[WebSocket] = None
    spectators: list[WebSocket] = field(default_factory=list)

    def assign_role(self, websocket: WebSocket) -> Role:
        """The first connection to an empty seat becomes that color;
        anyone arriving after both seats are already taken just watches."""
        if self.white is None:
            self.white = websocket
            return "white"
        if self.black is None:
            self.black = websocket
            return "black"
        self.spectators.append(websocket)
        return "spectator"

    def release(self, websocket: WebSocket) -> None:
        if self.white is websocket:
            self.white = None
        elif self.black is websocket:
            self.black = None
        else:
            try:
                self.spectators.remove(websocket)
            except ValueError:
                pass

    def connections(self) -> list[WebSocket]:
        seats = [s for s in (self.white, self.black) if s is not None]
        return seats + self.spectators

    def is_empty(self) -> bool:
        return self.white is None and self.black is None and not self.spectators
