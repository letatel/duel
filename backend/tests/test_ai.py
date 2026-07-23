from app.game import ai
from app.game.board import Bend, Board
from app.game.cube import Cube, Orientation


def make_cube(color="white", is_king=False, x=0, y=0, value=1):
    return Cube(color=color, is_king=is_king, x=x, y=y, orientation=Orientation.standard(top=value))


def test_choose_move_returns_none_when_the_side_has_no_cubes():
    board = Board()
    assert ai.choose_move(board, "white") is None


def test_choose_move_takes_a_free_capture_over_a_quiet_move():
    board = Board()
    mover = make_cube(color="black", x=4, y=4, value=1)  # only orthogonal neighbors
    board.place(mover)
    board.place(make_cube(color="white", x=4, y=5))  # capturable dead ahead
    # A second black cube far away with only quiet moves available, so a
    # bad heuristic that ignores captures would have plenty of alternatives
    # to wrongly prefer.
    board.place(make_cube(color="black", x=0, y=0, value=1))

    move = ai.choose_move(board, "black")

    assert move == (4, 4, 4, 5, Bend.STRAIGHT)


def test_choose_move_prefers_capturing_the_king():
    board = Board()
    mover = make_cube(color="white", x=4, y=4, value=1)
    board.place(mover)
    board.place(Cube(color="black", is_king=True, x=4, y=5, orientation=Orientation.standard()))
    board.place(make_cube(color="black", x=6, y=6))  # an ordinary, lower-value capture too

    move = ai.choose_move(board, "white")

    assert move == (4, 4, 4, 5, Bend.STRAIGHT)


def test_choose_move_avoids_a_recapture_when_a_safe_alternative_exists():
    board = Board()
    # White cube can capture at (4,5), but black's king would immediately
    # recapture there. A second, safe white cube gives the heuristic a
    # non-hanging option to prefer instead.
    board.place(make_cube(color="white", x=4, y=4, value=1))
    board.place(make_cube(color="black", x=4, y=5, value=1))
    board.place(Cube(color="black", is_king=True, x=4, y=6, orientation=Orientation.standard()))
    board.place(make_cube(color="white", x=0, y=0, value=1))

    move = ai.choose_move(board, "white")

    assert move != (4, 4, 4, 5, Bend.STRAIGHT)


def test_choose_move_avoids_exposing_its_own_king_to_a_discovered_attack():
    # _hangs_the_mover only ever checks whether the piece that just moved
    # is recapturable on its own new square -- it has no way to notice a
    # move exposing some *other* piece, most importantly the king. Here,
    # the white pawn at (5,4) currently blocks a black pawn three squares
    # east of the white king along row y=4. It can either shift further
    # along that same row (still blocking, but a lower advance score for
    # white, whose advance is measured purely by y) or step off the row
    # entirely to (5,5) -- a *better* advance score, but one that opens
    # the row and leaves the king capturable next turn. Without the check
    # penalty, the plain advance bonus would make (5,5) look like the
    # better move; with it, the still-blocking (6,4) should win instead.
    board = Board()
    board.place(Cube(color="white", is_king=True, x=4, y=4, orientation=Orientation.standard()))
    board.place(make_cube(color="white", x=5, y=4, value=1))
    board.place(make_cube(color="black", x=7, y=4, value=3))  # attacks (4,4) once the row opens

    move = ai.choose_move(board, "white")

    assert move != (5, 4, 5, 5, Bend.STRAIGHT)


# ── "hard" difficulty: minimax with alpha-beta ──────────────────────────

def test_choose_move_dispatches_to_hard_by_difficulty_argument():
    board = Board()
    mover = make_cube(color="black", x=4, y=4, value=1)
    board.place(mover)
    board.place(make_cube(color="white", x=4, y=5))
    board.place(make_cube(color="black", x=0, y=0, value=1))

    move = ai.choose_move(board, "black", difficulty="hard")

    assert move == ai.choose_move_hard(board, "black")


def test_choose_move_hard_returns_none_when_the_side_has_no_cubes():
    board = Board()
    assert ai.choose_move_hard(board, "white") is None


def _place_kings_out_of_the_way(board: Board) -> None:
    # _winner() (the minimax terminal check) treats a color with no cube
    # marked is_king as if that king had already been captured -- realistic
    # for actual games (always started via Board.initial(), which always
    # places exactly one king per side) but not for these hand-built test
    # boards, which otherwise have no king at all and would make every
    # branch look like an immediate, artifactual win/loss. Every hard-AI
    # test below needs a real king for both colors, parked somewhere that
    # doesn't interact with the scenario being tested.
    board.place(Cube(color="white", is_king=True, x=8, y=0, orientation=Orientation.standard()))
    board.place(Cube(color="black", is_king=True, x=8, y=7, orientation=Orientation.standard()))


def test_choose_move_hard_takes_a_free_capture_over_a_quiet_move():
    board = Board()
    _place_kings_out_of_the_way(board)
    mover = make_cube(color="black", x=4, y=4, value=1)
    board.place(mover)
    board.place(make_cube(color="white", x=4, y=5))  # capturable dead ahead
    board.place(make_cube(color="black", x=0, y=0, value=1))

    move = ai.choose_move_hard(board, "black")

    assert move == (4, 4, 4, 5, Bend.STRAIGHT)


def test_choose_move_hard_prefers_capturing_the_king():
    board = Board()
    board.place(Cube(color="white", is_king=True, x=8, y=0, orientation=Orientation.standard()))
    mover = make_cube(color="white", x=4, y=4, value=1)
    board.place(mover)
    board.place(Cube(color="black", is_king=True, x=4, y=5, orientation=Orientation.standard()))
    board.place(make_cube(color="black", x=6, y=6))

    move = ai.choose_move_hard(board, "white")

    assert move == (4, 4, 4, 5, Bend.STRAIGHT)


def test_choose_move_hard_avoids_a_trade_down_a_forced_recapture_line():
    # White can capture at (4,5), but black's king recaptures there next
    # turn no matter what white does about it -- a one-ply heuristic
    # cannot see that far, but minimax should still prefer the safe
    # alternative since it looks past its own reply.
    board = Board()
    board.place(Cube(color="white", is_king=True, x=8, y=0, orientation=Orientation.standard()))
    board.place(make_cube(color="white", x=4, y=4, value=1))
    board.place(make_cube(color="black", x=4, y=5, value=1))
    board.place(Cube(color="black", is_king=True, x=4, y=6, orientation=Orientation.standard()))
    board.place(make_cube(color="white", x=0, y=0, value=1))

    move = ai.choose_move_hard(board, "white")

    assert move != (4, 4, 4, 5, Bend.STRAIGHT)


def test_choose_move_hard_moves_a_threatened_king_to_safety():
    board = Board()
    board.place(Cube(color="white", is_king=True, x=4, y=4, orientation=Orientation.standard()))
    board.place(Cube(color="black", is_king=True, x=0, y=7, orientation=Orientation.standard()))
    board.place(make_cube(color="black", x=4, y=6, value=2))  # attacks (4,4) right now
    board.place(make_cube(color="white", x=8, y=0, value=1))  # a quiet, unrelated alternative

    move = ai.choose_move_hard(board, "white")

    assert move[:2] == (4, 4)


def test_choose_move_hard_finds_a_mate_in_one():
    # Black king at (4,5) can only step to the four orthogonal neighbors
    # (value 1); every one of them is covered by a white cube, so no matter
    # what black does, white can capture the king next turn -- white's best
    # move right now is simply to take it immediately rather than wait.
    board = Board()
    board.place(Cube(color="white", is_king=True, x=8, y=0, orientation=Orientation.standard()))
    board.place(Cube(color="black", is_king=True, x=4, y=5, orientation=Orientation.standard()))
    board.place(make_cube(color="white", x=4, y=6, value=1))  # takes the king now

    move = ai.choose_move_hard(board, "white")

    assert move == (4, 6, 4, 5, Bend.STRAIGHT)
