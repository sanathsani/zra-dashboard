import { defineConfig } from 'vite'

// The dashboard is plain HTML, CSS and JS served from public/app, so there is
// no React plugin and no bundling step to go wrong. The /api functions run on
// Vercel; `vercel dev` serves them locally, plain `vite` does not.
export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true },
})
