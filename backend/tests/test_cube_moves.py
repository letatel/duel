from app.game.cube import Cube, Direction, Orientation


def _reachable_orientations() -> dict[tuple[int, int], Orientation]:
    """Every orientation reachable from the standard start by rolling,
    keyed by (top, north) -- used to check from_top_and_north against
    actual physical reachability instead of a hardcoded expectation."""
    start = Orientation.standard()
    seen = {(start.top, start.north): start}
    frontier = [start]
    while frontier:
        next_frontier = []
        for o in frontier:
            for direction in Direction:
                rolled = o.rolled(direction)
                key = (rolled.top, rolled.north)
                if key not in seen:
                    seen[key] = rolled
                    next_frontier.append(rolled)
        frontier = next_frontier
    return seen


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


def test_from_top_and_north_matches_every_physically_reachable_orientation():
    # Regression test for a real bug: the original starting-layout code
    # picked east/west for each pawn by sorting the two leftover face
    # values numerically, which for half the board produced a
    # mirror-image orientation no rotation could ever actually reach.
    # That pawn would render correctly at rest (only top/north are drawn)
    # but silently disagree with the frontend's geometrically-reconstructed
    # mesh the first time it rolled along the east/west axis, showing the
    # wrong face on top from then on (reported as die values "2 and 5
    # swapping"). from_top_and_north must always pick the same east/west
    # as physically rolling a real die to that (top, north) would.
    reachable = _reachable_orientations()
    assert len(reachable) == 24  # every one of the 24 rotational states of a cube

    for (top, north), expected in reachable.items():
        built = Orientation.from_top_and_north(top, north)
        assert built == expected
