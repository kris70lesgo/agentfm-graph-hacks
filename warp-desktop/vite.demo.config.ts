import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  optimizeDeps: { entries: ['demo.html'] },
  build: {
    outDir: 'out/demo',
    rollupOptions: { input: resolve(__dirname, 'demo.html') },
  },
})
