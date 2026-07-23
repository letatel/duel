import pytest

from app.game.board import Bend, Board
from app.game.cube import Cube, Orientation
from app.game.engine import GameEngine, IllegalMove


def make_cube(color="white", is_king=False, x=0, y=0, value=1):
    return Cube(color=color, is_king=is_king, x=x, y=y, orientation=Orientation.standard(top=value))


# ── Board.initial layout ────────────────────────────────────────────────

def test_initial_layout_has_18_cubes_and_kings_at_x4():
    board = Board.initial()
    assert len(board.cubes) == 18
    white_king = board.at(4, 0)
    black_king = board.at(4, 7)
    assert white_king is not None and white_king.is_king and white_king.color == "white"
    assert black_king is not None and black_king.is_king and black_king.color == "black"
    for x in range(9):
        if x != 4:
            assert not board.at(x, 0).is_king
            assert not board.at(x, 7).is_king


def test_initial_pawn_top_faces_follow_the_designer_layout():
    board = Board.initial()
    expected_top = {0: 5, 1: 1, 2: 2, 3: 6, 5: 6, 6: 2, 7: 1, 8: 5}
    for x, top in expected_top.items():
        assert board.at(x, 0).value == top, f"white x={x}"
        assert board.at(x, 7).value == top, f"black x={x}"


def test_initial_pawns_face_the_opponent_with_back_face_3():
    board = Board.initial()
    for x in range(9):
        if x == 4:
            continue
        white = board.at(x, 0).orientation
        black = board.at(x, 7).orientation
        # White advances toward y=7 (north); black advances toward y=0 (south).
        assert white.north == 4 and white.south == 3
        assert black.south == 4 and black.north == 3


# ── Legal move generation ────────────────────────────────────────────────

def test_value_one_reaches_only_the_four_orthogonal_neighbors():
    board = Board()
    cube = make_cube(x=4, y=4, value=1)
    board.place(cube)
    dests = {(m.x, m.y) for m in board.legal_moves(cube)}
    assert dests == {(3, 4), (5, 4), (4, 3), (4, 5)}


def test_move_must_land_at_exactly_the_die_value_not_less():
    """A value=3 cube must travel a full Manhattan distance of 3 -- it
    can't stop short at 1 or 2, unlike a normal chess piece."""
    board = Board()
    cube = make_cube(x=4, y=4, value=3)
    board.place(cube)
    dests = {(m.x, m.y) for m in board.legal_moves(cube)}
    for tx, ty in dests:
        assert abs(tx - cube.x) + abs(ty - cube.y) == 3
    # a 1-square hop is never legal for this cube
    assert (5, 4) not in dests


def test_value_two_has_straight_and_oblique_destinations():
    board = Board()
    cube = make_cube(x=4, y=4, value=2)
    board.place(cube)
    moves = {(m.x, m.y): m.bends for m in board.legal_moves(cube)}

    assert moves[(6, 4)] == frozenset({Bend.STRAIGHT})  # straight east
    assert moves[(4, 6)] == frozenset({Bend.STRAIGHT})  # straight north
    # oblique (1,1) diagonal: both bend orders are open on an empty board
    assert moves[(5, 5)] == frozenset({Bend.X_THEN_Y, Bend.Y_THEN_X})


def test_straight_path_blocked_by_intermediate_cube():
    board = Board()
    cube = make_cube(x=4, y=4, value=3)
    board.place(cube)
    board.place(make_cube(color="black", x=4, y=6))  # sits between (4,4) and (4,7)
    dests = {(m.x, m.y) for m in board.legal_moves(cube)}
    assert (4, 7) not in dests


def test_oblique_move_only_blocked_on_the_occupied_corner():
    """Blocking one L-shaped corner should remove only that bend order,
    not the whole destination, as long as the other corner is clear."""
    board = Board()
    cube = make_cube(x=2, y=2, value=2)
    board.place(cube)
    board.place(make_cube(color="black", x=3, y=2))  # corner for the x-then-y path to (3,3)
    moves = {(m.x, m.y): m.bends for m in board.legal_moves(cube)}
    assert moves[(3, 3)] == frozenset({Bend.Y_THEN_X})


def test_cannot_land_on_own_color_but_can_capture_enemy():
    board = Board()
    cube = make_cube(color="white", x=4, y=4, value=1)
    board.place(cube)
    board.place(make_cube(color="white", x=4, y=5))
    board.place(make_cube(color="black", x=4, y=3))
    dests = {(m.x, m.y) for m in board.legal_moves(cube)}
    assert (4, 5) not in dests  # own color: blocked
    assert (4, 3) in dests  # enemy: capturable


def test_out_of_bounds_destinations_are_excluded():
    board = Board()
    cube = make_cube(x=0, y=0, value=2)
    board.place(cube)
    dests = {(m.x, m.y) for m in board.legal_moves(cube)}
    assert all(0 <= x < 9 and 0 <= y < 8 for x, y in dests)
    assert (-2, 0) not in dests


# ── GameEngine: selection, moves, turns, victory ─────────────────────────

def empty_engine() -> GameEngine:
    engine = GameEngine()
    engine.board = Board()
    return engine


def test_select_ignores_opponents_and_empty_squares():
    engine = empty_engine()
    engine.board.place(make_cube(color="black", x=4, y=4, value=1))
    assert engine.select(4, 4) == []
    assert engine.selected is None
    assert engine.select(0, 0) == []


def test_move_updates_position_value_and_switches_turn():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    engine.move(4, 4, 4, 5, bend=None)

    assert engine.board.at(4, 4) is None
    moved = engine.board.at(4, 5)
    assert moved is not None and moved.color == "white"
    assert engine.turn == "black"


def test_move_captures_enemy_cube():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    engine.board.place(make_cube(color="black", x=4, y=5))
    engine.move(4, 4, 4, 5, bend=None)
    captured_square = engine.board.at(4, 5)
    assert captured_square is not None and captured_square.color == "white"


def test_move_rejects_unreachable_square():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    with pytest.raises(IllegalMove):
        engine.move(4, 4, 4, 6, bend=None)  # value=1 cube can't jump 2


def test_move_requires_bend_for_oblique_destination():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=2))
    with pytest.raises(IllegalMove):
        engine.move(4, 4, 5, 5, bend=None)


def test_move_rejects_bend_whose_corner_is_blocked():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=2, y=2, value=2))
    engine.board.place(make_cube(color="black", x=3, y=2))  # blocks x_then_y's corner
    with pytest.raises(IllegalMove):
        engine.move(2, 2, 3, 3, bend="x")
    engine.move(2, 2, 3, 3, bend="y")  # the other order is still open


def test_capturing_the_king_wins_immediately():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    engine.board.place(Cube(color="black", is_king=True, x=4, y=5, orientation=Orientation.standard()))
    engine.move(4, 4, 4, 5, bend=None)
    assert engine.winner == "white"


def test_king_reaching_enemy_home_square_wins():
    engine = empty_engine()
    engine.board.place(Cube(color="white", is_king=True, x=4, y=6, orientation=Orientation.standard()))
    engine.move(4, 6, 4, 7, bend=None)
    assert engine.winner == "white"


def test_no_moves_allowed_after_the_game_is_won():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    engine.board.place(Cube(color="black", is_king=True, x=4, y=5, orientation=Orientation.standard()))
    engine.move(4, 4, 4, 5, bend=None)
    assert engine.winner == "white"
    with pytest.raises(IllegalMove):
        engine.move(4, 5, 4, 6, bend=None)
