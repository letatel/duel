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
