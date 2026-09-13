import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' keeps asset paths relative so the build works on GitHub Pages
// project sites (https://<user>.github.io/<repo>/) without knowing the repo name.
export default defineConfig({
  plugins: [react()],
  base: './',
})
