export type AiDifficulty = "easy" | "hard";
export type RoomRole = "white" | "black" | "spectator";

export interface ZoomConfig {
  min: number;
  max: number;
  initial: number;
  onChange: (distance: number) => void;
}

export interface RoomConfig {
  shareUrl: string;
}

export class Hud {
  private readonly turnEl: HTMLElement;
  private readonly winnerBanner: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly difficultyDialog: HTMLElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly zoomMin: number;
  private readonly zoomMax: number;
  private readonly vsAiButton: HTMLElement;
  private readonly newGameButton: HTMLElement;
  private readonly roomStatusEl: HTMLElement | null;
  private readonly menuEl: HTMLElement;
  private readonly menuToggle: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private errorTimeout: ReturnType<typeof setTimeout> | null = null;

  private lastVsAi = false;
  private lastDifficulty: AiDifficulty = "easy";

  constructor(
    root: HTMLElement,
    onNewGame: (vsAi: boolean, difficulty: AiDifficulty) => void,
    onPlayOnline: () => void,
    zoom: ZoomConfig,
    room?: RoomConfig,
  ) {
    this.zoomMin = zoom.min;
    this.zoomMax = zoom.max;

    root.innerHTML = `
      <div id="hud">
        <div id="hud-bar">
          <div id="turn-indicator"></div>
          ${room ? `<span id="room-status"></span>` : ""}
          <button id="hud-toggle" type="button" aria-label="Menu" aria-expanded="false">&#9776;</button>
        </div>
        <div id="hud-menu">
          <button id="new-game-button" type="button">New game</button>
          <button id="vs-ai-button" type="button">Play vs AI</button>
          <button id="play-online-button" type="button">Play online</button>
          <div id="zoom-control">
            <span aria-hidden="true">&minus;</span>
            <input type="range" id="zoom-slider" min="${zoom.min}" max="${zoom.max}" step="0.1" aria-label="Zoom" />
            <span aria-hidden="true">+</span>
          </div>
          <button id="fullscreen-button" type="button">Fullscreen</button>
          ${
            room
              ? `<div id="room-bar">
                   <input type="text" id="room-link" readonly value="${room.shareUrl}" />
                   <button id="room-copy-button" type="button">Copy link</button>
                 </div>`
              : ""
          }
          <div id="credits">Yuriy Sagadatov, Alexey Lagunov, Claude Code</div>
        </div>
      </div>
      <div id="difficulty-dialog" class="hidden">
        <div id="difficulty-dialog-box">
          <div id="difficulty-dialog-title">Choose AI difficulty</div>
          <div id="difficulty-dialog-buttons">
            <button id="difficulty-easy-button" type="button">Easy</button>
            <button id="difficulty-hard-button" type="button">Hard</button>
          </div>
          <button id="difficulty-cancel-button" type="button">Cancel</button>
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
    this.difficultyDialog = root.querySelector("#difficulty-dialog") as HTMLElement;
    this.zoomSlider = root.querySelector("#zoom-slider") as HTMLInputElement;
    this.vsAiButton = root.querySelector("#vs-ai-button") as HTMLElement;
    this.newGameButton = root.querySelector("#new-game-button") as HTMLElement;
    this.roomStatusEl = root.querySelector("#room-status");
    this.menuEl = root.querySelector("#hud-menu") as HTMLElement;
    this.menuToggle = root.querySelector("#hud-toggle") as HTMLButtonElement;
    this.fullscreenButton = root.querySelector("#fullscreen-button") as HTMLButtonElement;

    // iOS Safari has no Fullscreen API at all (a standalone-installed PWA
    // there is already borderless, so there's nothing for the button to
    // do); feature-detect rather than assume desktop Chrome's support.
    if (!document.documentElement.requestFullscreen) {
      this.fullscreenButton.classList.add("hidden");
    } else {
      this.fullscreenButton.addEventListener("click", () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      });
      document.addEventListener("fullscreenchange", () => this.updateFullscreenLabel());
      this.updateFullscreenLabel();
    }

    this.menuToggle.addEventListener("click", () => this.toggleMenu());
    // Outside taps close the menu -- without this it stays open over the
    // board on mobile until the user hits an action button inside it.
    document.addEventListener("pointerdown", (e) => {
      if (!this.menuEl.classList.contains("open")) return;
      if (this.menuEl.contains(e.target as Node) || this.menuToggle.contains(e.target as Node)) return;
      this.closeMenu();
    });

    const start = (vsAi: boolean, difficulty: AiDifficulty): void => {
      this.lastVsAi = vsAi;
      this.lastDifficulty = difficulty;
      onNewGame(vsAi, difficulty);
      this.closeMenu();
    };
    const playOnlineButton = root.querySelector("#play-online-button") as HTMLElement;

    if (room) {
      // A room is always exactly two humans -- "vs AI" and "start another
      // online room from inside this one" don't apply.
      this.vsAiButton.classList.add("hidden");
      playOnlineButton.classList.add("hidden");
      root.querySelector("#room-copy-button")!.addEventListener("click", () => {
        void navigator.clipboard.writeText(room.shareUrl);
      });
    } else {
      playOnlineButton.addEventListener("click", () => {
        this.closeMenu();
        onPlayOnline();
      });
    }

    root.querySelector("#new-game-button")!.addEventListener("click", () => start(false, this.lastDifficulty));
    this.vsAiButton.addEventListener("click", () => {
      this.closeMenu();
      this.showDifficultyDialog();
    });
    root.querySelector("#difficulty-easy-button")!.addEventListener("click", () => {
      this.hideDifficultyDialog();
      start(true, "easy");
    });
    root.querySelector("#difficulty-hard-button")!.addEventListener("click", () => {
      this.hideDifficultyDialog();
      start(true, "hard");
    });
    root.querySelector("#difficulty-cancel-button")!.addEventListener("click", () => this.hideDifficultyDialog());
    root.querySelector("#winner-new-game")!.addEventListener("click", () => start(this.lastVsAi, this.lastDifficulty));

    this.setZoomDistance(zoom.initial);
    this.zoomSlider.addEventListener("input", () => {
      zoom.onChange(this.sliderToDistance(Number(this.zoomSlider.value)));
    });
  }

  private showDifficultyDialog(): void {
    this.difficultyDialog.classList.remove("hidden");
  }

  private hideDifficultyDialog(): void {
    this.difficultyDialog.classList.add("hidden");
  }

  /** On wide screens #hud-menu is always visible via CSS regardless of
   * this class, so toggling it there is harmless -- it only matters once
   * the narrow-screen media query switches the menu to a hidden dropdown. */
  private toggleMenu(): void {
    if (this.menuEl.classList.contains("open")) this.closeMenu();
    else this.openMenu();
  }

  private openMenu(): void {
    this.menuEl.classList.add("open");
    this.menuToggle.setAttribute("aria-expanded", "true");
  }

  private closeMenu(): void {
    this.menuEl.classList.remove("open");
    this.menuToggle.setAttribute("aria-expanded", "false");
  }

  private updateFullscreenLabel(): void {
    this.fullscreenButton.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  }

  setTurn(turn: "white" | "black", vsAi = false): void {
    const side = turn === "white" ? "White" : "Black";
    this.turnEl.textContent = vsAi && turn === "black" ? "AI is thinking…" : `${side} to move`;
  }

  /** Room-only: shows which seat this connection holds and, while the
   * other seat is still empty, that the game hasn't really started yet.
   * Also hides "New game" for spectators, who the server would reject
   * anyway -- this just avoids a pointless error toast. */
  setRoomStatus(role: RoomRole | null, bothPlayersPresent: boolean | null): void {
    if (!this.roomStatusEl) return;
    if (role === "spectator") {
      this.roomStatusEl.textContent = "You are spectating";
      this.newGameButton.classList.add("hidden");
      return;
    }
    const side = role === "white" ? "White" : "Black";
    this.roomStatusEl.textContent =
      bothPlayersPresent === false ? `You are ${side} — waiting for an opponent to join…` : `You are ${side}`;
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
