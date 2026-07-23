"""Cube (die) domain model: position, color, and physical orientation.

Orientation is modeled as the six face values of a standard die (opposite
faces always sum to 7), instead of porting the original Unity approach of
comparing snapped Euler angles (`cub.rX/rY/rZ` + `AccurateRotation()`).
Rolling the die one cell in a grid direction permutes these six values with
the standard "rolling die" transform. The cube's current legal move distance
("Turns" in the original) is always whatever value now sits on top.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


_CANONICAL_AXIS: dict[int, tuple[int, int, int]] = {
    1: (0, 1, 0), 6: (0, -1, 0),
    2: (0, 0, 1), 5: (0, 0, -1),
    3: (1, 0, 0), 4: (-1, 0, 0),
}


def _cross(a: tuple[int, int, int], b: tuple[int, int, int]) -> tuple[int, int, int]:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return sum(x * y for x, y in zip(a, b))


class Direction(str, Enum):
    NORTH = "north"  # +y
    SOUTH = "south"  # -y
    EAST = "east"  # +x
    WEST = "west"  # -x


_DIRECTION_DELTA: dict[Direction, tuple[int, int]] = {
    Direction.NORTH: (0, 1),
    Direction.SOUTH: (0, -1),
    Direction.EAST: (1, 0),
    Direction.WEST: (-1, 0),
}


@dataclass(frozen=True)
class Orientation:
    """The six face values of a die. Opposite faces always sum to 7."""

    top: int
    bottom: int
    north: int
    south: int
    east: int
    west: int

    @classmethod
    def standard(cls, top: int = 1, north: int = 2, east: int = 3) -> "Orientation":
        """Build a valid orientation from three mutually-adjacent face values."""
        return cls(
            top=top, bottom=7 - top,
            north=north, south=7 - north,
            east=east, west=7 - east,
        )

    @classmethod
    def from_top_and_north(cls, top: int, north: int) -> "Orientation":
        """Build the one physically-valid orientation with the given top and
        north face values. A die's full orientation follows from just these
        two faces -- the remaining four, including which face of the leftover
        complementary pair is east vs. west, are fixed by the die's chirality.
        Picking that pair by any other rule (e.g. numeric sort) can produce a
        mirror-image orientation no rotation could ever actually reach, which
        silently desyncs from a renderer that reconstructs the mesh rotation
        geometrically from just (top, north), like the frontend does -- the
        two agree at rest but diverge the first time the piece rolls along
        the east/west axis, since 'east' from that point on means different
        physical faces to each side.
        """
        bottom = 7 - top
        south = 7 - north
        a, b = sorted(set(range(1, 7)) - {top, bottom, north, south})
        if _dot(_cross(_CANONICAL_AXIS[top], _CANONICAL_AXIS[north]), _CANONICAL_AXIS[a]) > 0:
            east, west = a, b
        else:
            east, west = b, a
        return cls(top=top, bottom=bottom, north=north, south=south, east=east, west=west)

    def rolled(self, direction: Direction) -> "Orientation":
        """Return the orientation after tipping the die one cell in `direction`."""
        if direction is Direction.NORTH:
            return Orientation(
                top=self.south, bottom=self.north,
                north=self.top, south=self.bottom,
                east=self.east, west=self.west,
            )
        if direction is Direction.SOUTH:
            return Orientation(
                top=self.north, bottom=self.south,
                north=self.bottom, south=self.top,
                east=self.east, west=self.west,
            )
        if direction is Direction.EAST:
            return Orientation(
                top=self.west, bottom=self.east,
                north=self.north, south=self.south,
                east=self.top, west=self.bottom,
            )
        if direction is Direction.WEST:
            return Orientation(
                top=self.east, bottom=self.west,
                north=self.north, south=self.south,
                east=self.bottom, west=self.top,
            )
        raise ValueError(direction)


@dataclass(frozen=True)
class Cube:
    """A single piece on the board: an ordinary die ("Pawn") or the King."""

    color: str  # "white" | "black"
    is_king: bool
    x: int
    y: int
    orientation: Orientation

    @property
    def value(self) -> int:
        """Current legal move distance: always 1 for the King, else the top face."""
        return 1 if self.is_king else self.orientation.top

    def rolled_to(self, direction: Direction) -> "Cube":
        """Return a copy of this cube after tipping one cell in `direction`."""
        dx, dy = _DIRECTION_DELTA[direction]
        return Cube(
            color=self.color,
            is_king=self.is_king,
            x=self.x + dx,
            y=self.y + dy,
            orientation=self.orientation if self.is_king else self.orientation.rolled(direction),
        )
