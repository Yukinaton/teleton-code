import { CheckCircle, X } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useI18n } from '../../shared/i18n/useI18n';

export function SuccessModal() {
  const { activeModal, closeModal } = useLayoutStore();
  const { t } = useI18n();

  const isVisible = activeModal === 'modal-success';

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-sm rounded-2xl shadow-2xl p-6 transform transition-all modal-content pop-in text-center relative">
        <button onClick={closeModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
        <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-500 mx-auto mb-4">
          <CheckCircle className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('success.title')}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('success.description')}</p>
        <button onClick={closeModal} className="px-6 py-2.5 w-full text-sm font-semibold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-black rounded-xl transition-colors shadow-sm">
          {t('success.ok')}
        </button>
      </div>
    </div>
  );
}
