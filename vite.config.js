import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard is the React app in src/. The /api functions run on Vercel;
// `vercel dev` serves them locally, plain `vite` does not.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
