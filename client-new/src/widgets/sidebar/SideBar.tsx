import { useState, useEffect } from 'react';
import { PanelLeft, FolderPlus, Folder, Code, Database, Globe, Zap, Cpu, Terminal, Box, Layers, ChevronDown, MoreVertical, Settings } from 'lucide-react';
import { useWorkspaces } from '../../entities/workspace/useWorkspaceQuery';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useChatStore } from '../../entities/chat/useChatStore';
import { cn } from '../../shared/utils/cn';
import { useI18n } from '../../shared/i18n/useI18n';

interface SideBarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const ICON_MAP = {
  folder: Folder,
  code: Code,
  database: Database,
  globe: Globe,
  zap: Zap,
  cpu: Cpu,
  terminal: Terminal,
  box: Box,
  layers: Layers,
};

export function SideBar({ isOpen, onToggle }: SideBarProps) {
  const { data: workspaces } = useWorkspaces();
  const { openModal } = useLayoutStore();
  const { t } = useI18n();
  const { openMenu, isOpen: isMenuOpen, targetId: menuTargetId, closeMenu, clearTarget } = useContextStore();
  const { activeWorkspaceId: activeProj, activeSessionId: activeChat, selectSession, setActiveWorkspace: setActiveProj } = useChatStore();
  const [expandedProjs, setExpandedProjs] = useState<Set<string>>(new Set());

  const handleWorkspaceSelect = (workspace: any) => {
    setActiveProj(workspace.id);
    const targetSession = workspace.sessions?.[0];
    if (targetSession?.id && targetSession.id !== activeChat) {
      void selectSession(targetSession.id);
    }
  };

  useEffect(() => {
    if (workspaces && workspaces.length > 0 && !activeProj) {
      setActiveProj(workspaces[0].id);
    }
  }, [workspaces, activeProj, setActiveProj]);

  useEffect(() => {
    if (!activeProj) return;
    setExpandedProjs((current) => {
      if (current.has(activeProj)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeProj);
      return next;
    });
  }, [activeProj]);

  const toggleFolder = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = new Set(expandedProjs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedProjs(next);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMenuOpen && menuTargetId === id) {
      closeMenu();
    } else {
      openMenu(e.clientX, e.clientY, 'project', id);
    }
  };

  return (
    <aside 
      id="sidebar" 
      className={cn(
        "w-64 bg-white dark:bg-graphite-base border-r border-gray-200 dark:border-graphite-border flex flex-col transition-all duration-300 shrink-0 z-40 relative select-none overflow-x-hidden",
        !isOpen && "collapsed"
      )}
    >
      <div className="sidebar-header h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-graphite-border shrink-0 transition-all overflow-hidden">
        <span className="font-bold text-[1.05rem] tracking-tight sidebar-logo-text text-gray-900 dark:text-white">Teleton Code</span>
        <button 
          onClick={onToggle} 
          className="flex items-center justify-center w-[34px] h-[34px] text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-graphite-hover rounded-lg transition-all shrink-0 active:scale-95" 
          title={isOpen ? t('common.collapse') : t('common.expand')}
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="p-3 flex-none space-y-3 overflow-hidden">
        <button 
          onClick={() => {
            clearTarget();
            openModal('modal-new-project');
          }}
          className="sidebar-btn h-[2.75rem] w-full text-white px-3 rounded-lg transition-all shadow-sm hover:shadow-md flex items-center gap-3 active:scale-[0.98] overflow-hidden justify-start hover:brightness-110"
          style={{ backgroundColor: '#2563eb' }}
        >
          <span className="flex items-center justify-center btn-content gap-3 shrink-0">
            <FolderPlus className="w-[18px] h-[18px] shrink-0" />
            <span className="sidebar-text text-sm font-semibold whitespace-nowrap">{t('sidebar.newProject')}</span>
          </span>
        </button>
        <div className="text-[0.65rem] font-bold text-gray-400 dark:text-graphite-text uppercase tracking-wider px-2 sidebar-text whitespace-nowrap">{t('sidebar.workspaces')}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="flex flex-col gap-1" id="project-list">
          {workspaces?.map((ws) => {
            const Icon = (ICON_MAP as any)[ws.icon || 'folder'] || Folder;
            return (
              <div 
                key={ws.id} 
                className={cn("group relative project-item", activeProj === ws.id && "active")}
                onContextMenu={(e) => handleContextMenu(e, ws.id)}
              >
                <div 
                  className={cn(
                    "flex items-center justify-between px-2 rounded-lg hover:bg-gray-100 dark:hover:bg-graphite-hover transition-colors sidebar-btn h-[2.75rem] w-full cursor-pointer proj-header",
                    activeProj === ws.id && "bg-primary-50 dark:bg-primary-500/10"
                  )}
                  onClick={() => handleWorkspaceSelect(ws)}
                >
                  <div className="flex items-center gap-3 h-full overflow-hidden btn-content flex-1 text-left">
                    <div className="w-[18px] h-[18px] shrink-0 flex items-center justify-center">
                      <Icon className={cn(
                        "w-[18px] h-[18px] shrink-0 proj-icon transition-colors",
                        activeProj === ws.id 
                          ? "text-primary-600 fill-primary-600/20 dark:fill-primary-400/20" 
                          : "text-gray-400 dark:text-gray-500 hover:text-primary-500"
                      )} />
                    </div>
                    <span className={cn(
                      "text-sm truncate sidebar-text proj-title",
                      activeProj === ws.id ? "font-semibold text-primary-700" : "font-medium text-gray-600 dark:text-gray-400"
                    )}>
                      {ws.name}
                    </span>
                  </div>
                  <div className={cn("flex items-center gap-0.5 sidebar-actions", activeProj === ws.id ? "text-primary-600" : "text-gray-400")}>
                    <button 
                      className="p-1 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-all rounded active:scale-95" 
                      onClick={(e) => toggleFolder(e, ws.id)}
                      title={t('common.expand')}
                    >
                      <ChevronDown className={cn("w-4 h-4 transition-transform", !expandedProjs.has(ws.id) && "-rotate-90")} />
                    </button>
                    <button 
                      className="p-1 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-all rounded active:scale-95"
                      onClick={(e) => handleContextMenu(e, ws.id)}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className={cn(
                  "mt-1 flex flex-col sidebar-text folder-content space-y-0.5",
                  !expandedProjs.has(ws.id) && "hidden-folder"
                )}>
                  {ws.sessions?.map((session) => (
                    <div 
                      key={session.id} 
                      className={cn(
                        "group/chat relative flex items-center justify-between rounded-lg hover:bg-gray-100 dark:hover:bg-graphite-hover px-2 h-9 chat-item cursor-pointer", 
                        activeChat === session.id && "bg-gray-100 dark:bg-graphite-hover/50"
                      )} 
                      onClick={(e) => { e.stopPropagation(); selectSession(session.id); setActiveProj(ws.id); }}
                    >
                      <div className={cn(
                        "flex-1 flex items-center gap-2 pl-4 text-[0.82rem] font-medium whitespace-nowrap overflow-hidden text-left",
                        activeChat === session.id ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"
                      )}>
                        <div className="w-4 h-4 ml-4 shrink-0 flex items-center justify-center opacity-40">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        <span className="truncate">{session.title}</span>
                      </div>
                      <button 
                        className="opacity-0 group-hover/chat:opacity-100 p-1 text-gray-400 hover:text-gray-800 dark:hover:text-white transition-all mr-1 sidebar-actions rounded"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY, 'chat', session.id); }}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-graphite-border shrink-0 overflow-hidden">
        <button 
          onClick={() => openModal('modal-settings')}
          className="sidebar-btn h-[2.75rem] w-full hover:bg-gray-100 dark:hover:bg-graphite-hover px-3 rounded-lg text-gray-600 dark:text-gray-400 transition-colors whitespace-nowrap flex items-center gap-3 active:scale-[0.98] overflow-hidden justify-start"
        >
          <span className="flex items-center justify-center btn-content gap-3 shrink-0">
            <Settings className="w-[18px] h-[18px] shrink-0" />
            <span className="sidebar-text text-sm font-semibold">{t('sidebar.settings')}</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
