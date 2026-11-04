/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_TRACES_RATE?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  /** Enlace para elegir plan (WhatsApp o correo de ventas de Qlarity). Opcional. */
  readonly VITE_CONTACTO_VENTAS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}