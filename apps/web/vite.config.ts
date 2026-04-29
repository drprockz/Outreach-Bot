import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// During the apps/api ↔ src/api transition, the dashboard talks to two
// backends. Auth, billing, and GraphQL live on the new TypeScript server
// (apps/api). Most REST data routes (/api/overview, /api/leads, /api/errors,
// /api/replies, /api/run-engine, /api/saved-views, ...) still live on the
// legacy Express server (src/api).
//
// New API runs on :3001 in dev so Google's existing OAuth redirect URI
// (http://localhost:3001/auth/google/callback) keeps working without a
// Google Cloud Console edit. Legacy is moved to :3002.
//
// Override with VITE_NEW_API_PORT / VITE_LEGACY_API_PORT if needed.
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const newPort =
    process.env.VITE_NEW_API_PORT ||
    fileEnv.VITE_NEW_API_PORT ||
    process.env.VITE_API_PORT ||
    fileEnv.VITE_API_PORT ||
    3001
  const legacyPort =
    process.env.VITE_LEGACY_API_PORT || fileEnv.VITE_LEGACY_API_PORT || 3002
  const next = `http://localhost:${newPort}`
  const legacy = `http://localhost:${legacyPort}`
  // eslint-disable-next-line no-console
  console.log(`[vite] new /graphql,/auth,/api/{me,otp,billing,auth/{logout,token}} → ${next} · legacy /api → ${legacy}`)
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        // New API — order matters: more specific paths first so they match
        // before the catch-all `/api` rule below.
        '/graphql': { target: next, ws: true, changeOrigin: true },
        '/auth': { target: next, changeOrigin: true },
        '/api/me': { target: next, changeOrigin: true },
        '/api/otp': { target: next, changeOrigin: true },
        '/api/billing': { target: next, changeOrigin: true },
        '/api/auth/logout': { target: next, changeOrigin: true },
        '/api/auth/token': { target: next, changeOrigin: true },

        // Everything else under /api/* is the legacy Express server.
        '/api': { target: legacy, changeOrigin: true },
      },
    },
  }
})
