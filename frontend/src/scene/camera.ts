import * as THREE from "three";

// Port of Assets/Scripts/CameraControl.cs: orbits around a fixed target,
// right-drag to rotate around the vertical axis, scroll to zoom, and
// snaps to face whichever side is currently on move.
export const ZOOM_MIN = 3;
// Floor for the zoomed-out limit -- the actual ceiling is computed per
// viewport by refitToViewport() (see below) and is only ever raised above
// this, never lowered, so desktop's slider range doesn't change.
export const ZOOM_MAX_BASE = 16;
const ZOOM_STEP = 0.4;
const DRAG_SPEED = 0.3; // degrees per pixel
const TURN_LERP_SPEED = 4; // per second

// Board is a 9x8 grid of 1-unit tiles starting at the world origin (see
// scene/board.ts); pieces stand up to ~1.2 units tall (king crown
// included) -- refitToViewport() keeps this whole box on screen.
const BOARD_MIN_X = 0;
const BOARD_MAX_X = 9;
const BOARD_MIN_Z = 0;
const BOARD_MAX_Z = 8;
const BOARD_TOP_Y = 1.2;

// Fraction of the NDC [-1, 1] range the board's bounding box must land
// within after a fit -- <1 leaves visible breathing room at the edges.
// The top margin is tighter because the HUD's turn indicator/menu button
// bar sits there even when the rest of the menu is collapsed.
const FIT_MARGIN_X = 0.9;
const FIT_MARGIN_Y_TOP = 0.75;
const FIT_MARGIN_Y_BOTTOM = 0.9;

interface TouchPoint {
  x: number;
  y: number;
}

function touchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boardCorners(): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [BOARD_MIN_X, BOARD_MAX_X]) {
    for (const z of [BOARD_MIN_Z, BOARD_MAX_Z]) {
      for (const y of [0, BOARD_TOP_Y]) {
        corners.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  return corners;
}

export class OrbitCameraController {
  private distance = 13;
  // Recomputed by refitToViewport() for the current aspect ratio -- only
  // ever raised above ZOOM_MAX_BASE, never below it.
  private maxDistance = ZOOM_MAX_BASE;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.Vector3;
  private pitchDeg = 50;
  private yawDeg = 0;
  private targetYawDeg = 0;
  private dragging = false;
  private lastPointerX = 0;

  // Touch: single-finger drag orbits (there's no right mouse button to
  // gate on), two-finger pinch zooms. Tracked by pointerId so a second
  // finger landing mid-drag is detected as the start of a pinch rather
  // than a jump in the first finger's position.
  private readonly activeTouches = new Map<number, TouchPoint>();
  private touchDragging = false;
  private pinching = false;
  private pinchStartDistance = 0;
  private pinchStartCameraDistance = 0;

  constructor(camera: THREE.PerspectiveCamera, target: THREE.Vector3, domElement: HTMLElement) {
    this.camera = camera;
    this.target = target;
    domElement.addEventListener("wheel", (e) => this.onWheel(e), { passive: true });
    domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    this.applyImmediate();
    this.refitToViewport();
  }

  setWhiteTurn(): void {
    // White sits at board y=0 (world z~0); the camera must orbit to that
    // side so white's pieces are nearest camera, looking toward black.
    this.targetYawDeg = 180;
  }

  setBlackTurn(): void {
    this.targetYawDeg = 0;
  }

  getDistance(): number {
    return this.distance;
  }

  getMaxDistance(): number {
    return this.maxDistance;
  }

  setDistance(distance: number): void {
    this.distance = THREE.MathUtils.clamp(distance, ZOOM_MIN, this.maxDistance);
  }

  /** Recomputes how far out "fully zoomed out" needs to be for the
   * camera's current aspect ratio, so the whole board stays on screen --
   * a narrow phone-portrait aspect needs a much larger distance than a
   * wide desktop one to keep all 9 columns visible. Call after any change
   * to camera.aspect. Only ever zooms further out to fit, never in, so it
   * won't undo a deliberate manual zoom that already fits. */
  refitToViewport(): void {
    const fit = this.computeFitDistance();
    this.maxDistance = Math.max(ZOOM_MAX_BASE, fit);
    if (this.distance < fit) this.distance = fit;
    this.distance = THREE.MathUtils.clamp(this.distance, ZOOM_MIN, this.maxDistance);
    this.apply();
  }

  /** Binary search for the smallest distance at which the board's full
   * bounding box (all 9x8 tiles, tall enough for a king) projects within
   * FIT_MARGIN_* of the current camera's frustum. Distance increases
   * monotonically move the camera straight back along a fixed ray from
   * the target, so the projected size shrinks monotonically too --
   * bisection is safe. */
  private computeFitDistance(): number {
    const corners = boardCorners();
    const scratch = this.camera.clone();
    const fitsAt = (distance: number): boolean => {
      const yaw = THREE.MathUtils.degToRad(this.targetYawDeg);
      const pitch = THREE.MathUtils.degToRad(this.pitchDeg);
      const offset = new THREE.Vector3(0, 0, distance).applyEuler(new THREE.Euler(-pitch, yaw, 0, "YXZ"));
      scratch.position.copy(this.target).add(offset);
      scratch.lookAt(this.target);
      scratch.updateMatrixWorld(true);
      for (const corner of corners) {
        const p = corner.clone().project(scratch);
        if (Math.abs(p.x) > FIT_MARGIN_X) return false;
        if (p.y > FIT_MARGIN_Y_TOP || p.y < -FIT_MARGIN_Y_BOTTOM) return false;
      }
      return true;
    };

    let lo = ZOOM_MIN;
    let hi = 80; // generous ceiling for even extreme aspect ratios
    if (!fitsAt(hi)) return hi;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fitsAt(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** True while a pinch is in progress -- lets touch tap-handling (see
   * BoardInput) ignore the pointerup of whichever finger lifts first,
   * which would otherwise land on a board tile and select it. */
  isPinching(): boolean {
    return this.pinching;
  }

  update(deltaSeconds: number): void {
    const t = 1 - Math.exp(-TURN_LERP_SPEED * deltaSeconds);
    this.yawDeg = THREE.MathUtils.lerp(this.yawDeg, this.targetYawDeg, t);
    this.apply();
  }

  private onWheel(event: WheelEvent): void {
    this.distance += (event.deltaY > 0 ? 1 : -1) * ZOOM_STEP;
    this.distance = THREE.MathUtils.clamp(this.distance, ZOOM_MIN, this.maxDistance);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.onTouchStart(event);
      return;
    }
    if (event.button !== 2) return;
    this.dragging = true;
    this.lastPointerX = event.clientX;
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.onTouchMove(event);
      return;
    }
    if (!this.dragging) return;
    const dx = event.clientX - this.lastPointerX;
    this.lastPointerX = event.clientX;
    this.targetYawDeg += dx * DRAG_SPEED;
    this.yawDeg = this.targetYawDeg;
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.onTouchEnd(event);
      return;
    }
    this.dragging = false;
  }

  private onTouchStart(event: PointerEvent): void {
    this.activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.activeTouches.size === 1) {
      this.touchDragging = true;
      this.lastPointerX = event.clientX;
    } else if (this.activeTouches.size === 2) {
      this.touchDragging = false;
      this.pinching = true;
      const [a, b] = [...this.activeTouches.values()];
      this.pinchStartDistance = touchDistance(a, b);
      this.pinchStartCameraDistance = this.distance;
    }
  }

  private onTouchMove(event: PointerEvent): void {
    if (!this.activeTouches.has(event.pointerId)) return;
    this.activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pinching && this.activeTouches.size === 2) {
      const [a, b] = [...this.activeTouches.values()];
      const newDistance = touchDistance(a, b);
      if (this.pinchStartDistance > 0 && newDistance > 0) {
        const ratio = this.pinchStartDistance / newDistance;
        this.distance = THREE.MathUtils.clamp(this.pinchStartCameraDistance * ratio, ZOOM_MIN, this.maxDistance);
      }
      return;
    }

    if (this.touchDragging && this.activeTouches.size === 1) {
      const dx = event.clientX - this.lastPointerX;
      this.lastPointerX = event.clientX;
      this.targetYawDeg += dx * DRAG_SPEED;
      this.yawDeg = this.targetYawDeg;
    }
  }

  private onTouchEnd(event: PointerEvent): void {
    this.activeTouches.delete(event.pointerId);
    if (this.activeTouches.size === 0) {
      this.touchDragging = false;
      this.pinching = false;
    } else if (this.activeTouches.size === 1) {
      // Went from pinching (2 touches) down to 1 -- resume single-finger
      // drag from here rather than the old pre-pinch baseline, or the
      // remaining finger's position would cause a sudden yaw jump.
      this.pinching = false;
      this.touchDragging = true;
      const remaining = [...this.activeTouches.values()][0];
      this.lastPointerX = remaining.x;
    }
  }

  private applyImmediate(): void {
    this.yawDeg = this.targetYawDeg;
    this.apply();
  }

  private apply(): void {
    const yaw = THREE.MathUtils.degToRad(this.yawDeg);
    const pitch = THREE.MathUtils.degToRad(this.pitchDeg);
    const offset = new THREE.Vector3(0, 0, this.distance).applyEuler(
      new THREE.Euler(-pitch, yaw, 0, "YXZ"),
    );
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }
}
