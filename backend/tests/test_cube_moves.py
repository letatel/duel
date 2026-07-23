from app.game.cube import Cube, Direction, Orientation


def test_orientation_opposite_faces_sum_to_seven():
    o = Orientation.standard()
    assert o.top + o.bottom == 7
    assert o.north + o.south == 7
    assert o.east + o.west == 7


def test_rolling_north_then_south_returns_to_start():
    o = Orientation.standard(top=1, north=2, east=3)
    rolled = o.rolled(Direction.NORTH).rolled(Direction.SOUTH)
    assert rolled == o


def test_rolling_east_then_west_returns_to_start():
    o = Orientation.standard(top=1, north=2, east=3)
    rolled = o.rolled(Direction.EAST).rolled(Direction.WEST)
    assert rolled == o


def test_four_rolls_in_same_direction_returns_to_start():
    o = Orientation.standard()
    rolled = o
    for _ in range(4):
        rolled = rolled.rolled(Direction.NORTH)
    assert rolled == o


def test_rolling_preserves_opposite_face_invariant():
    o = Orientation.standard()
    for direction in Direction:
        rolled = o.rolled(direction)
        assert rolled.top + rolled.bottom == 7
        assert rolled.north + rolled.south == 7
        assert rolled.east + rolled.west == 7


def test_pawn_value_is_top_face():
    cube = Cube(color="white", is_king=False, x=0, y=0, orientation=Orientation.standard(top=4))
    assert cube.value == 4


def test_king_value_is_always_one():
    cube = Cube(color="white", is_king=True, x=4, y=0, orientation=Orientation.standard(top=6))
    assert cube.value == 1


def test_rolled_to_updates_position_and_orientation():
    cube = Cube(color="white", is_king=False, x=2, y=2, orientation=Orientation.standard())
    moved = cube.rolled_to(Direction.EAST)
    assert (moved.x, moved.y) == (3, 2)
    assert moved.orientation != cube.orientation


def test_rolled_to_king_moves_without_changing_orientation():
    cube = Cube(color="white", is_king=True, x=4, y=0, orientation=Orientation.standard())
    moved = cube.rolled_to(Direction.NORTH)
    assert (moved.x, moved.y) == (4, 1)
    assert moved.orientation == cube.orientation
