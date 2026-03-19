import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useUpdateSession, useWorkspaces } from '../../entities/workspace/useWorkspaceQuery';
import { useI18n } from '../../shared/i18n/useI18n';

export function RenameChatModal() {
  const { activeModal, closeModal, showToast } = useLayoutStore();
  const { targetId } = useContextStore();
  const { data: workspaces } = useWorkspaces();
  const { t } = useI18n();
  const updateMutation = useUpdateSession();
  const [name, setName] = useState('');

  const isVisible = activeModal === 'modal-rename-chat';
  
  useEffect(() => {
    if (isVisible && targetId && workspaces) {
      let foundTitle = '';
      for (const ws of workspaces) {
        const session = ws.sessions?.find(s => s.id === targetId);
        if (session) {
          foundTitle = session.title;
          break;
        }
      }
      setName(foundTitle || t('renameChat.defaultName'));
    }
  }, [isVisible, targetId, t, workspaces]);

  if (!isVisible) return null;

  const handleSave = async () => {
    if (!name.trim() || !targetId) return;
    try {
      await updateMutation.mutateAsync({ id: targetId, title: name });
      showToast(t('renameChat.renamed'));
      closeModal();
    } catch (_e) {
      showToast(t('renameChat.error'));
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all modal-content pop-in">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">{t('renameChat.title')}</h3>
          <button onClick={closeModal} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-1.5 mb-6">
          <label className="block text-[0.65rem] font-bold text-gray-400 uppercase tracking-widest px-1 mb-1">{t('renameChat.field')}</label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-graphite-border text-gray-900 dark:text-gray-200 rounded-lg px-4 py-3 outline-none focus:border-primary-500 focus:ring-primary-500/20 transition-all text-sm" 
            placeholder={t('renameChat.placeholder')}
          />
        </div>
        <div className="flex justify-center gap-3">
          <button onClick={closeModal} className="flex-1 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-graphite-hover rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-all border border-transparent dark:border-graphite-border">
            {t('common.cancel')}
          </button>
          <button 
            onClick={handleSave} 
            disabled={!name.trim() || updateMutation.isPending}
            className="flex-1 py-3 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl transition-all shadow-md active:opacity-80 disabled:opacity-50"
          >
            {updateMutation.isPending ? t('projectModal.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
