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
