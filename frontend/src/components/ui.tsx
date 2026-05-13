import {
  useState,
  useEffect,
  useMemo,
  createContext,
  useContext,
  useCallback,
  type ReactNode,
  type FC,
} from "react";

// ─── Toast ────────────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastApi {
  success(msg: string): void;
  error(msg: string): void;
  info(msg: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastType = "success", duration = 3000) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        duration,
      );
    },
    [],
  );

  // Referencia ESTABLE entre renders — sin esto, cualquier `useEffect` o
  // `useCallback` que tenga `toast` en deps re-corre en bucle infinito porque
  // el objeto inline se reconstruye en cada render del provider (que ocurre
  // cada vez que un toast se agrega o quita).
  const toast = useMemo<ToastApi>(
    () => ({
      success: (msg) => addToast(msg, "success"),
      error: (msg) => addToast(msg, "error", 5000),
      info: (msg) => addToast(msg, "info"),
    }),
    [addToast],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-in max-w-sm ${
              t.type === "success"
                ? "bg-green-600 text-white"
                : t.type === "error"
                  ? "bg-red-600 text-white"
                  : "bg-gray-800 text-white"
            }`}
          >
            <span className="mr-2">
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de ToastProvider");
  return ctx;
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: (() => void) | null;
  actionLabel?: string;
}

export const EmptyState: FC<EmptyStateProps> = ({
  icon = "📭",
  title,
  description,
  action,
  actionLabel,
}) => (
  <div className="text-center py-16 px-4">
    <span className="text-5xl block mb-4">{icon}</span>
    <p className="text-gray-700 font-semibold mb-1">{title}</p>
    {description && (
      <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
        {description}
      </p>
    )}
    {action && (
      <button
        onClick={action}
        className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition"
      >
        {actionLabel ?? "Crear"}
      </button>
    )}
  </div>
);

// ─── LoadingSpinner ───────────────────────────────────────────────────────────

export const LoadingSpinner: FC<{ text?: string }> = ({
  text = "Cargando...",
}) => (
  <div className="flex flex-col items-center justify-center py-16">
    <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-3" />
    <p className="text-sm text-gray-400">{text}</p>
  </div>
);

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

export const SkeletonCard: FC<{ count?: number; height?: string }> = ({
  count = 3,
  height = "h-20",
}) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={`bg-white rounded-xl ${height} animate-pulse`} />
    ))}
  </div>
);

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm(): void;
  onCancel(): void;
  danger?: boolean;
  variant?: "default" | "danger";
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  danger = false,
  variant,
}) => {
  const isRed = danger || variant === "danger";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 text-white text-sm font-semibold rounded-xl transition ${
              isRed
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand-600 hover:bg-brand-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand";

const BADGE_STYLES: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-600",
  success: "bg-green-100 text-green-700",
  warning: "bg-yellow-100 text-yellow-700",
  danger: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
  brand: "bg-brand-100 text-brand-700",
};

export const Badge: FC<{ children: ReactNode; variant?: BadgeVariant }> = ({
  children,
  variant = "default",
}) => (
  <span
    className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_STYLES[variant]}`}
  >
    {children}
  </span>
);

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: string;
  sub?: string;
  onClick?: () => void;
}

export const StatCard: FC<StatCardProps> = ({
  label,
  value,
  icon,
  sub,
  onClick,
}) => {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-100 p-4 text-left ${onClick ? "hover:shadow-md transition cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-lg">{icon}</span>}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Comp>
  );
};

// ─── usePullToRefresh ─────────────────────────────────────────────────────────

export function usePullToRefresh(onRefresh: () => void): void {
  useEffect(() => {
    let startY = 0;
    let pulling = false;

    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (pulling && e.changedTouches[0].clientY - startY > 80) onRefresh();
      pulling = false;
    };

    document.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onRefresh]);
}
