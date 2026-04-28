import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const port = process.env.VITE_API_PORT || fileEnv.VITE_API_PORT || 3001
  const target = `http://localhost:${port}`
  // eslint-disable-next-line no-console
  console.log(`[vite] proxying /api → ${target}`)
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: { proxy: { '/api': target } },
  }
})
