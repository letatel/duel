"""Board state and legal-move generation.

This is a faithful port of the Unity `cub.PossibleMove()` /
`BoardManager.CheckCanTurn` behavior (see Assets/Scripts/cub.cs and
Assets/Scripts/BoardManager.cs in the original `duel` repository), reworked
into a single clean sweep instead of the original's four duplicated
per-quadrant blocks.

The core rule (deliberately non-obvious from the original C#, verified by
reading the double loop in `cub.PossibleMove()` closely): a cube whose top
face shows value T may only reach squares at *exactly* Manhattan distance T
(never less) from its current square, optionally bending its path once by
90 degrees. This is why `mcp_server/game_model.py`'s AI approximation
(`if manhattan > turns: continue`) is wrong for real play — it allows any
distance *up to* T, not exactly T.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .cube import Cube, Direction, Orientation

COLS = 9
ROWS = 8

# Designer-specified starting layout: top-face value per column (mirrored
# around the king at x=4), with every pawn's front/back faces fixed at
# 4/3. Column 4 is the king and has no entry (its orientation doesn't
# affect its value, which is always 1).
_TOP_FACE_BY_COLUMN: dict[int, int] = {0: 5, 1: 1, 2: 2, 3: 6, 5: 6, 6: 2, 7: 1, 8: 5}
_FRONT_FACE = 4
_BACK_FACE = 3


def _pawn_orientation(x: int, front_is_north: bool) -> Orientation:
    top = _TOP_FACE_BY_COLUMN[x]
    bottom = 7 - top
    north, south = (_FRONT_FACE, _BACK_FACE) if front_is_north else (_BACK_FACE, _FRONT_FACE)
    # top/bottom and north/south each come from one of the three
    # complementary {1..6} pairs; the pair left over is east/west.
    east, west = sorted(set(range(1, 7)) - {top, bottom, north, south})
    return Orientation(top=top, bottom=bottom, north=north, south=south, east=east, west=west)


class Bend(str, Enum):
    """Which order the two path segments are walked in, for a bent move."""

    STRAIGHT = "straight"  # no bend needed: dx == 0 or dy == 0
    X_THEN_Y = "x_then_y"  # horizontal leg first, then vertical
    Y_THEN_X = "y_then_x"  # vertical leg first, then horizontal


@dataclass(frozen=True)
class LegalMove:
    x: int
    y: int
    bends: frozenset[Bend]


def _sign(n: int) -> int:
    return (n > 0) - (n < 0)


class Board:
    def __init__(self) -> None:
        self.cubes: dict[tuple[int, int], Cube] = {}

    @classmethod
    def initial(cls) -> "Board":
        """Standard starting layout: king at x=4, 8 pawns filling the rest of
        each back row. White at y=0, black at y=7 (matches
        BoardManager.AllSpawnCub in the original). Starting die
        orientations follow the designer-specified layout (see
        `_pawn_orientation` below) rather than the original Unity scene,
        whose per-piece prefab rotations aren't recoverable from script
        code alone.
        """
        board = cls()
        board._spawn_row(color="white", y=0)
        board._spawn_row(color="black", y=7)
        return board

    def _spawn_row(self, color: str, y: int) -> None:
        # Each side's pawns are set up facing the opponent, so "front" is
        # north for white (advancing toward y=7) and south for black
        # (advancing toward y=0).
        front_is_north = color == "white"
        for x in range(COLS):
            is_king = x == 4
            orientation = Orientation.standard() if is_king else _pawn_orientation(x, front_is_north)
            self.cubes[(x, y)] = Cube(color=color, is_king=is_king, x=x, y=y, orientation=orientation)

    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < COLS and 0 <= y < ROWS

    def at(self, x: int, y: int) -> Optional[Cube]:
        return self.cubes.get((x, y))

    def place(self, cube: Cube) -> None:
        self.cubes[(cube.x, cube.y)] = cube

    def remove(self, x: int, y: int) -> Optional[Cube]:
        return self.cubes.pop((x, y), None)

    def snapshot(self) -> list[dict]:
        # `north` rides along with `value` (top) purely so the client can
        # reconstruct a matching visual rotation for a freshly-placed die --
        # any two adjacent faces fully determine a cube's orientation up to
        # the rotation group, and the renderer's canonical mesh layout
        # agrees on which face is which (see frontend/src/scene/cube.ts).
        return [
            {
                "x": c.x,
                "y": c.y,
                "color": c.color,
                "isKing": c.is_king,
                "value": c.value,
                "north": c.orientation.north,
            }
            for c in self.cubes.values()
        ]

    def legal_moves(self, cube: Cube) -> list[LegalMove]:
        """All squares `cube` may move to this turn, and which bend order(s)
        (if any) reach each one unobstructed."""
        reach = cube.value
        moves: list[LegalMove] = []

        for dx in range(-reach, reach + 1):
            remaining = reach - abs(dx)
            dys = (0,) if remaining == 0 else (remaining, -remaining)
            for dy in dys:
                if dx == 0 and dy == 0:
                    continue
                tx, ty = cube.x + dx, cube.y + dy
                if not self.in_bounds(tx, ty):
                    continue

                bends = self._clear_bends(cube.x, cube.y, dx, dy)
                if not bends:
                    continue

                target = self.at(tx, ty)
                if target is not None and target.color == cube.color:
                    continue

                moves.append(LegalMove(tx, ty, frozenset(bends)))

        return moves

    def _clear_bends(self, x: int, y: int, dx: int, dy: int) -> set[Bend]:
        bends: set[Bend] = set()
        if dx == 0 or dy == 0:
            if self._path_clear_straight(x, y, dx, dy):
                bends.add(Bend.STRAIGHT)
            return bends
        if self._path_clear_bent(x, y, dx, dy, x_first=True):
            bends.add(Bend.X_THEN_Y)
        if self._path_clear_bent(x, y, dx, dy, x_first=False):
            bends.add(Bend.Y_THEN_X)
        return bends

    def _path_clear_straight(self, x: int, y: int, dx: int, dy: int) -> bool:
        """True if every square strictly between (x,y) and (x+dx,y+dy) is
        empty. The destination itself is not checked here (caller decides
        whether an enemy there may be captured)."""
        steps = abs(dx) or abs(dy)
        step_x, step_y = _sign(dx), _sign(dy)
        for i in range(1, steps):
            if self.at(x + step_x * i, y + step_y * i) is not None:
                return False
        return True

    def _path_clear_bent(self, x: int, y: int, dx: int, dy: int, x_first: bool) -> bool:
        """True if the bent path (one leg fully, then the other) is clear,
        excluding the final destination square."""
        step_x, step_y = _sign(dx), _sign(dy)
        if x_first:
            for i in range(1, abs(dx) + 1):  # includes the corner square
                if self.at(x + step_x * i, y) is not None:
                    return False
            for j in range(1, abs(dy)):  # excludes destination
                if self.at(x + dx, y + step_y * j) is not None:
                    return False
        else:
            for j in range(1, abs(dy) + 1):  # includes the corner square
                if self.at(x, y + step_y * j) is not None:
                    return False
            for i in range(1, abs(dx)):  # excludes destination
                if self.at(x + step_x * i, y + dy) is not None:
                    return False
        return True

    @staticmethod
    def path_steps(dx: int, dy: int, bend: Bend) -> list[Direction]:
        """Expand a chosen bend order into the concrete sequence of unit
        rolls (used to apply a move and animate it)."""
        x_steps = [Direction.EAST if dx > 0 else Direction.WEST] * abs(dx)
        y_steps = [Direction.NORTH if dy > 0 else Direction.SOUTH] * abs(dy)
        if bend is Bend.STRAIGHT:
            return x_steps or y_steps
        if bend is Bend.X_THEN_Y:
            return x_steps + y_steps
        return y_steps + x_steps
