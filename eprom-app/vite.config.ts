import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Repo deployed at https://netgroup.github.io/proms-qa/ — assets must be
// prefixed with the repo path in production; dev server stays at root.
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: command === 'build' ? '/proms-qa/' : '/',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
  },
}))
