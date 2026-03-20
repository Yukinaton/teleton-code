import { AlertTriangle, X } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useDeleteSession } from '../../entities/workspace/useWorkspaceQuery';
import { useChatStore } from '../../entities/chat/useChatStore';
import { useI18n } from '../../shared/i18n/useI18n';

export function DeleteChatModal() {
  const { activeModal, closeModal, showToast } = useLayoutStore();
  const { targetId, clearTarget } = useContextStore();
  const { t } = useI18n();
  const deleteMutation = useDeleteSession();

  const isVisible = activeModal === 'modal-delete-chat';

  if (!isVisible) return null;

  const handleClose = () => {
    clearTarget();
    closeModal();
  };

  const handleDelete = async () => {
    if (!targetId) return;
    try {
      const { setActiveWorkspace, setActiveSession, fetchMessages } = useChatStore.getState();
      const payload = await deleteMutation.mutateAsync(targetId);
      const nextWorkspaceId = payload?.data?.activeWorkspaceId || null;
      const nextSessionId = payload?.data?.activeSessionId || null;

      setActiveWorkspace(nextWorkspaceId);
      setActiveSession(nextSessionId);
      if (nextSessionId) {
        void fetchMessages(nextSessionId);
      }
      
      showToast(t('deleteChat.deleted'));
      handleClose();
    } catch (_e) {
      showToast(t('deleteChat.error'));
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all modal-content pop-in relative">
        <button onClick={handleClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors z-10"><X className="w-5 h-5" /></button>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center text-red-600 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('deleteChat.title')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('deleteChat.description')}</p>
          </div>
        </div>
        
        <div className="flex justify-center gap-3 mt-6">
          <button onClick={handleClose} className="px-5 py-2.5 text-sm font-semibold bg-gray-100 dark:bg-graphite-hover hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-colors w-full border border-transparent dark:border-graphite-border">
            {t('common.cancel')}
          </button>
          <button 
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="px-5 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors shadow-sm w-full"
          >
            {deleteMutation.isPending ? t('deleteChat.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
