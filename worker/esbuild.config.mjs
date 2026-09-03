// Bundles the viz SPA (webapp/) into public/app.js + public/app.css (issue #19764: "bundle
// with esbuild in deploy.yml so the deploy stays reproducible"). Run via `npm run
// build:webapp` -- wired into .github/workflows/deploy.yml before `wrangler deploy` so the
// committed webapp/ source, not a hand-built bundle, is what ships.

import { build } from "esbuild";

await build({
  entryPoints: ["webapp/main.tsx"],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: "esm",
  target: "es2020",
  outfile: "public/app.js",
  jsx: "automatic",
  loader: { ".css": "css" },
  logLevel: "info",
});
