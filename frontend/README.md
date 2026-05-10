# Carwash SaaS — Frontend

PWA para gestión operativa de lavaderos de autos en Colombia. Diseñado mobile-first para que los operadores la usen desde un celular sin instalación.

**Stack**: React 18 · Vite 5 · React Router 6 · Tailwind 3 · vite-plugin-pwa

---

## Setup local

### Requisitos

- Node.js 20+
- Backend corriendo (ver [`lavadero-back`](https://github.com/devdiegomt/lavadero-back))

### Instalación

```bash
git clone https://github.com/devdiegomt/lavadero-front.git
cd lavadero-front
npm install

# Variables de entorno
echo "VITE_API_URL=http://localhost:3000/api" > .env

npm run dev
```

App en `http://localhost:5173`.

Credenciales demo (necesitas que el backend esté seedeado):
- Admin: `admin@elbrillante.co` / `admin123`
- Super admin: `superadmin@carwash-saas.com` / `super123!` → redirige a `/admin`

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `VITE_API_URL` | `/api` | URL del backend. En prod típicamente `https://api.tu-dominio.com/api` |
| `VITE_SENTRY_DSN` | — | Si está, activa Sentry. Opcional |
| `VITE_SENTRY_RELEASE` | — | Tag de release para Sentry. Opcional |
| `VITE_SENTRY_TRACES_RATE` | `0.1` | Sample rate de tracing (0.0–1.0) |

> ⚠️ Las variables `VITE_*` quedan **embebidas en el bundle** y son visibles para cualquier usuario del sitio. **Nunca pongas secrets** ahí (API keys de Alegra, claves de Anthropic, etc). Esas viven solo en el backend.

---

## Estructura

```
src/
├── App.jsx                 # Router principal
├── main.jsx                # Bootstrap (incluye initSentry)
├── components/
│   ├── ProtectedRoute.jsx  # Guard para tenant (admin/operator)
│   ├── SuperAdminRoute.jsx # Guard para /admin
│   ├── ui.jsx              # Componentes compartidos (Toast, Badge, etc)
│   ├── PlateSearch.jsx
│   └── InstallPrompt.jsx   # CTA para instalar PWA
├── hooks/
│   └── useAuth.jsx         # Auth context (login, signup, logout)
├── layouts/
│   ├── AppLayout.jsx       # Layout del tenant (sidebar + bottom nav)
│   └── SuperAdminLayout.jsx
├── lib/
│   ├── api.js              # Wrapper de fetch con refresh automático
│   ├── format.js           # formatCOP, formatDateTime
│   └── sentry.jsx          # Init opcional de Sentry
└── pages/
    ├── LoginPage.jsx
    ├── SignupPage.jsx          # Wizard de onboarding
    ├── DashboardPage.jsx       # Inicio
    ├── BoardPage.jsx           # Kanban del día
    ├── AppointmentsPage.jsx
    ├── PaymentsPage.jsx
    ├── BillingPage.jsx         # Facturas + pendientes
    ├── HistoryPage.jsx
    ├── ReportsPage.jsx
    ├── CustomersPage.jsx
    ├── SettingsPage.jsx        # 6 tabs incluyendo Facturación, WhatsApp, Plan
    └── SuperAdminPage.jsx      # 3 tabs: Dashboard, Tenants, Planes
```

---

## Scripts

```bash
npm run dev       # Vite dev server (con --host expone en LAN)
npm run build     # Build de producción → dist/
npm run preview   # Sirve dist/ localmente para verificar build
```

---

## PWA

La app es instalable como PWA. La configuración está en `vite.config.js` con `vite-plugin-pwa`. Service worker generado automáticamente en `npm run build`.

Para probar la PWA en local **necesitas el build, no el dev server**:

```bash
npm run build
npm run preview
# Abrir en Chrome → ícono de instalación en la barra de URL
```

En móvil: Android Chrome → menú → "Agregar a pantalla de inicio". iOS Safari → Compartir → "Añadir a inicio".

---

## Sentry (opcional)

Para activarlo:

```bash
npm install @sentry/react
echo "VITE_SENTRY_DSN=https://xxx@sentry.io/xxx" >> .env
```

Luego en `main.jsx`:

```jsx
import { initSentry, ErrorBoundary } from './lib/sentry';

await initSentry();

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
```

Y en `useAuth.jsx`, llamar `setUser(user)` después de login para asociar errores al usuario:

```jsx
import { setUser as setSentryUser } from '../lib/sentry';
// dentro de login() y al hidratar el user del localStorage:
setSentryUser(user);
```

---

## Despliegue

### Vercel / Netlify

1. Conectar el repo
2. Build command: `npm run build`
3. Output directory: `dist`
4. Environment variables: `VITE_API_URL=https://api.tu-dominio.com/api` (apunta al backend en producción)
5. Configurar **rewrites** para SPA: cualquier ruta no encontrada → `/index.html`. Vercel lo hace automático con `vercel.json`:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
   ```

### CORS

Si el backend está en otro dominio, asegúrate de que `CORS_ORIGIN` en el backend incluya el dominio del frontend.

---

## Troubleshooting

**Login funciona pero al recargar pierde sesión**
- El backend no está aceptando el refresh token. Verificar que `JWT_SECRET` no haya cambiado.

**`Failed to fetch` en cualquier llamada**
- Verifica `VITE_API_URL` y que el backend esté corriendo. En dev, normalmente `http://localhost:3000/api`.

**Error de CORS en consola**
- El dominio del frontend no está en `CORS_ORIGIN` del backend.

**El service worker está mostrando una versión vieja de la app**
- DevTools → Application → Service Workers → Unregister. Recargar.

**El menú "Facturación" no aparece en el sidebar**
- Solo es visible para `role='admin'`. Si eres operador, no lo verás. Si eres admin y aún no aparece, revisa el localStorage para confirmar que el rol está bien.

---

## Licencia

Privada. © Diego Mayorga / Fulcro.