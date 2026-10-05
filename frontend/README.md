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
- Super admin: la que hayas puesto en `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`
  del backend → redirige a `/admin`

> ⚠️ Sólo para desarrollo. El super admin ve **todos** los lavaderos: en
> cualquier entorno accesible desde internet, aunque sea una demo, esa cuenta va
> con una contraseña propia. El backend ya no tiene una por defecto.

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
e2e/                        # Pruebas en navegador (Playwright)
├── ayudas.ts               # Entrar al panel; comprobar que hay backend
├── sesion.spec.ts          # La cookie httpOnly, vista por un navegador
├── mi-cuenta.spec.ts       # Cambiar la contraseña propia, y que cierre sesiones
├── movil.spec.ts           # RNF-COM-3: que el panel quepa y se pueda tocar
└── tema.spec.ts            # Que el panel siga el modo claro u oscuro del teléfono

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
│   ├── api.js              # Wrapper de fetch; access token en memoria, refresh en cookie
│   ├── estados.tsx         # Estados de un turno, la placa, y cómo se dibujan
│   ├── metodos-pago.ts     # Métodos de pago con su ícono
│   ├── format.js           # formatCOP, formatDateTime
│   └── sentry.jsx          # Init opcional de Sentry
└── pages/
    ├── AccountPage.tsx         # Mi cuenta: cambiar la contraseña propia
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
    └── SuperAdminPage.jsx      # 3 tabs: Resumen, Lavaderos, Planes
```

---

## Diseño: Grafito latón

Grafito con **latón como único acento**. Es oscuro, o claro si el teléfono
está en claro. Usa Archivo como única familia, ancha en títulos y cifras, más
IBM Plex Mono para placas y horas. Se eligió entre varias
propuestas: el panel anterior usaba los colores por defecto de Tailwind y 130
emojis, y para un lavadero exclusivo se veía infantil.

### Dónde viven los colores

En `src/index.css`, como variables. `tailwind.config.js` hace que cada escala
(`gray`, `brand`, `green`, `red`…) lea de ahí, así que **ningún componente tiene
un color escrito a mano**.

Las escalas están **invertidas**: `gray-50` es el fondo más oscuro y `gray-900`
el texto más claro. Por eso las clases conservan su significado —`bg-gray-50`
es «fondo», `text-gray-900` es «texto principal», `bg-green-50 text-green-700`
es «insignia verde»— y el rediseño no tuvo que tocar cada clase. `white` es la
superficie de las tarjetas: `text-white` sobre un botón de latón da texto
oscuro, que es lo correcto.

### Modo día, automático

El panel sigue el modo del teléfono o de la computadora: **oscuro** si está en
oscuro, **claro** («Grafito día») si está en claro. No hay botón. Cambia solo
cuando el sistema cambia, por ejemplo al atardecer si el teléfono lo hace
automático.

Ojo con una consecuencia: un equipo que nunca cambió su modo está en claro,
porque ése es el valor por defecto de los navegadores. Así que **la mayoría de
las computadoras van a ver el modo día**, y el oscuro aparece donde alguien lo
eligió.

Es un bloque de variables bajo `@media (prefers-color-scheme: light)` en
`index.css`. Ahí las escalas van en el orden normal (50 claro, 900 oscuro),
así que cada clase dice lo mismo en los dos modos y **ningún componente sabe
en qué modo está**. El latón se oscurece en claro para que el botón principal
tenga 5:1 de contraste con su texto; la placa queda igual en los dos, porque
una placa es amarilla siempre.

Para verlo en la computadora: DevTools → Rendering → *Emulate CSS media
feature prefers-color-scheme*. `e2e/tema.spec.ts` comprueba los dos modos.

### Reglas

- **Sin emojis.** Íconos de `lucide-react`, con `aria-hidden` cuando acompañan
  un texto. Un emoji entra en el nombre accesible del botón y un lector de
  pantalla lo lee.
- **Un solo acento.** Latón (`brand`) para la acción principal y lo activo.
  Verde, azul, rojo y amarillo son **estados**, no decoración.
- **El estado se ve por la forma**, no sólo por el color: Esperando es un
  anillo, Lavando un punto con halo, Listo un punto lleno. Están en
  `src/lib/estados.tsx` y todas las pantallas leen de ahí.
- **La placa se dibuja como placa** —amarilla, letras negras— con `<Placa>`.
  Es lo que el operario busca cuando llega un carro.
- **Tipografías empaquetadas** (`@fontsource`), no de Google Fonts: la PWA
  tiene que verse igual sin red, y cada fuente externa es un tercero más
  recibiendo datos de quien usa el panel.

---

## Scripts

```bash
npm run dev        # Vite dev server (con --host expone en LAN)
npm run build      # Build de producción → dist/
npm run preview    # Sirve dist/ localmente para verificar build
npm run typecheck  # tsc --noEmit sobre src/ y e2e/
npm run e2e        # Pruebas en navegador (ver abajo)
npm run e2e:ui     # Las mismas, en modo interactivo
```

---

## Pruebas en navegador

`e2e/` corre el panel en Chromium con Playwright, en dos tamaños: escritorio
(Desktop Chrome) y móvil (Pixel 5).

Existen por dos razones. La primera es **RNF-COM-3** —que el panel funcione en
móvil— que hasta ahora se había mirado, no comprobado. La segunda es la que las
hizo urgentes: **la sesión vive en una cookie `httpOnly` y eso no se puede
probar sin un navegador.** Las pruebas del backend usan `supertest`, que copia
cabeceras: no aplica `HttpOnly`, ni `SameSite`, ni `Path`, ni decide si una
petición cross-origin lleva la cookie.

La primera corrida encontró dos fallas que las 500+ pruebas del backend no
podían ver, las dos introducidas por el cambio de sesión a cookie:

- Escribir mal la contraseña decía **"Sesión expirada"**. Un 401 del login
  disparaba el camino de renovar el token.
- Entrar a Pagos o a Config **cerraba la sesión sola**. El backend rota el
  refresh token en cada uso; al cargar una pantalla el panel dispara varias
  consultas a la vez, todas sin access token, y cada una pedía su propia
  renovación. Ganaba una y las demás llegaban con un token ya revocado.

### Los cinco navegadores

`escritorio` y `móvil` son Chromium; `firefox`, `safari` y `safari-móvil` son los
otros dos motores. `NAVEGADORES` los filtra:

```bash
NAVEGADORES=escritorio npm run e2e        # sólo uno, para iterar
NAVEGADORES=safari,safari-móvil npm run e2e
```

> ⚠️ Los proyectos de Firefox y Safari **nunca se corrieron** donde se
> escribieron: el entorno bloqueaba el CDN de Playwright. La configuración es
> correcta, pero la primera corrida de verdad es la tuya. Que encuentren algo es
> el punto — **WebKit es el más restrictivo con cookies**, y si el panel y la API
> quedan en sitios distintos es donde la sesión tiene más chance de romperse.

### Cómo correrlas

El dev server de Vite lo levanta Playwright. El backend no —vive en otro
repositorio y necesita su base— así que va aparte:

```bash
# Terminal 1: el backend
cd ../lavadero-back
npm run db:reset
NODE_ENV=development RATE_LIMIT_MAX=100000 STRICT_RATE_LIMIT_MAX=100 npm run dev

# Terminal 2: las pruebas
npx playwright install            # una sola vez: los tres motores
npm run e2e
```

Los límites altos no son cosmética: `STRICT_RATE_LIMIT_MAX` son cinco intentos
de login fallidos por email cada quince minutos, y la prueba de la contraseña
equivocada gasta uno por corrida y por proyecto. Sin subirlo, la sexta corrida
falla como si el login estuviera roto. Las pruebas lo detectan y lo dicen antes
de empezar.

Si hay un Chromium instalado pero no el que Playwright pide, `CHROMIUM_PATH`
apunta al binario y se saltea la descarga.

### Lo que no cubren

- **`SameSite` de verdad.** `localhost:5173` y `localhost:3000` son orígenes
  distintos pero el *mismo sitio*, así que la cookie viaja igual. En producción
  el panel y la API sí están en sitios distintos: ver abajo.

---

## PWA

La app es instalable como PWA. La configuración está en `vite.config.ts` con `vite-plugin-pwa`. Service worker generado automáticamente en `npm run build`.

Los íconos `public/icon-192.png` y `icon-512.png` salen de `public/favicon.svg`. El manifiesto los pedía desde el principio, pero no existían: instalar el panel daba un ícono genérico.

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

Luego en `main.tsx`:

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

### CORS y la cookie de sesión

Si el backend está en otro dominio, asegúrate de que `CORS_ORIGIN` en el backend incluya el dominio del frontend.

Y hay una segunda cosa, que no es CORS y se confunde con CORS. La sesión vive en
una cookie `httpOnly`; el navegador decide si la manda según **`SameSite`**, que
mira el sitio, no el origen:

| Panel | API | ¿Mismo sitio? | Qué hace falta |
|---|---|---|---|
| `localhost:5173` | `localhost:3000` | Sí (el puerto no cuenta) | Nada: `Lax` alcanza |
| `panel.tu-dominio.com` | `api.tu-dominio.com` | Sí | Nada: `Lax` alcanza |
| `tu-panel.vercel.app` | `tu-api.up.railway.app` | **No** | `AUTH_COOKIE_SAMESITE=none` en el backend, y HTTPS |

El tercer caso es el que muerde: todo anda en local, se despliega, el login
parece funcionar y la sesión se cae en la primera recarga sin ningún error que
lo explique —el navegador simplemente no mandó la cookie—. Con `SameSite=None`
la cookie es obligatoriamente `Secure`, así que el backend tiene que estar en
HTTPS.

Lo más simple es evitar el caso: poner el panel y la API bajo el mismo dominio
con subdominios distintos.

---

## Troubleshooting

**Login funciona pero al recargar pierde sesión**
- Casi siempre es la cookie, no el token. El access token vive en memoria y no
  se persiste: al recargar hay que pedir uno nuevo con la cookie `refresh_token`.
  Si el navegador no la manda, no hay sesión que restaurar.
- En DevTools → Application → Cookies: la cookie tiene que estar, con
  `HttpOnly` y `Path=/api/auth`. Si no está, el navegador nunca la guardó —falta
  `Access-Control-Allow-Credentials: true` del backend, o `CORS_ORIGIN` no
  coincide exactamente con el origen del panel (el `*` no sirve con credenciales).
- Si está pero no viaja: es `SameSite`. Ver "CORS y la cookie de sesión".
- Y recién después: que `JWT_SECRET` no haya cambiado en el backend.

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