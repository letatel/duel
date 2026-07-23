from fastapi.testclient import TestClient

from app.game.room import Room
from app.main import app


# ── Room: role assignment / release ─────────────────────────────────────

def test_first_connection_becomes_white_second_becomes_black_rest_spectate():
    room = Room()
    assert room.assign_role("conn1") == "white"
    assert room.assign_role("conn2") == "black"
    assert room.assign_role("conn3") == "spectator"
    assert room.assign_role("conn4") == "spectator"


def test_release_frees_a_players_seat_for_the_next_joiner():
    room = Room()
    room.assign_role("white_conn")
    room.release("white_conn")
    assert room.assign_role("new_conn") == "white"


def test_release_of_a_spectator_removes_only_that_one():
    room = Room()
    room.assign_role("white_conn")
    room.assign_role("black_conn")
    room.assign_role("spec1")
    room.assign_role("spec2")
    room.release("spec1")
    assert room.spectators == ["spec2"]


def test_is_empty_reflects_every_seat_and_spectator_being_released():
    room = Room()
    room.assign_role("conn1")
    assert room.is_empty() is False
    room.release("conn1")
    assert room.is_empty() is True


def test_connections_lists_players_before_spectators():
    room = Room()
    room.assign_role("white_conn")
    room.assign_role("black_conn")
    room.assign_role("spec1")
    assert room.connections() == ["white_conn", "black_conn", "spec1"]


# ── /ws/room/{id}: integration over the real ASGI app ───────────────────

def test_two_players_get_opposite_roles_and_see_each_others_moves():
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-1") as white_ws:
        white_state = white_ws.receive_json()
        assert white_state["role"] == "white"
        assert white_state["bothPlayersPresent"] is False

        with client.websocket_connect("/ws/room/test-room-1") as black_ws:
            black_state = black_ws.receive_json()
            assert black_state["role"] == "black"
            assert black_state["bothPlayersPresent"] is True

            # White is already connected, so joining also re-broadcasts to
            # them -- their "waiting for an opponent" should clear too.
            joined_state = white_ws.receive_json()
            assert joined_state["bothPlayersPresent"] is True

            # White's king can step forward one square.
            white_ws.send_json({"type": "move", "fromX": 4, "fromY": 0, "toX": 4, "toY": 1})
            after_white = white_ws.receive_json()
            after_black = black_ws.receive_json()

            assert after_white["turn"] == "black"
            assert after_black["turn"] == "black"
            assert after_white["moveNumber"] == 1
            assert after_black["moveNumber"] == 1


def test_a_third_connection_to_the_same_room_is_a_spectator():
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-2") as white_ws:
        white_ws.receive_json()
        with client.websocket_connect("/ws/room/test-room-2") as black_ws:
            black_ws.receive_json()
            with client.websocket_connect("/ws/room/test-room-2") as spectator_ws:
                spectator_state = spectator_ws.receive_json()
                assert spectator_state["role"] == "spectator"


def test_spectator_move_is_rejected_and_does_not_change_state():
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-3") as white_ws:
        white_ws.receive_json()
        with client.websocket_connect("/ws/room/test-room-3") as black_ws:
            black_ws.receive_json()
            with client.websocket_connect("/ws/room/test-room-3") as spectator_ws:
                spectator_ws.receive_json()

                spectator_ws.send_json({"type": "move", "fromX": 4, "fromY": 0, "toX": 4, "toY": 1})
                error = spectator_ws.receive_json()
                assert error["type"] == "error"


def test_black_cannot_move_a_white_cube_on_whites_turn():
    # A malicious or buggy black client sending a move for a white cube
    # while it's white's turn: engine.move only checks that the *cube*
    # belongs to the side to move, not that the *connection* making the
    # request is that side -- the room endpoint has to enforce that itself.
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-4") as white_ws:
        white_ws.receive_json()
        with client.websocket_connect("/ws/room/test-room-4") as black_ws:
            black_ws.receive_json()

            black_ws.send_json({"type": "move", "fromX": 4, "fromY": 0, "toX": 4, "toY": 1})
            error = black_ws.receive_json()
            assert error["type"] == "error"


def test_black_cannot_select_while_it_is_whites_turn():
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-5") as white_ws:
        white_ws.receive_json()
        with client.websocket_connect("/ws/room/test-room-5") as black_ws:
            black_ws.receive_json()

            black_ws.send_json({"type": "select", "x": 4, "y": 0})
            error = black_ws.receive_json()
            assert error["type"] == "error"


def test_spectator_cannot_start_a_new_game():
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-6") as white_ws:
        white_ws.receive_json()
        with client.websocket_connect("/ws/room/test-room-6") as black_ws:
            black_ws.receive_json()
            with client.websocket_connect("/ws/room/test-room-6") as spectator_ws:
                spectator_ws.receive_json()

                spectator_ws.send_json({"type": "new_game"})
                error = spectator_ws.receive_json()
                assert error["type"] == "error"


def test_a_departing_players_seat_is_announced_and_freed():
    client = TestClient(app)
    with client.websocket_connect("/ws/room/test-room-7") as white_ws:
        white_ws.receive_json()  # white's own join
        with client.websocket_connect("/ws/room/test-room-7") as black_ws:
            black_ws.receive_json()  # black's own join
            joined_state = white_ws.receive_json()  # "black joined" reaching white
            assert joined_state["bothPlayersPresent"] is True
        # black_ws's context manager just closed the connection.

        # White should get a fresh state broadcast (still just themself and
        # an empty black seat) once black's disconnect is processed.
        freed_state = white_ws.receive_json()
        assert freed_state["role"] == "white"
        assert freed_state["bothPlayersPresent"] is False

        # A new connection to the same room, while white is still here,
        # should take black's now-empty seat rather than white's.
        with client.websocket_connect("/ws/room/test-room-7") as new_black_ws:
            state = new_black_ws.receive_json()
            assert state["role"] == "black"
