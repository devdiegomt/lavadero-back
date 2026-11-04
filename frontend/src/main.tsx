// ─── main.tsx ─────────────────────────────────────────────────────────────────
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

// La versión anterior del service worker guardaba las respuestas de la API en
// una caché llamada `api-cache` (ver vite.config.ts). Quitar la regla no borra
// lo que ya quedó guardado en los teléfonos: se borra acá, al abrir el panel.
if ('caches' in window) {
  void caches.delete('api-cache').catch(() => undefined);
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);