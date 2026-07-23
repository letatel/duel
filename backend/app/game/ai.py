"""A deliberately simple AI opponent: greedy one-ply move choice plus a
one-ply "don't hang a cube" safety check. No search tree, no opening book —
enough to be worth playing against, not meant to be strong.
"""
from __future__ import annotations

from typing import Optional

from .board import Bend, Board
from .cube import Cube

_CAPTURE_BONUS = 8.0
_KING_CAPTURE_BONUS = 1000.0
_HOME_INVASION_BONUS = 1000.0
_ADVANCE_WEIGHT = 0.3
_CENTER_WEIGHT = 0.1
_HANGING_PENALTY = 50.0

Move = tuple[int, int, int, int, Bend]  # from_x, from_y, to_x, to_y, bend


def choose_move(board: Board, color: str) -> Optional[Move]:
    """The move judged best for `color` by a simple material/advancement
    heuristic, penalized if it leaves the moved cube immediately
    recapturable. Returns None if `color` has no legal move at all."""
    candidates: list[tuple[Cube, int, int, Bend]] = []
    for cube in list(board.cubes.values()):
        if cube.color != color:
            continue
        for legal in board.legal_moves(cube):
            for bend in legal.bends:
                candidates.append((cube, legal.x, legal.y, bend))

    if not candidates:
        return None

    best_score = float("-inf")
    best: tuple[Cube, int, int, Bend] = candidates[0]
    for candidate in candidates:
        score = _score_move(board, color, *candidate)
        if score > best_score:
            best_score = score
            best = candidate

    cube, to_x, to_y, bend = best
    return cube.x, cube.y, to_x, to_y, bend


def _score_move(board: Board, color: str, cube: Cube, to_x: int, to_y: int, bend: Bend) -> float:
    target = board.at(to_x, to_y)
    score = 0.0

    if target is not None:
        score += _KING_CAPTURE_BONUS if target.is_king else _CAPTURE_BONUS

    enemy_home_row = 7 if color == "white" else 0
    if cube.is_king and to_x == 4 and to_y == enemy_home_row:
        score += _HOME_INVASION_BONUS
    elif not cube.is_king:
        advance = to_y if color == "white" else (7 - to_y)
        score += advance * _ADVANCE_WEIGHT
        score += (4 - abs(to_x - 4)) * _CENTER_WEIGHT

    if _hangs_the_mover(board, color, cube, to_x, to_y, bend):
        score -= _HANGING_PENALTY

    return score


def _simulate(board: Board, cube: Cube, to_x: int, to_y: int, bend: Bend) -> Board:
    scratch = Board()
    scratch.cubes = dict(board.cubes)
    rolled = Board.resulting_cube(cube, to_x - cube.x, to_y - cube.y, bend)
    scratch.remove(cube.x, cube.y)
    scratch.remove(to_x, to_y)
    scratch.place(rolled)
    return scratch


def _hangs_the_mover(board: Board, color: str, cube: Cube, to_x: int, to_y: int, bend: Bend) -> bool:
    """True if, after this move, some enemy cube could capture on (to_x, to_y)
    next turn (a one-ply lookahead -- cheap enough on a 9x8 board with at
    most 18 cubes that a full search isn't needed for "don't hang a piece")."""
    scratch = _simulate(board, cube, to_x, to_y, bend)
    for enemy in list(scratch.cubes.values()):
        if enemy.color == color:
            continue
        for enemy_move in scratch.legal_moves(enemy):
            if (enemy_move.x, enemy_move.y) == (to_x, to_y):
                return True
    return False
