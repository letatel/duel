import pytest

from app.game.board import Bend, Board
from app.game.cube import Cube, Direction, Orientation
from app.game.engine import GameEngine, IllegalMove, LastMove


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


def test_initial_pawn_orientations_are_all_physically_reachable():
    # Regression test: the starting layout used to pick each pawn's
    # east/west by numeric sort rather than physical chirality, which built
    # a mirror-image orientation for half the board -- correct at rest, but
    # silently diverging from the frontend's geometric reconstruction after
    # the first east/west roll (see test_cube_moves.py's
    # test_from_top_and_north_matches_every_physically_reachable_orientation
    # for the underlying invariant this checks against).
    start = Orientation.standard()
    reachable = {(start.top, start.north): start}
    frontier = [start]
    while frontier:
        next_frontier = []
        for o in frontier:
            for direction in Direction:
                rolled = o.rolled(direction)
                key = (rolled.top, rolled.north)
                if key not in reachable:
                    reachable[key] = rolled
                    next_frontier.append(rolled)
        frontier = next_frontier

    board = Board.initial()
    for x in range(9):
        if x == 4:
            continue
        for y in (0, 7):
            o = board.at(x, y).orientation
            assert reachable[(o.top, o.north)] == o, f"x={x} y={y}"


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


# ── Board.attacks (single-square reachability, used by the AI's king-
# safety heuristic instead of the pricier full legal_moves) ──────────────

def test_attacks_agrees_with_legal_moves_for_every_reachable_square():
    board = Board()
    cube = make_cube(x=2, y=2, value=3)
    board.place(cube)
    reachable = {(m.x, m.y) for m in board.legal_moves(cube)}
    for x in range(9):
        for y in range(8):
            assert board.attacks(cube, x, y) == ((x, y) in reachable), f"({x},{y})"


def test_attacks_is_false_for_wrong_distance():
    board = Board()
    cube = make_cube(x=2, y=2, value=3)
    board.place(cube)
    assert board.attacks(cube, 3, 2) is False  # one square, not three


def test_attacks_is_false_when_the_path_is_blocked():
    board = Board()
    cube = make_cube(x=0, y=0, value=2)
    board.place(cube)
    board.place(make_cube(color="white", x=1, y=0, value=1))  # blocks the only path there
    assert board.attacks(cube, 2, 0) is False


def test_attacks_is_false_onto_a_square_held_by_the_same_color():
    board = Board()
    cube = make_cube(color="white", x=0, y=0, value=2)
    board.place(cube)
    board.place(make_cube(color="white", x=2, y=0, value=1))
    assert board.attacks(cube, 2, 0) is False


def test_attacks_is_false_out_of_bounds():
    board = Board()
    cube = make_cube(x=0, y=0, value=2)
    board.place(cube)
    assert board.attacks(cube, -2, 0) is False


# ── Move-preview values (for the client's per-tile die-value hint) ───────

def test_straight_move_reports_the_resulting_value():
    board = Board()
    # top=1, north=2, south=5: rolling one step north brings the old south
    # face (5) up to the top.
    cube = Cube(color="white", is_king=False, x=4, y=4, orientation=Orientation.standard())
    board.place(cube)
    moves = {(m.x, m.y): m for m in board.legal_moves(cube)}
    move = moves[(4, 5)]
    assert move.bends == frozenset({Bend.STRAIGHT})
    assert move.resulting_values == {Bend.STRAIGHT: 5}


def test_oblique_move_reports_a_different_value_per_bend_order():
    # A hand-verified case where the two roll orders leave different faces
    # up -- this is exactly why the original game splits the preview
    # marker in two for these tiles instead of showing one number.
    orientation = Orientation(top=2, bottom=5, north=1, south=6, east=3, west=4)
    cube = Cube(color="white", is_king=False, x=4, y=4, orientation=orientation)
    board = Board()
    board.place(cube)
    moves = {(m.x, m.y): m for m in board.legal_moves(cube)}
    move = moves[(5, 5)]  # dx=1, dy=1: reachable via either bend order
    assert move.bends == frozenset({Bend.X_THEN_Y, Bend.Y_THEN_X})
    assert move.resulting_values == {Bend.X_THEN_Y: 6, Bend.Y_THEN_X: 4}


def test_king_move_value_is_always_one():
    king = Cube(color="white", is_king=True, x=4, y=4, orientation=Orientation.standard())
    board = Board()
    board.place(king)
    moves = {(m.x, m.y): m for m in board.legal_moves(king)}
    assert moves[(4, 5)].resulting_values == {Bend.STRAIGHT: 1}


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


# ── last_move / move_count (drives the client's move animation) ─────────

def test_move_records_last_move_and_increments_move_count():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    assert engine.move_count == 0
    assert engine.last_move is None

    engine.move(4, 4, 4, 5, bend=None)

    assert engine.move_count == 1
    assert engine.last_move == LastMove(4, 4, 4, 5, Bend.STRAIGHT)


def test_reset_clears_last_move_and_move_count():
    engine = empty_engine()
    engine.board.place(make_cube(color="white", x=4, y=4, value=1))
    engine.move(4, 4, 4, 5, bend=None)
    engine.reset()
    assert engine.move_count == 0
    assert engine.last_move is None


# ── AI turn ownership (ai_color) ──────────────────────────────────────────

def test_ai_color_blocks_human_select_and_move_on_its_turn():
    engine = GameEngine()
    engine.reset(ai_color="white")  # AI plays white, which moves first
    assert engine.select(4, 0) == []  # a human can't select white's king either
    with pytest.raises(IllegalMove):
        engine.move(0, 0, 0, 1, bend=None)


def test_maybe_ai_move_does_nothing_when_it_is_not_the_ai_turn():
    engine = GameEngine()
    engine.reset(ai_color="black")  # human (white) moves first
    assert engine.maybe_ai_move() is False
    assert engine.move_count == 0


def test_maybe_ai_move_plays_for_the_ai_and_returns_to_human_turn():
    engine = GameEngine()
    engine.reset(ai_color="black")
    engine.move(4, 0, 4, 1, bend=None)  # human plays white's king
    assert engine.turn == "black"

    moved = engine.maybe_ai_move()

    assert moved is True
    assert engine.turn == "white"
    assert engine.move_count == 2
    assert engine.last_move is not None


def test_reset_defaults_ai_difficulty_to_easy():
    engine = GameEngine()
    engine.reset(ai_color="black")
    assert engine.ai_difficulty == "easy"


def test_maybe_ai_move_uses_the_hard_difficulty_when_selected():
    engine = GameEngine()
    engine.reset(ai_color="black", ai_difficulty="hard")
    assert engine.ai_difficulty == "hard"
    engine.move(4, 0, 4, 1, bend=None)  # human plays white's king

    moved = engine.maybe_ai_move()

    assert moved is True
    assert engine.turn == "white"
