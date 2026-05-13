import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (!sessionStorage.getItem('pwa-dismissed')) setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') setShow(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    sessionStorage.setItem('pwa-dismissed', 'true');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 z-40 max-w-sm mx-auto">
      <div className="bg-brand-700 text-white rounded-2xl p-4 shadow-xl flex items-center gap-3">
        <span className="text-3xl">🚿</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Instalar Carwash</p>
          <p className="text-xs text-brand-200">Accede más rápido desde tu pantalla de inicio</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleDismiss} className="text-xs text-brand-300 hover:text-white px-2 py-1">No</button>
          <button onClick={handleInstall}
            className="bg-white text-brand-700 text-xs font-semibold px-3 py-1.5 rounded-lg">
            Instalar
          </button>
        </div>
      </div>
    </div>
  );
}