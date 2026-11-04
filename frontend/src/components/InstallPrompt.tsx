import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

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
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xl shadow-sombra flex items-center gap-3">
        <Download aria-hidden="true" size={22} strokeWidth={1.6} className="text-brand-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Instalar el panel</p>
          <p className="text-xs text-gray-500">Accede más rápido desde tu pantalla de inicio</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleDismiss} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Ahora no</button>
          <button onClick={handleInstall}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
            Instalar
          </button>
        </div>
      </div>
    </div>
  );
}