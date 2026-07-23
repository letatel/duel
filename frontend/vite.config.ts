import { defineConfig } from "vite";

// Served in production at https://letatel.com:8443/duel/ (see docker-compose.yml
// + deploy/nginx), so built asset URLs (JS/CSS/models) need this prefix baked
// in. Only applied for `vite build` -- `base` also affects the dev server's
// own path if set unconditionally, which would break the plain
// http://localhost:5173/ `npm run dev` workflow.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/duel/" : "/",
}));
