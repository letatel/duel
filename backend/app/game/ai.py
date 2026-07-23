"""Two AI opponents of different strength, selected by `difficulty`:

- "easy": the original greedy one-ply move choice plus a one-ply "don't
  hang a cube" safety check. No lookahead beyond that.
- "hard": minimax with alpha-beta pruning a few plies deep, so it actually
  accounts for the opponent's best reply instead of just reacting to the
  position as it is right now.

Both share the same move-generation and simulation plumbing; only how a
position/move is scored differs.
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

_KING_HOME_X = 4
_ENEMY_HOME_ROW = {"white": 7, "black": 0}

# How many plies of minimax the "hard" AI looks ahead: its own move, the
# opponent's best reply, and its own move after that. Deeper is stronger
# but slower -- 3 plies with alpha-beta stays well under a second on this
# board size (at most 18 cubes, each with a handful of legal moves).
_MINIMAX_DEPTH = 3
_WIN_SCORE = 10_000.0

Move = tuple[int, int, int, int, Bend]  # from_x, from_y, to_x, to_y, bend


def choose_move(board: Board, color: str, difficulty: str = "easy") -> Optional[Move]:
    if difficulty == "hard":
        return choose_move_hard(board, color)
    return choose_move_easy(board, color)


def _other(color: str) -> str:
    return "black" if color == "white" else "white"


def _all_moves(board: Board, color: str) -> list[tuple[Cube, int, int, Bend]]:
    candidates: list[tuple[Cube, int, int, Bend]] = []
    for cube in list(board.cubes.values()):
        if cube.color != color:
            continue
        for legal in board.legal_moves(cube):
            for bend in legal.bends:
                candidates.append((cube, legal.x, legal.y, bend))
    return candidates


def _simulate(board: Board, cube: Cube, to_x: int, to_y: int, bend: Bend) -> Board:
    scratch = Board()
    scratch.cubes = dict(board.cubes)
    rolled = Board.resulting_cube(cube, to_x - cube.x, to_y - cube.y, bend)
    scratch.remove(cube.x, cube.y)
    scratch.remove(to_x, to_y)
    scratch.place(rolled)
    return scratch


# ── Easy: greedy one-ply choice ─────────────────────────────────────────

def choose_move_easy(board: Board, color: str) -> Optional[Move]:
    """The move judged best for `color` by a simple material/advancement
    heuristic, penalized if it leaves the moved cube immediately
    recapturable. Returns None if `color` has no legal move at all."""
    candidates = _all_moves(board, color)
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

    enemy_home_row = _ENEMY_HOME_ROW[color]
    if cube.is_king and to_x == _KING_HOME_X and to_y == enemy_home_row:
        score += _HOME_INVASION_BONUS
    elif not cube.is_king:
        advance = to_y if color == "white" else (7 - to_y)
        score += advance * _ADVANCE_WEIGHT
        score += (4 - abs(to_x - 4)) * _CENTER_WEIGHT

    if _hangs_the_mover(board, color, cube, to_x, to_y, bend):
        score -= _HANGING_PENALTY

    return score


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


# ── Hard: minimax with alpha-beta pruning ───────────────────────────────

def choose_move_hard(board: Board, color: str) -> Optional[Move]:
    candidates = _all_moves(board, color)
    if not candidates:
        return None

    opponent = _other(color)
    best_score = float("-inf")
    best = candidates[0]
    alpha, beta = float("-inf"), float("inf")
    for candidate in candidates:
        cube, to_x, to_y, bend = candidate
        scratch = _simulate(board, cube, to_x, to_y, bend)
        score = _minimax(scratch, opponent, color, _MINIMAX_DEPTH - 1, alpha, beta)
        if score > best_score:
            best_score = score
            best = candidate
        alpha = max(alpha, best_score)

    cube, to_x, to_y, bend = best
    return cube.x, cube.y, to_x, to_y, bend


def _winner(board: Board) -> Optional[str]:
    """Whether this position is already game-over -- a king missing (just
    captured) or already sitting on the opponent's home square -- so the
    search stops right there instead of pretending play continues past a
    win, the same rules `GameEngine._apply_move` checks on a real move."""
    kings = {c.color: c for c in board.cubes.values() if c.is_king}
    if "white" not in kings:
        return "black"
    if "black" not in kings:
        return "white"
    for color, king in kings.items():
        if king.x == _KING_HOME_X and king.y == _ENEMY_HOME_ROW[color]:
            return color
    return None


def _evaluate(board: Board, root_color: str) -> float:
    """Static heuristic value of `board` from `root_color`'s perspective:
    material (pawn presence, king presence) plus the same
    advance/center-control shaping the easy AI uses per move, summed over
    every cube and signed by whether it's root_color's or the enemy's."""
    score = 0.0
    for cube in board.cubes.values():
        sign = 1.0 if cube.color == root_color else -1.0
        if cube.is_king:
            score += sign * 50.0
            continue
        score += sign * 5.0
        advance = cube.y if cube.color == "white" else (7 - cube.y)
        score += sign * advance * _ADVANCE_WEIGHT
        score += sign * (4 - abs(cube.x - 4)) * _CENTER_WEIGHT
    return score


def _minimax(board: Board, turn: str, root_color: str, depth: int, alpha: float, beta: float) -> float:
    winner = _winner(board)
    if winner is not None:
        return _WIN_SCORE if winner == root_color else -_WIN_SCORE

    if depth == 0:
        return _evaluate(board, root_color)

    candidates = _all_moves(board, turn)
    if not candidates:
        # No legal move for whoever's turn it is -- not a rule this game
        # defines a special outcome for, so just score the position as-is.
        return _evaluate(board, root_color)

    maximizing = turn == root_color
    value = float("-inf") if maximizing else float("inf")
    next_turn = _other(turn)
    for cube, to_x, to_y, bend in candidates:
        scratch = _simulate(board, cube, to_x, to_y, bend)
        child = _minimax(scratch, next_turn, root_color, depth - 1, alpha, beta)
        if maximizing:
            value = max(value, child)
            alpha = max(alpha, value)
        else:
            value = min(value, child)
            beta = min(beta, value)
        if alpha >= beta:
            break
    return value
