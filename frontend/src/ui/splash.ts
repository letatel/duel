// The title screen: covers the (initially empty) scene while the piece and
// board .glb models load, then becomes the game's main menu -- mode
// selection and Authors live here rather than in the HUD (see ui/hud.ts),
// and the HUD's "Main menu" button brings it back mid-game via show().

export interface SplashHandlers {
  /** Local hot-seat game: two humans sharing one screen. */
  onTwoPlayers: () => void;
  onVsAi: () => void;
  /** Omitted where creating a room is pointless -- see showMenu(), which then
   * hides the button rather than offering a dead one. */
  onPlayOnline?: () => void;
  onAuthors: () => void;
}

export class Splash {
  private readonly el: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly menuEl: HTMLElement;
  private readonly resumeButton: HTMLButtonElement;

  /** `roomMode` (the page was opened from a ?room=... invite link) drops the
   * mode buttons: a room is always two humans on two devices, so "vs AI" and
   * "start another online room from inside this one" don't apply -- the same
   * reasoning Hud applies to its own `room` flag. */
  constructor(root: HTMLElement, roomMode: boolean) {
    // "Back to game" comes last and starts hidden: on the very first display
    // this is a title screen, and picking a mode is the only way in (see
    // show(), which reveals it from then on). In a room there is no mode to
    // pick, so it *is* the entry point -- first and visible from the start.
    const buttons = roomMode
      ? `<button id="splash-resume" class="splash-primary" type="button">Continue</button>
         <button id="splash-authors" type="button">Authors</button>`
      : `<button id="splash-two-players" class="splash-primary" type="button">Two players</button>
         <button id="splash-vs-ai" type="button">Play vs AI</button>
         <button id="splash-online" type="button">Play online</button>
         <button id="splash-authors" type="button">Authors</button>
         <button id="splash-resume" class="hidden" type="button">Back to game</button>`;

    root.innerHTML = `
      <div id="splash">
        <img id="splash-banner" src="${import.meta.env.BASE_URL}banner.png" alt="DiceFight" />
        <div id="splash-status">Loading…</div>
        <div id="splash-menu" class="hidden">${buttons}</div>
      </div>
    `;

    this.el = root.querySelector("#splash") as HTMLElement;
    this.statusEl = root.querySelector("#splash-status") as HTMLElement;
    this.menuEl = root.querySelector("#splash-menu") as HTMLElement;
    this.resumeButton = root.querySelector("#splash-resume") as HTMLButtonElement;

    this.resumeButton.addEventListener("click", () => this.hide());
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!this.canResume()) return;
      // Never out from under an open dialog -- while one of those is up it
      // owns what Escape means. They live in Hud's DOM, hence the query
      // instead of a reference.
      if (document.querySelector("#difficulty-dialog:not(.hidden), #authors-dialog:not(.hidden)")) return;
      this.hide();
    });
  }

  /** Whether there's a game behind the menu to go back to. The resume button
   * can only be *clicked* when this holds (the whole menu is `display: none`
   * until showMenu(), so the models are loaded by then), but Escape reaches
   * the button regardless of whether it's on screen -- so it has to check
   * the menu's visibility too, not just the button's. */
  private canResume(): boolean {
    return !this.menuEl.classList.contains("hidden") && !this.resumeButton.classList.contains("hidden");
  }

  /** Called once the models are loaded and the Hud exists, so the handlers
   * have something to act on. Until then the screen shows only "Loading…"
   * with no buttons at all, so an impatient tap can't reveal a board with no
   * pieces on it yet. */
  showMenu(handlers: SplashHandlers): void {
    this.statusEl.classList.add("hidden");
    this.menuEl.classList.remove("hidden");
    // Optional chaining, not `!`: the mode buttons don't exist in room mode.
    this.menuEl.querySelector("#splash-two-players")?.addEventListener("click", handlers.onTwoPlayers);
    this.menuEl.querySelector("#splash-vs-ai")?.addEventListener("click", handlers.onVsAi);
    const onlineButton = this.menuEl.querySelector("#splash-online");
    if (handlers.onPlayOnline) onlineButton?.addEventListener("click", handlers.onPlayOnline);
    else onlineButton?.classList.add("hidden");
    this.menuEl.querySelector("#splash-authors")!.addEventListener("click", handlers.onAuthors);
  }

  /** The menu never arrives if loading failed, so replace "Loading…" rather
   * than leaving it pulsing forever with no way in. */
  showLoadError(message: string): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.add("error");
  }

  hide(): void {
    if (this.el.classList.contains("dismissed")) return;
    this.el.classList.add("dismissed");
    // Fade out but keep the element -- unlike a one-shot splash, this one is
    // reopened by the HUD's "Main menu" button. The re-check inside covers a
    // show() landing mid-fade, which would otherwise have this stale listener
    // hide the freshly reopened menu.
    this.el.addEventListener(
      "transitionend",
      () => {
        if (this.el.classList.contains("dismissed")) this.el.style.visibility = "hidden";
      },
      { once: true },
    );
  }

  show(): void {
    this.el.style.visibility = "";
    this.el.classList.remove("dismissed");
    // Reopened mid-game: from here on there's a game behind the menu to go
    // back to, so offer that as a way out of it.
    this.resumeButton.classList.remove("hidden");
  }
}
