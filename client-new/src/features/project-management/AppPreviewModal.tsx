import { useRef } from 'react';
import { X, Minimize2, Maximize } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { cn } from '../../shared/utils/cn';
import { useI18n } from '../../shared/i18n/useI18n';

export function AppPreviewModal() {
  const { activeModal, closeModal, previewCode, previewUrl, previewMaximized, setPreviewMaximized } = useLayoutStore();
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isVisible = activeModal === 'modal-app-preview';

  if (!isVisible) return null;

  const handleToggleMaximize = () => setPreviewMaximized(!previewMaximized);

  return (
    <div className={cn(
      "fixed inset-0 bg-transparent z-[70] flex items-center justify-center",
      previewMaximized ? "p-1.5 sm:p-2" : "p-4"
    )}>
      <div 
        className="absolute inset-0 bg-gray-900/10 dark:bg-black/20 backdrop-blur-[2px]" 
        onClick={closeModal}
      />
      <div 
        ref={containerRef}
        className={cn(
          "bg-white dark:bg-[#0a0a0a] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden transform transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] relative z-10",
          previewMaximized 
            ? "w-full h-full rounded-2xl border border-gray-200/50 dark:border-gray-800/50" 
            : "w-[min(94vw,1440px)] h-[88vh] rounded-3xl border border-gray-200/50 dark:border-gray-800/50"
        )}
      >
        <div className="flex-1 bg-white flex items-center justify-center relative">
          <iframe 
            ref={iframeRef}
            id="preview-iframe" 
            className="absolute inset-0 w-full h-full border-none bg-white"
            title={t('preview.title')}
            sandbox={previewUrl ? 'allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads' : 'allow-scripts allow-forms allow-modals allow-popups allow-downloads'}
            referrerPolicy="no-referrer"
            src={previewUrl || undefined}
            srcDoc={previewUrl ? undefined : (previewCode || '')}
          ></iframe>
          
          <button 
            className="absolute bottom-8 right-8 p-4 bg-gray-950/90 hover:bg-black text-white rounded-2xl transition-all backdrop-blur-xl shadow-2xl z-[100] border border-white/10 active:scale-90 group" 
            title={previewMaximized ? t('common.collapse') : t('common.expand')}
            onClick={handleToggleMaximize}
          >
            {previewMaximized ? <Minimize2 className="w-7 h-7" /> : <Maximize className="w-7 h-7" />}
          </button>
          
          <button 
            className="absolute top-6 right-6 p-2 bg-gray-100/80 dark:bg-black/40 hover:bg-white dark:hover:bg-black text-gray-500 hover:text-red-500 rounded-full transition-all backdrop-blur-md z-[100] border border-gray-200 dark:border-white/5 shadow-sm active:scale-90"
            onClick={closeModal}
            title={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
