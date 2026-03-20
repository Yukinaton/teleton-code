import { useState, useEffect } from 'react';
import { X, Folder, Code, Database, Globe, Zap, Cpu, Terminal, Box, Layers, Wrench } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useUpdateWorkspace, useWorkspaces } from '../../entities/workspace/useWorkspaceQuery';
import { cn } from '../../shared/utils/cn';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useI18n } from '../../shared/i18n/useI18n';

const ICONS = [
  { id: 'folder', icon: Folder },
  { id: 'code', icon: Code },
  { id: 'database', icon: Database },
  { id: 'globe', icon: Globe },
  { id: 'zap', icon: Zap },
  { id: 'cpu', icon: Cpu },
  { id: 'terminal', icon: Terminal },
  { id: 'box', icon: Box },
  { id: 'layers', icon: Layers },
  { id: 'wrench', icon: Wrench },
];

export function EditProjectModal() {
  const { activeModal, closeModal, showToast } = useLayoutStore();
  const { targetId, clearTarget } = useContextStore();
  const { data: workspaces } = useWorkspaces();
  const { t } = useI18n();
  
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('folder');
  
  const updateMutation = useUpdateWorkspace();
  const isVisible = activeModal === 'modal-edit-project';
  const editingWorkspace = targetId ? workspaces?.find(w => w.id === targetId) : null;

  useEffect(() => {
    if (isVisible && editingWorkspace) {
      setName(editingWorkspace.name);
      setSelectedIcon(editingWorkspace.icon || 'folder');
    }
  }, [isVisible, editingWorkspace]);

  if (!isVisible) return null;

  const handleClose = () => {
    clearTarget();
    closeModal();
  };

  const handleSubmit = async () => {
    if (!name.trim() || !editingWorkspace) return;
    try {
      await updateMutation.mutateAsync({ id: editingWorkspace.id, name, icon: selectedIcon });
      showToast(t('editProject.saved'));
      handleClose();
    } catch (_e) {
      showToast(t('editProject.error'));
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all pop-in">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('projectModal.editTitle')}</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1 rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[0.65rem] font-bold text-gray-400 uppercase tracking-widest mb-1 px-1">{t('projectModal.projectName')}</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-graphite-border text-gray-900 dark:text-gray-200 rounded-lg px-4 py-3 outline-none focus:border-primary-500 focus:ring-primary-500/20 transition-all text-sm" 
              placeholder={t('projectModal.enterProjectName')} 
            />
          </div>
          
          <div>
            <label className="block text-[0.65rem] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('projectModal.projectIcon')}</label>
            <div className="grid grid-cols-5 gap-2">
              {ICONS.map(({ id, icon: Icon }) => (
                <button 
                  key={id} 
                  onClick={() => setSelectedIcon(id)}
                  className={cn(
                    "p-2.5 rounded-xl border transition-all flex items-center justify-center",
                    selectedIcon === id 
                      ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-600" 
                      : "border-gray-200 dark:border-graphite-border text-gray-500 hover:bg-gray-100 dark:hover:bg-graphite-hover"
                  )}
                >
                  <Icon className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="flex justify-center gap-3 mt-8">
          <button onClick={handleClose} className="flex-1 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-graphite-hover rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-all border border-transparent dark:border-graphite-border">
            {t('common.cancel')}
          </button>
          <button 
            onClick={handleSubmit}
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
