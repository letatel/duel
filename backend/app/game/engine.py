"""Turn/session orchestration on top of Board: whose move it is, applying a
chosen move (validating both destination reachability and the requested
bend direction), the optional AI opponent's own moves, and victory
conditions.

Port of the turn-flow spread across Assets/Scripts/BoardManager.cs
(`SelectCub`, `MoveCub`, `CheckCanTurn`, `CheckVictory`) in the original,
plus a from-scratch AI hookup the original never had (see ai.py).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from . import ai
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


@dataclass(frozen=True)
class LastMove:
    """The most recently applied move, regardless of whether a human or
    the AI made it -- lets the client animate either the same way, instead
    of only being able to animate moves it itself just requested."""

    from_x: int
    from_y: int
    to_x: int
    to_y: int
    bend: Bend


class GameEngine:
    def __init__(self) -> None:
        self.reset()

    def reset(self, ai_color: Optional[str] = None, ai_difficulty: str = "easy") -> None:
        """Start a fresh game. `ai_color`, if given, is the side the
        built-in AI plays (see maybe_ai_move) -- the other side (and
        whoever is connected) plays the opposite color. None means
        hot-seat: both sides are human. `ai_difficulty` picks which
        strategy in ai.py the AI side uses ("easy" or "hard")."""
        self.board = Board.initial()
        self.turn: str = "white"
        self.winner: Optional[str] = None
        self.selected: Optional[tuple[int, int]] = None
        self.ai_color = ai_color
        self.ai_difficulty = ai_difficulty
        self.move_count = 0
        self.last_move: Optional[LastMove] = None

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
        the other side, it's the AI's own turn, or the cube has no legal
        moves — mirrors BoardManager.SelectCub's early-return behavior."""
        if self.winner is not None or self.turn == self.ai_color:
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
        if self.turn == self.ai_color:
            raise IllegalMove("it's the AI's turn")

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

        self._apply_move(cube, to_x, to_y, required)

    def maybe_ai_move(self) -> bool:
        """If it's now the AI's turn, pick and apply a move for it.
        Returns whether it actually moved (False if the game's already
        over, it's not the AI's turn, or -- shouldn't normally happen --
        the AI has no legal move at all)."""
        if self.winner is not None or self.turn != self.ai_color:
            return False

        choice = ai.choose_move(self.board, self.turn, self.ai_difficulty)
        if choice is None:
            return False

        from_x, from_y, to_x, to_y, bend = choice
        cube = self.board.at(from_x, from_y)
        assert cube is not None
        self._apply_move(cube, to_x, to_y, bend)
        return True

    def _apply_move(self, cube: Cube, to_x: int, to_y: int, bend: Bend) -> None:
        from_x, from_y = cube.x, cube.y
        dx, dy = to_x - from_x, to_y - from_y
        rolled = Board.resulting_cube(cube, dx, dy, bend)
        mover = self.turn

        self.board.remove(from_x, from_y)
        captured = self.board.remove(to_x, to_y)
        self.board.place(rolled)

        if captured is not None and captured.is_king:
            self.winner = mover
        elif rolled.is_king and rolled.x == KING_HOME_X and rolled.y == ENEMY_HOME_ROW[mover]:
            self.winner = mover

        self.selected = None
        self.last_move = LastMove(from_x, from_y, to_x, to_y, bend)
        self.move_count += 1
        if self.winner is None:
            self.turn = "black" if self.turn == "white" else "white"
