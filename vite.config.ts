import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // относительные пути — демо должно открываться и из подкаталога (GitHub Pages)
  base: './',
  plugins: [react()],
  build: { target: 'es2020', assetsInlineLimit: 2048 },
})
