import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  optimizeDeps: { exclude: ['pyodide'] },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: [
            'node_modules/pyodide/pyodide.js',
            'node_modules/pyodide/pyodide.asm.mjs',
            'node_modules/pyodide/pyodide.asm.wasm',
          ],
          dest: 'assets',
        },
      ],
    }),
  ],
  server: {
    port: 3000,
  },
})
