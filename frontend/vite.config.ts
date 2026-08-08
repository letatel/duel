import { defineConfig, type Plugin } from "vite";

// The itch.io build (`vite build --mode itch`, see .env.itch) has to strip two
// things out of index.html that only make sense on our own domain. Doing it
// here rather than keeping a second index.html avoids the two drifting apart.
function itchIndexHtml(): Plugin {
  return {
    name: "itch-index-html",
    transformIndexHtml(html: string) {
      return (
        html
          // Analytics for the itch build comes from itch's own dashboard, and a
          // third-party tracker inside someone else's iframe is a liability
          // there. The counter is delimited by a matching comment pair.
          .replace(/\s*<!-- Yandex\.Metrika counter -->[\s\S]*?<!-- \/Yandex\.Metrika counter -->/, "")
          // The PWA manifest describes an installable app at an absolute
          // start_url on our origin -- meaningless from inside an itch iframe,
          // where installing isn't on offer anyway. (favicon and
          // apple-touch-icon stay: harmless, and used by itch's standalone view.)
          .replace(/\s*<link rel="manifest"[^>]*>/, "")
      );
    },
  };
}

// Served in production at https://letatel.com/duel/ (see docker-compose.yml
// + deploy/nginx), so built asset URLs (JS/CSS/models) need this prefix baked
// in. Only applied for `vite build` -- `base` also affects the dev server's
// own path if set unconditionally, which would break the plain
// http://localhost:5173/ `npm run dev` workflow.
//
// The exception is `--mode itch`: an itch.io HTML game is served from
// https://html-classic.itch.zone/html/<id>/ inside an iframe, where <id>
// changes on every re-upload, so no prefix can be baked in at all. A relative
// base makes every URL -- the bundle, the /favicon.svg reference in
// index.html, and import.meta.env.BASE_URL, which is what scene/models.ts and
// ui/splash.ts build their .glb and banner URLs from -- resolve against
// whatever path the game happens to be sitting at.
export default defineConfig(({ command, mode }) => ({
  base: mode === "itch" ? "./" : command === "build" ? "/duel/" : "/",
  plugins: mode === "itch" ? [itchIndexHtml()] : [],
  // Bind to all interfaces (not just localhost) so the dev server is
  // reachable from a phone on the same LAN, e.g. for mobile-touch testing.
  server: { host: true },
  // `vite preview` serves the production bundle as static files but has no
  // idea about the backend -- unlike the real deploy, where nginx proxies
  // /duel/ws/game to it (see deploy/nginx/*.conf). Without this, a
  // `vite build` + `vite preview` combo used for LAN/mobile testing (fewer,
  // more reliable requests than raw `vite dev`'s hundreds of unbundled
  // module files) loads the board fine but never receives any game state,
  // since that only ever arrives over this socket.
  //
  // Not needed for an itch build: that one talks to the deployed backend
  // outright (VITE_WS_BASE), so it needs no proxy in front of it.
  preview: {
    host: true,
    proxy: {
      "/duel/ws": {
        target: "ws://127.0.0.1:8010",
        ws: true,
        rewrite: (path: string) => path.replace(/^\/duel/, ""),
      },
    },
  },
}));
