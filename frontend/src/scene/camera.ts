import * as THREE from "three";

// Port of Assets/Scripts/CameraControl.cs: orbits around a fixed target,
// right-drag to rotate around the vertical axis, scroll to zoom, and
// snaps to face whichever side is currently on move.
export const ZOOM_MIN = 3;
export const ZOOM_MAX = 16;
const ZOOM_STEP = 0.4;
const DRAG_SPEED = 0.3; // degrees per pixel
const TURN_LERP_SPEED = 4; // per second

export class OrbitCameraController {
  private distance = 13;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.Vector3;
  private pitchDeg = 50;
  private yawDeg = 0;
  private targetYawDeg = 0;
  private dragging = false;
  private lastPointerX = 0;

  constructor(camera: THREE.PerspectiveCamera, target: THREE.Vector3, domElement: HTMLElement) {
    this.camera = camera;
    this.target = target;
    domElement.addEventListener("wheel", (e) => this.onWheel(e), { passive: true });
    domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    this.applyImmediate();
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

  setDistance(distance: number): void {
    this.distance = THREE.MathUtils.clamp(distance, ZOOM_MIN, ZOOM_MAX);
  }

  update(deltaSeconds: number): void {
    const t = 1 - Math.exp(-TURN_LERP_SPEED * deltaSeconds);
    this.yawDeg = THREE.MathUtils.lerp(this.yawDeg, this.targetYawDeg, t);
    this.apply();
  }

  private onWheel(event: WheelEvent): void {
    this.distance += (event.deltaY > 0 ? 1 : -1) * ZOOM_STEP;
    this.distance = THREE.MathUtils.clamp(this.distance, ZOOM_MIN, ZOOM_MAX);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 2) return;
    this.dragging = true;
    this.lastPointerX = event.clientX;
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastPointerX;
    this.lastPointerX = event.clientX;
    this.targetYawDeg += dx * DRAG_SPEED;
    this.yawDeg = this.targetYawDeg;
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
