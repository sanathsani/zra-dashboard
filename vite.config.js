import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/data': {
        target: 'https://script.google.com',
        changeOrigin: true,
        rewrite: () => '/macros/s/AKfycby_sOH1E-FVyAlt7g5TY9iPMNNVR4DZAsu56V17WNaksNNv1cJOUhEeNDh7CTDkRQ0x/exec',
        followRedirects: true,
        secure: true,
      }
    }
  }
})
