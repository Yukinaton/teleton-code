import { useState, useEffect } from 'react';
import { X, Folder, Code, Database, Globe, Zap, Cpu, Terminal, Box, Layers, Wrench } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useCreateWorkspace, useUpdateWorkspace, useWorkspaces } from '../../entities/workspace/useWorkspaceQuery';
import { cn } from '../../shared/utils/cn';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useI18n } from '../../shared/i18n/useI18n';
import { useChatStore } from '../../entities/chat/useChatStore';

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

export function ProjectModal() {
  const { activeModal, closeModal, showToast } = useLayoutStore();
  const { targetId } = useContextStore();
  const { data: workspaces } = useWorkspaces();
  const { t } = useI18n();
  const { setActiveWorkspace, setActiveSession, fetchMessages } = useChatStore();
  
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('folder');
  const [validationError, setValidationError] = useState('');
  
  const createMutation = useCreateWorkspace();
  const updateMutation = useUpdateWorkspace();
  
  const isVisible = activeModal === 'modal-new-project';
  const editingWorkspace = targetId ? workspaces?.find(w => w.id === targetId) : null;
  const isEdit = !!editingWorkspace;

  useEffect(() => {
    if (isVisible) {
      if (isEdit && editingWorkspace) {
        setName(editingWorkspace.name);
        setSelectedIcon(editingWorkspace.icon || 'folder');
      } else {
        setName('');
        setSelectedIcon('folder');
        setValidationError('');
      }
    }
  }, [isVisible, isEdit, editingWorkspace]);

  if (!isVisible) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    const engOnly = /^[a-zA-Z0-9._\- /]*$/;
    if (val && !engOnly.test(val)) setValidationError(t('common.onlyEnglish'));
    else setValidationError('');
  };

  const handleSubmit = async () => {
    if (!name.trim() || validationError) return;
    
    try {
      if (isEdit && editingWorkspace) {
        await updateMutation.mutateAsync({ id: editingWorkspace.id, name, icon: selectedIcon });
        showToast(t('projectModal.updated'));
      } else {
        const payload = await createMutation.mutateAsync({ name, icon: selectedIcon });
        const nextWorkspaceId = payload?.data?.activeWorkspaceId;
        const nextSessionId = payload?.data?.activeSessionId;

        if (nextWorkspaceId) {
          setActiveWorkspace(nextWorkspaceId);
        }

        if (nextSessionId) {
          setActiveSession(nextSessionId);
          void fetchMessages(nextSessionId);
        }

        showToast(t('projectModal.created'));
      }
      closeModal();
    } catch (_e) {
      showToast(t('projectModal.error'));
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all pop-in">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{isEdit ? t('projectModal.editTitle') : t('projectModal.createTitle')}</h3>
          <button onClick={closeModal} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1 rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 px-1">{t('projectModal.projectName')}</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
              className={cn(
                "w-full bg-gray-50 dark:bg-black border text-gray-900 dark:text-gray-200 rounded-lg px-4 py-3 outline-none transition-all text-sm",
                validationError 
                  ? "border-red-500 focus:ring-red-500/20" 
                  : "border-gray-300 dark:border-graphite-border focus:border-primary-500 focus:ring-primary-500/20"
              )} 
              placeholder={t('projectModal.enterProjectName')} 
            />
            {validationError && <p className="text-[0.7rem] font-bold text-red-500 pl-1">{validationError}</p>}
          </div>
          
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('projectModal.projectIcon')}</label>
            <div className="grid grid-cols-5 gap-2">
              {ICONS.map(({ id, icon: Icon }) => (
                <button 
                  key={id} 
                  onClick={() => setSelectedIcon(id)}
                  className={cn(
                    "icon-option p-2.5 rounded-xl border transition-all flex items-center justify-center",
                    selectedIcon === id 
                      ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-600 shadow-sm" 
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
          <button onClick={closeModal} className="flex-1 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-graphite-hover hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-all active:opacity-80 shadow-sm border border-transparent dark:border-graphite-border">
            {t('common.cancel')}
          </button>
          <button 
            onClick={handleSubmit}
            disabled={!name.trim() || !!validationError || createMutation.isPending || updateMutation.isPending}
            className="flex-1 py-3 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl transition-all shadow-md shadow-primary-500/20 active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending || updateMutation.isPending ? t('projectModal.saving') : (isEdit ? t('common.save') : t('common.create'))}
          </button>
        </div>
      </div>
    </div>
  );
}
