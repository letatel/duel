/// <reference types="vite/client" />

// Declaration-merged onto Vite's own ImportMetaEnv so the two build-mode
// variables below are typed rather than falling through its `any` index
// signature. Both are set only by .env.itch (`vite build --mode itch`), hence
// optional -- every other build leaves them undefined.
interface ImportMetaEnv {
  /** Absolute WebSocket origin+prefix of the deployed backend, e.g.
   *  `wss://dicefight.online/duel`. Set when the frontend is served from
   *  somewhere that has no backend behind it; see net/socket.ts. */
  readonly VITE_WS_BASE?: string;
  /** `"true"` in the itch.io build. String, not boolean: Vite env values are
   *  always strings. */
  readonly VITE_ITCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
