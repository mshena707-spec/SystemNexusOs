import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, loadEnv } from 'vite';

/**
 * Packages that only ever run on the SERVER (database drivers, mail, admin SDKs, ...).
 *
 * The browser app reaches a few of them through lazy `await import('pg')`-style calls
 * inside shared "engine" files. Those calls are guarded and never execute in a browser,
 * but a bundler still tries to follow them — and firebase-admin in particular ships a
 * .wasm file that made `vite build` (and therefore every Railway deploy) fail.
 * Marking them "external" tells the bundler to leave those lazy calls alone instead of
 * pulling the whole server SDK into the customer's download.
 */
const SERVER_ONLY_PACKAGES = [
  'firebase-admin',
  'mongodb',
  'pg',
  'pg-native',
  'ioredis',
  'redis',
  'better-sqlite3',
  '@libsql/client',
  '@supabase/supabase-js',
  'nodemailer',
  '@sentry/node',
  '@socket.io/redis-adapter',
  'socket.io',
  'node-cron',
  'speakeasy',
  'qrcode',
  'prom-client',
  'stripe',
  'dotenv',
  'express',
  'farmhash-modern',
];

const isServerOnly = (id: string) =>
  SERVER_ONLY_PACKAGES.some((pkg) => id === pkg || id.startsWith(pkg + '/'));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Nexus Universal System',
          short_name: 'Nexus',
          description: 'Next Gen E-Commerce & Operations Management',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Only cache the app shell. Never cache WASM / 3D models / API traffic.
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          globIgnores: ['**/*.wasm', '**/*.glb', '**/*.gltf'],
          maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15MB
          // A page navigation to /api/... (payment redirects, webhooks, downloads) must
          // reach the server, not be answered with the single-page-app shell.
          navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/__\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    define: {
      // SECURITY FIX: Only expose GEMINI key to client (used by browser-side AI adapters).
      // OpenAI / HuggingFace / Groq keys must NEVER be bundled into the client - server-side only.
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
      // Expose APP_URL for self-referential links
      'process.env.APP_URL': JSON.stringify(env.APP_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        external: (id: string) => isServerOnly(id),
        output: {
          // Split the big, rarely-changing libraries into their own files so the
          // first screen loads fast and returning customers re-download less.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(three|@react-three)\//.test(id)) return 'vendor-3d';
            if (/node_modules\/(leaflet|react-leaflet)\//.test(id)) return 'vendor-maps';
            if (/node_modules\/recharts\//.test(id) || /node_modules\/d3-/.test(id)) return 'vendor-charts';
            if (/node_modules\/(firebase|@firebase)\//.test(id)) return 'vendor-firebase';
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react';
            return undefined;
          },
        },
      },
      chunkSizeWarningLimit: 1500,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // Proxy API calls to Express server in dev
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:3000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
