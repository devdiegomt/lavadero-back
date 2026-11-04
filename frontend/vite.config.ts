import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Qlarity — Panel del lavadero',
        short_name: 'Qlarity',
        description: 'La operación de tu lavadero, clara: turnos, tablero, pagos y clientes.',
        theme_color: '#121416',
        background_color: '#17191B',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // A sangre y con la Q dentro de la zona segura: Android recorta el
          // ícono con la máscara del teléfono (círculo, gota, cuadrado).
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // **Las respuestas de la API no se guardan en el teléfono.** Antes había
        // un `runtimeCaching` que copiaba cinco minutos todo GET a `/api/`
        // —clientes, teléfonos, placas, pagos— en el almacenamiento del
        // navegador. Ahí quedaban aunque se cerrara la sesión, y con la red
        // caída se mostraban sin pedir sesión. En un teléfono que comparten
        // varios operarios eso es entregar datos personales a quien lo levante
        // (Ley 1581). El costo: sin red, el panel no muestra datos viejos.
        //
        // Y `/api` es ahora del mismo origen (Vercel la reenvía al backend):
        // sin esto, navegar a una URL de la API devolvería el HTML del panel.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      // Habilita @/ como alias de src/ (alineado con tsconfig paths)
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});