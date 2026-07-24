import { defineConfig } from "vite";

// Served in production at https://letatel.com:8443/duel/ (see docker-compose.yml
// + deploy/nginx), so built asset URLs (JS/CSS/models) need this prefix baked
// in. Only applied for `vite build` -- `base` also affects the dev server's
// own path if set unconditionally, which would break the plain
// http://localhost:5173/ `npm run dev` workflow.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/duel/" : "/",
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
