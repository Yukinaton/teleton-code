import { useEffect } from 'react';
import { SideBar } from '../widgets/sidebar/SideBar';
import { SharedInput } from '../widgets/main/SharedInput';
import { ChatView } from '../widgets/main/ChatView';
import { useChatStore } from '../entities/chat/useChatStore';
import { useLayoutStore } from '../entities/layout/useLayoutStore';
import { cn } from '../shared/utils/cn';
import { ProjectModal } from '../features/project-management/ProjectModal';
import { DeleteProjectModal } from '../features/project-management/DeleteProjectModal';
import { ArchiveProjectModal } from '../features/project-management/ArchiveProjectModal';
import { AppPreviewModal } from '../features/project-management/AppPreviewModal';
import { SuccessModal } from '../features/project-management/SuccessModal';
import { DeleteChatModal } from '../features/project-management/DeleteChatModal';
import { EditProjectModal } from '../features/project-management/EditProjectModal';
import { RenameChatModal } from '../features/project-management/RenameChatModal';
import { SettingsModal } from '../features/project-management/SettingsModal';
import { ContextMenu } from '../features/context-menu/ContextMenu';
import { buildPreviewBaseUrl } from '../shared/utils/preview';

function App() {
  const { messages } = useChatStore();
  const { sidebarOpen, toggleSidebar } = useLayoutStore();
  const isChatEmpty = messages.length === 0;

  // Sync workspace/session IDs with server on app load
  useEffect(() => {
    let cancelled = false;

    fetch('/api/bootstrap')
      .then(res => res.json())
      .then(data => {
        if (!data.success || !data.data || cancelled) {
          return;
        }

        const store = useChatStore.getState();
        const serverWsId = data.data.activeWorkspaceId;
        const serverSessId = data.data.activeSessionId;
        const workspaces = Array.isArray(data.data.workspaces) ? data.data.workspaces : [];
        const sessionsByWorkspace = data.data.sessionsByWorkspace || {};
        const runtime = data.data.runtime || {};
        const previewBaseUrl = buildPreviewBaseUrl(runtime.previewPort);
        const runtimeInstanceKey = JSON.stringify({
          teletonRoot: runtime.teletonRoot || '',
          packagePath: runtime.packagePath || '',
          previewPort: runtime.previewPort || '',
        });

        const persistedWorkspaceId = store.activeWorkspaceId;
        const persistedSessionId = store.activeSessionId;

        const validWorkspaceId = workspaces.some((workspace: { id: string }) => workspace.id === persistedWorkspaceId)
          ? persistedWorkspaceId
          : null;

        const findWorkspaceForSession = (sessionId: string | null) => {
          if (!sessionId) return null;
          for (const workspace of workspaces) {
            const sessions = sessionsByWorkspace[workspace.id] || [];
            if (sessions.some((session: { id: string }) => session.id === sessionId)) {
              return workspace.id;
            }
          }
          return null;
        };

        const persistedSessionWorkspaceId = findWorkspaceForSession(persistedSessionId);
        const targetSessionId = persistedSessionWorkspaceId ? persistedSessionId : serverSessId;
        const targetWorkspaceId =
          persistedSessionWorkspaceId ||
          validWorkspaceId ||
          findWorkspaceForSession(serverSessId) ||
          serverWsId ||
          null;

        if (targetWorkspaceId && targetWorkspaceId !== store.activeWorkspaceId) {
          store.setActiveWorkspace(targetWorkspaceId);
        }

        const layoutStore = useLayoutStore.getState();
        layoutStore.syncRuntimeDefaults(runtimeInstanceKey);
        layoutStore.setPreviewBaseUrl(previewBaseUrl);

        if (targetSessionId) {
          store.setActiveSession(targetSessionId);
          void store.fetchMessages(targetSessionId);
        } else {
          store.setActiveSession(null);
        }
      })
      .catch(e => console.warn('[App] Bootstrap sync failed:', e));

    return () => {
      cancelled = true;
    };
  }, []);

  // Theme is managed by useLayoutStore

  return (
    <div className="font-sans h-screen w-screen overflow-hidden flex antialiased bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-200 transition-colors duration-200 selection:bg-primary-500/20">
      {/* Sidebar */}
      <SideBar isOpen={sidebarOpen} onToggle={toggleSidebar} />

      {/* Main View (index.html:114) */}
      <main id="main-view" className={cn(
        "flex-1 flex flex-col relative min-w-0 h-full overflow-hidden bg-white dark:bg-black transition-all duration-300",
        isChatEmpty && "is-empty"
      )}>
        {/* Chat Content */}
        <ChatView />

        {/* Global Input Area (centered when empty, bottom when not) */}
        <SharedInput isChatEmpty={isChatEmpty} />
        
        {/* Portal root for inline expanded preview - ALWAYS FULL WIDTH/HEIGHT OF MAIN */}
        <div id="preview-portal-root" className="absolute inset-0 pointer-events-none z-50 overflow-hidden"></div>
      </main>
      
      {/* Modals and Context Menus */}
      <ProjectModal />
      <DeleteProjectModal />
      <ArchiveProjectModal />
      <AppPreviewModal />
      <SuccessModal />
      <DeleteChatModal />
      <EditProjectModal />
      <RenameChatModal />
      <SettingsModal />
      <ContextMenu />
    </div>
  );
}

export default App;
