import * as THREE from "three";
import type { Direction } from "./path";

// Rolls a cube mesh across a sequence of unit grid steps. Each step is a
// world-space 90-degree tip about a fixed axis (not the object's local,
// already-rotated axes), which is what makes a physical die's face values
// change correctly as it rolls. The rotation constants below are derived
// to match backend/app/game/cube.py's Orientation.rolled exactly -- see
// the comment on scene/cube.ts's canonical face layout -- so the visible
// top face always agrees with the server's authoritative die value once
// the roll finishes, without the animation ever needing to read it back.
const STEP_DURATION_MS = 260;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const STEP_QUATERNIONS: Record<Direction, THREE.Quaternion> = {
  north: new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2),
  south: new THREE.Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2),
  east: new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -Math.PI / 2),
  west: new THREE.Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2),
};

const STEP_DELTA: Record<Direction, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
};

interface StepState {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  endQuat: THREE.Quaternion;
  elapsedMs: number;
}

export class RollAnimation {
  private readonly mesh: THREE.Object3D;
  private readonly steps: Direction[];
  private index = 0;
  private step: StepState | null = null;

  constructor(mesh: THREE.Object3D, steps: Direction[]) {
    this.mesh = mesh;
    this.steps = steps;
    this.beginStep();
  }

  get finished(): boolean {
    return this.step === null;
  }

  update(deltaMs: number): void {
    const step = this.step;
    if (!step) return;

    step.elapsedMs += deltaMs;
    const t = Math.min(1, step.elapsedMs / STEP_DURATION_MS);
    this.mesh.position.lerpVectors(step.startPos, step.endPos, t);
    this.mesh.quaternion.slerpQuaternions(step.startQuat, step.endQuat, t);

    if (t >= 1) {
      this.index += 1;
      this.beginStep();
    }
  }

  private beginStep(): void {
    const direction = this.steps[this.index];
    if (!direction) {
      this.step = null;
      return;
    }
    const [dx, dz] = STEP_DELTA[direction];
    const startPos = this.mesh.position.clone();
    const endPos = startPos.clone().add(new THREE.Vector3(dx, 0, dz));
    const startQuat = this.mesh.quaternion.clone();
    const endQuat = STEP_QUATERNIONS[direction].clone().multiply(startQuat);
    this.step = { startPos, endPos, startQuat, endQuat, elapsedMs: 0 };
  }
}
