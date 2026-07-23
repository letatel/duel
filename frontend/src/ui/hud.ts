export interface ZoomConfig {
  min: number;
  max: number;
  initial: number;
  onChange: (distance: number) => void;
}

export class Hud {
  private readonly turnEl: HTMLElement;
  private readonly winnerBanner: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly zoomMin: number;
  private readonly zoomMax: number;
  private errorTimeout: ReturnType<typeof setTimeout> | null = null;

  private lastVsAi = false;

  constructor(root: HTMLElement, onNewGame: (vsAi: boolean) => void, zoom: ZoomConfig) {
    this.zoomMin = zoom.min;
    this.zoomMax = zoom.max;

    root.innerHTML = `
      <div id="hud">
        <div id="turn-indicator"></div>
        <button id="new-game-button" type="button">New game</button>
        <button id="vs-ai-button" type="button">Play vs AI</button>
        <div id="zoom-control">
          <span aria-hidden="true">&minus;</span>
          <input type="range" id="zoom-slider" min="${zoom.min}" max="${zoom.max}" step="0.1" aria-label="Zoom" />
          <span aria-hidden="true">+</span>
        </div>
      </div>
      <div id="winner-banner" class="hidden">
        <span id="winner-text"></span>
        <button id="winner-new-game" type="button">Play again</button>
      </div>
      <div id="error-toast" class="hidden"></div>
    `;

    this.turnEl = root.querySelector("#turn-indicator") as HTMLElement;
    this.winnerBanner = root.querySelector("#winner-banner") as HTMLElement;
    this.errorEl = root.querySelector("#error-toast") as HTMLElement;
    this.zoomSlider = root.querySelector("#zoom-slider") as HTMLInputElement;

    const start = (vsAi: boolean): void => {
      this.lastVsAi = vsAi;
      onNewGame(vsAi);
    };
    root.querySelector("#new-game-button")!.addEventListener("click", () => start(false));
    root.querySelector("#vs-ai-button")!.addEventListener("click", () => start(true));
    root.querySelector("#winner-new-game")!.addEventListener("click", () => start(this.lastVsAi));

    this.setZoomDistance(zoom.initial);
    this.zoomSlider.addEventListener("input", () => {
      zoom.onChange(this.sliderToDistance(Number(this.zoomSlider.value)));
    });
  }

  setTurn(turn: "white" | "black", vsAi = false): void {
    const side = turn === "white" ? "White" : "Black";
    this.turnEl.textContent = vsAi && turn === "black" ? "AI is thinking…" : `${side} to move`;
  }

  setWinner(winner: "white" | "black" | null): void {
    if (winner === null) {
      this.winnerBanner.classList.add("hidden");
      return;
    }
    (this.winnerBanner.querySelector("#winner-text") as HTMLElement).textContent =
      `${winner === "white" ? "White" : "Black"} wins!`;
    this.winnerBanner.classList.remove("hidden");
  }

  showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.classList.remove("hidden");
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
    this.errorTimeout = setTimeout(() => this.errorEl.classList.add("hidden"), 2500);
  }

  /** Keeps the slider in sync with the camera distance when it changes via
   * the mouse wheel instead of the slider itself. Setting .value directly
   * doesn't fire "input", so this can't cause a feedback loop. */
  setZoomDistance(distance: number): void {
    this.zoomSlider.value = String(this.distanceToSlider(distance));
  }

  // The slider reads as a "zoom level" (right = more zoomed in), which is
  // the opposite of camera distance (smaller = closer) -- so the mapping
  // is a simple reflection within [min, max], not a passthrough.
  private distanceToSlider(distance: number): number {
    return this.zoomMin + this.zoomMax - distance;
  }

  private sliderToDistance(sliderValue: number): number {
    return this.zoomMin + this.zoomMax - sliderValue;
  }
}
