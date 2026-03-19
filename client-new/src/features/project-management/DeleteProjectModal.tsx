import { AlertTriangle, X } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useDeleteWorkspace } from '../../entities/workspace/useWorkspaceQuery';
import { useI18n } from '../../shared/i18n/useI18n';

export function DeleteProjectModal() {
  const { activeModal, closeModal, showToast } = useLayoutStore();
  const { targetId } = useContextStore();
  const { t } = useI18n();
  const deleteMutation = useDeleteWorkspace();

  const isVisible = activeModal === 'modal-delete-project';

  if (!isVisible) return null;

  const handleDelete = async () => {
    if (!targetId) return;
    try {
      await deleteMutation.mutateAsync(targetId);
      showToast(t('deleteProject.deleted'));
      closeModal();
    } catch (_e) {
      showToast(t('deleteProject.error'));
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all modal-content pop-in relative">
        <button onClick={closeModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors z-10"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center text-red-600 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('deleteProject.title')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('deleteProject.description')}</p>
          </div>
        </div>
        
        <div className="flex justify-center gap-3 mt-6">
          <button onClick={closeModal} className="px-5 py-2.5 text-sm font-semibold bg-gray-100 dark:bg-graphite-hover hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-colors w-full border border-transparent dark:border-graphite-border">
            {t('common.cancel')}
          </button>
          <button 
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="px-5 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors shadow-sm w-full"
          >
            {deleteMutation.isPending ? t('deleteProject.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
