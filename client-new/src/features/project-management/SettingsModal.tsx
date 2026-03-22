import { useState, useEffect, useCallback } from 'react';
import { X, Archive, Shield, Globe, AlertTriangle, RotateCcw, Folder } from 'lucide-react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import {
  useWorkspaceFiles,
  useWorkspaces,
  useRuntimeStatus,
  useCreateWorkspaceItem,
  useDeleteWorkspaceItem,
  useRenameWorkspaceItem,
  useSaveFile,
  useArchivedWorkspaces,
  useRestoreWorkspace
} from '../../entities/workspace/useWorkspaceQuery';
import { useFileStore } from '../../entities/workspace/useFileStore';
import { useChatStore } from '../../entities/chat/useChatStore';
import { cn } from '../../shared/utils/cn';
import { FileTree } from '../../widgets/file-explorer/FileTree';
import { CodeEditor } from '../../entities/editor/components/CodeEditor';
import { useI18n } from '../../shared/i18n/useI18n';

type Tab = 'workspace' | 'ide' | 'agent' | 'archive';
const PROJECTS_ROOT_WORKSPACE_ID = '__projects_root__';

export function SettingsModal() {
  const {
    activeModal,
    closeModal,
    setTheme,
    theme,
    showToast,
    language,
    setLanguage,
    fullAccess,
    setFullAccess
  } = useLayoutStore();
  const { t } = useI18n();
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const { selectedPath, setSelectedPath, selectedType, reset } = useFileStore();
  const { data: workspaces } = useWorkspaces();
  
  const [activeTab, setActiveTab] = useState<Tab>('workspace');
  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [validationError, setValidationError] = useState('');
  
  const hasActiveWorkspace = Boolean(
    activeWorkspaceId &&
    (workspaces || []).some((workspace) => workspace.id === activeWorkspaceId)
  );
  const workspaceId = activeTab === 'workspace'
    ? PROJECTS_ROOT_WORKSPACE_ID
    : (hasActiveWorkspace ? activeWorkspaceId || '' : '');
  const { data: files, isLoading } = useWorkspaceFiles(workspaceId);
  const { data: runtimeStatus } = useRuntimeStatus();
  const webSearchEnabled = Boolean(runtimeStatus?.webSearch?.enabled);

  const [modalType, setModalType] = useState<'create_file' | 'create_folder' | 'delete' | 'edit' | null>(null);
  const [modalInputValue, setModalInputValue] = useState('');
  const [fileContent, setFileContent] = useState('');

  const createItemMutation = useCreateWorkspaceItem();
  const deleteItemMutation = useDeleteWorkspaceItem();
  const renameItemMutation = useRenameWorkspaceItem();
  const saveFileMutation = useSaveFile();
  const { data: archivedWorkspaces } = useArchivedWorkspaces();
  const restoreMutation = useRestoreWorkspace();

  const isVisible = activeModal === 'modal-settings';

  useEffect(() => {
    reset();
  }, [workspaceId, reset]);

  useEffect(() => {
    const handleMove = async (e: any) => {
      if (!workspaceId) return;
      const { dragged, targetPath } = e.detail;
      const name = dragged.split('/').pop() || '';
      const newPath = targetPath ? `${targetPath}/${name}` : name;
      if (newPath === dragged) return;
      try {
        await renameItemMutation.mutateAsync({ workspaceId, oldPath: dragged, newPath });
      } catch (err: any) {
        alert(t('toast.fileMoveError', { message: err.message }));
      }
    };

    const handleRename = async (e: any) => {
      if (!workspaceId) return;
      const { path, value } = e.detail;
      const parts = path.split('/');
      parts.pop();
      const newPath = parts.length > 0 ? `${parts.join('/')}/${value.trim()}` : value.trim();
      if (newPath === path) return;
      try {
        await renameItemMutation.mutateAsync({ workspaceId, oldPath: path, newPath });
      } catch (err: any) {
        alert(err.message);
      }
    };

    window.addEventListener('file-move', handleMove as any);
    window.addEventListener('file-rename', handleRename as any);
    return () => {
      window.removeEventListener('file-move', handleMove as any);
      window.removeEventListener('file-rename', handleRename as any);
    };
  }, [renameItemMutation, t, workspaceId]);

  const handleOpenFile = useCallback(async (path: string) => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`);
      const json = await res.json();
      if (json.success) {
        setFileContent(json.data.content);
        setSelectedPath(path, 'file');
        setModalType('edit');
        setIsEditing(false);
      }
    } catch (err: any) {
      alert(t('toast.fileOpenError', { message: err.message }));
    }
  }, [setSelectedPath, t, workspaceId]);

  if (!isVisible) return null;

  const tabLabel = (tab: Tab) => {
    if (tab === 'workspace') return t('settings.tab.workspace');
    if (tab === 'ide') return t('settings.tab.ide');
    if (tab === 'agent') return t('settings.tab.agent');
    return t('settings.tab.archive');
  };

  const modalTitle = () => {
    if (modalType === 'delete') {
      return selectedType === 'dir' ? t('settings.deleteFolder') : t('settings.deleteFile');
    }
    if (modalType === 'create_file') return t('settings.createFile');
    return t('settings.createFolder');
  };
  const handleWebSearchToggleAttempt = () => {
    if (webSearchEnabled) {
      return;
    }

    showToast(
      language === 'ru'
        ? 'Сначала включите веб-поиск в настройках Teleton Agent.'
        : 'Enable web search in Teleton Agent settings first.'
    );
  };
  return (
    <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center fade-in">
      <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border w-full max-w-[800px] rounded-2xl shadow-2xl overflow-hidden transform transition-all modal-content pop-in flex flex-col h-[520px]">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-graphite-border shrink-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('settings.title')}</h3>
          <button onClick={() => { closeModal(); reset(); }} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-48 border-r border-gray-200 dark:border-graphite-border p-3 bg-gray-50 dark:bg-graphite-base/50 flex flex-col gap-1 shrink-0 overflow-y-auto">
            {(['workspace', 'ide', 'agent', 'archive'] as Tab[]).map((tab) => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)} 
                className={cn(
                  "tab-btn w-full text-left px-3 py-1.5 rounded-lg text-sm font-semibold transition-all uppercase tracking-tight",
                  activeTab === tab
                    ? "active text-gray-900 bg-gray-200 dark:text-white dark:bg-graphite-hover shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-graphite-hover"
                )}
              >
                {tabLabel(tab)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden bg-white dark:bg-graphite-card flex flex-col relative">
            {activeTab === 'workspace' && (
              <FileTree 
                files={files || []} 
                isLoading={isLoading} 
                onOpenFile={handleOpenFile}
                onSetModal={setModalType}
                theme={theme}
              />
            )}

            {activeTab === 'ide' && (
              <div className="space-y-6 p-5 fade-in">
                <div>
                  <label className="block text-sm font-bold text-gray-900 dark:text-white mb-3">{t('settings.theme')}</label>
                  <div className="flex p-1 bg-gray-100 dark:bg-black rounded-xl w-fit border border-gray-200 dark:border-graphite-border">
                    <button
                      onClick={() => setTheme('light')}
                      className={cn(
                        "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
                        theme === 'light' ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {t('settings.lightTheme')}
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={cn(
                        "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
                        theme === 'dark'
                          ? "bg-white dark:bg-graphite-card shadow-sm text-gray-900 dark:text-white border border-gray-200 dark:border-graphite-border"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      )}
                    >
                      {t('settings.darkTheme')}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-900 dark:text-white mb-3">{t('settings.language')}</label>
                  <div className="flex p-1 bg-gray-100 dark:bg-black rounded-xl w-fit border border-gray-200 dark:border-graphite-border">
                    <button
                      onClick={() => setLanguage('ru')}
                      className={cn(
                        "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
                        language === 'ru'
                          ? "bg-white dark:bg-graphite-card shadow-sm text-gray-900 dark:text-white border border-gray-200 dark:border-graphite-border"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      )}
                    >
                      {t('settings.russian')}
                    </button>
                    <button
                      onClick={() => setLanguage('en')}
                      className={cn(
                        "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
                        language === 'en'
                          ? "bg-white dark:bg-graphite-card shadow-sm text-gray-900 dark:text-white border border-gray-200 dark:border-graphite-border"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      )}
                    >
                      {t('settings.english')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'agent' && (
              <div className="p-6 space-y-6 fade-in">
                <div className="agent-access-panel">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{t('settings.permissionsLevel')}</h4>
                  <div className={cn(
                    "flex items-center justify-between p-4 border rounded-2xl transition-all duration-300",
                    fullAccess ? "border-red-500/30 bg-red-50 dark:bg-red-500/5" : "border-gray-200 dark:border-graphite-border bg-gray-50 dark:bg-graphite-base"
                  )}>
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-2 rounded-xl transition-colors",
                        fullAccess ? "bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400" : "bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400"
                      )}>
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="font-bold text-gray-900 dark:text-white text-sm">{t('settings.fullAccess')}</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={fullAccess}
                        onChange={() => setFullAccess(!fullAccess)}
                      />
                      <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-graphite-hover peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-500"></div>
                    </label>
                  </div>
                </div>
                <div className="agent-search-panel">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{t('settings.additionalFeatures')}</h4>
                  <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-graphite-border bg-gray-50 dark:bg-graphite-base rounded-2xl transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-xl text-blue-600">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div className="font-bold text-gray-900 dark:text-white text-sm">{t('settings.webSearch')}</div>
                    </div>
                    <label
                      className="relative inline-flex items-center cursor-pointer shrink-0"
                      onClick={handleWebSearchToggleAttempt}
                    >
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={webSearchEnabled}
                        readOnly
                      />
                      <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-graphite-hover peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-500"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'archive' && (
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {archivedWorkspaces && archivedWorkspaces.length > 0 ? (
                  <div className="space-y-2">
                    {archivedWorkspaces.map((ws) => (
                      <div key={ws.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-graphite-base/50 border border-gray-100 dark:border-graphite-border rounded-xl group transition-all hover:border-primary-500/30">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gray-200 dark:bg-graphite-hover rounded-lg text-gray-500">
                            <Folder className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                            <div className="text-sm font-bold text-gray-900 dark:text-white">{ws.name}</div>
                            <div className="text-[0.65rem] text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px]">{ws.path}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => restoreMutation.mutate(ws.id)}
                          disabled={restoreMutation.isPending}
                          className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-[0.7rem] font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{restoreMutation.isPending ? '...' : t('common.restore')}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center pt-20 text-center fade-in">
                    <div className="flex flex-col items-center justify-center gap-6">
                      <div className="w-24 h-24 bg-gray-50 dark:bg-graphite-base/30 rounded-full flex items-center justify-center text-gray-300 dark:text-gray-700 border border-gray-100 dark:border-gray-800 shadow-inner">
                        <Archive className="w-12 h-12" />
                      </div>
                      <h4 className="text-xl font-bold text-gray-900 dark:text-white">{t('settings.archiveEmpty')}</h4>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {modalType && (
        <div className="fixed inset-0 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center fade-in">
          {modalType === 'edit' ? (
            <CodeEditor 
              path={selectedPath}
              content={fileContent}
              onChange={setFileContent}
              isEditing={isEditing}
              setIsEditing={setIsEditing}
              isCopied={isCopied}
              onCopy={() => {
                navigator.clipboard.writeText(fileContent);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 3000);
              }}
              onSave={async () => {
                if (workspaceId && selectedPath) {
                  await saveFileMutation.mutateAsync({ workspaceId, path: selectedPath, content: fileContent });
                  setIsEditing(false);
                }
              }}
              onClose={() => setModalType(null)}
              theme={theme}
            />
          ) : (
            <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border shadow-2xl overflow-hidden transform transition-all modal-content pop-in w-full max-w-md rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {modalTitle()}
                </h3>
                <button onClick={() => setModalType(null)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {modalType === 'delete' ? (
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center text-red-600 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                      {t('settings.deleteWarning', {
                        name: selectedPath?.split('/').pop() || '',
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 mb-6">
                  <input 
                    type="text" 
                    value={modalInputValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      setModalInputValue(val);
                      const engOnly = /^[a-zA-Z0-9._\- /]*$/;
                      if (val && !engOnly.test(val)) setValidationError(t('common.onlyEnglish'));
                      else setValidationError('');
                    }}
                    autoFocus
                    className={cn(
                      "w-full bg-gray-50 dark:bg-black border text-gray-900 dark:text-gray-200 rounded-lg px-4 py-3 outline-none transition-all text-sm",
                      validationError ? "border-red-500 focus:ring-red-500/20" : "border-gray-300 dark:border-graphite-border focus:border-primary-500 focus:ring-primary-500/20"
                    )} 
                    placeholder={t('common.enterName')}
                  />
                  {validationError && <p className="text-[0.7rem] font-bold text-red-500 pl-1">{validationError}</p>}
                </div>
              )}

              <div className="flex items-center gap-3 mt-6">
                <button 
                  onClick={async () => {
                    if (modalType === 'delete') {
                      if (workspaceId && selectedPath) {
                        await deleteItemMutation.mutateAsync({ workspaceId, path: selectedPath });
                        if (
                          workspaceId === PROJECTS_ROOT_WORKSPACE_ID &&
                          !selectedPath.includes('/')
                        ) {
                          const chatStore = useChatStore.getState();
                          chatStore.setActiveSession(null);
                          chatStore.setActiveWorkspace(null);
                        }
                        setSelectedPath(null);
                      }
                    } else {
                      if (!workspaceId) return;
                      const type = modalType === 'create_file' ? 'file' : 'folder';
                      let finalName = modalInputValue.trim();
                      if (type === 'file' && !finalName.includes('.')) finalName += '.txt';
                      const parentPath =
                        selectedPath
                          ? selectedType === 'dir'
                            ? selectedPath
                            : selectedPath.split('/').slice(0, -1).join('/')
                          : '';
                      const finalPath = parentPath ? `${parentPath}/${finalName}` : finalName;
                      await createItemMutation.mutateAsync({ workspaceId, type, path: finalPath });
                    }
                    setModalType(null);
                    setModalInputValue('');
                    setValidationError('');
                  }}
                  disabled={!workspaceId || (modalType !== 'delete' && !!validationError)}
                  className={cn(
                    "flex-1 py-3 text-xs font-bold text-white rounded-xl transition-all shadow-md active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed",
                    modalType === 'delete' ? "bg-red-600 hover:bg-red-700 shadow-red-500/20" : "bg-primary-600 hover:bg-primary-700 shadow-primary-500/20"
                  )}
                >
                  {modalType === 'delete' ? t('common.delete') : t('common.create')}
                </button>
                <button 
                  onClick={() => { setModalType(null); setModalInputValue(''); setValidationError(''); }}
                  className="flex-1 py-3 text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-graphite-hover hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-all active:opacity-80 shadow-sm"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
