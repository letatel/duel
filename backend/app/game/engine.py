"""Turn/session orchestration on top of Board: whose move it is, applying a
chosen move (validating both destination reachability and the requested
bend direction), and victory conditions.

Port of the turn-flow spread across Assets/Scripts/BoardManager.cs
(`SelectCub`, `MoveCub`, `CheckCanTurn`, `CheckVictory`) in the original.
"""
from __future__ import annotations

from typing import Optional

from .board import Bend, Board, LegalMove
from .cube import Cube

KING_HOME_X = 4
# Row a king must reach to win by occupying the opponent's home square
# (the opponent king's own starting row).
ENEMY_HOME_ROW = {"white": 7, "black": 0}


class IllegalMove(Exception):
    """Raised when a client-requested move/selection is not valid.

    Caught at the API layer and reported back as an `error` message —
    never crashes the session.
    """


class GameEngine:
    def __init__(self) -> None:
        self.board = Board.initial()
        self.turn: str = "white"
        self.winner: Optional[str] = None
        self.selected: Optional[tuple[int, int]] = None

    def reset(self) -> None:
        self.__init__()

    def legal_moves_for_selected(self) -> list[LegalMove]:
        if self.selected is None:
            return []
        cube = self.board.at(*self.selected)
        if cube is None:
            return []
        return self.board.legal_moves(cube)

    def select(self, x: int, y: int) -> list[LegalMove]:
        """Select a cube belonging to the side to move. Clears the
        selection (and returns no moves) if the square is empty, belongs to
        the other side, or has no legal moves — mirrors
        BoardManager.SelectCub's early-return behavior."""
        if self.winner is not None:
            self.selected = None
            return []

        cube = self.board.at(x, y)
        if cube is None or cube.color != self.turn:
            self.selected = None
            return []

        moves = self.board.legal_moves(cube)
        self.selected = (x, y) if moves else None
        return moves

    def move(
        self,
        from_x: int,
        from_y: int,
        to_x: int,
        to_y: int,
        bend: Optional[str],
    ) -> None:
        if self.winner is not None:
            raise IllegalMove("the game is already over")

        cube = self.board.at(from_x, from_y)
        if cube is None or cube.color != self.turn:
            raise IllegalMove("no cube of the current color at that square")

        legal = {(m.x, m.y): m.bends for m in self.board.legal_moves(cube)}
        allowed_bends = legal.get((to_x, to_y))
        if allowed_bends is None:
            raise IllegalMove("that square is not reachable this turn")

        dx, dy = to_x - from_x, to_y - from_y
        if dx == 0 or dy == 0:
            required = Bend.STRAIGHT
        else:
            if bend not in ("x", "y"):
                raise IllegalMove("this move requires a bend direction: 'x' or 'y'")
            required = Bend.X_THEN_Y if bend == "x" else Bend.Y_THEN_X

        if required not in allowed_bends:
            raise IllegalMove("that path is blocked in the requested direction")

        rolled = Board.resulting_cube(cube, dx, dy, required)

        self.board.remove(from_x, from_y)
        captured = self.board.remove(to_x, to_y)
        self.board.place(rolled)

        if captured is not None and captured.is_king:
            self.winner = self.turn
        elif rolled.is_king and rolled.x == KING_HOME_X and rolled.y == ENEMY_HOME_ROW[self.turn]:
            self.winner = self.turn

        self.selected = None
        if self.winner is None:
            self.turn = "black" if self.turn == "white" else "white"
