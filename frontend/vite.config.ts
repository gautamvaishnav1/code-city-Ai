import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5199,
    strictPort: true,
    // same-origin API in dev — no CORS ever
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: false,
      },
      // socket.io streams real analysis progress (same origin, no CORS)
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: false,
      },
    },
  },
})
