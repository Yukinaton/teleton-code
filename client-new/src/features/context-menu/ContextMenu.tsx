import { useRef, useEffect, useState, useLayoutEffect } from 'react';
import { MessageSquarePlus, Edit2, Archive, Trash2 } from 'lucide-react';
import { useContextStore } from '../../entities/layout/useContextStore';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useCreateSession } from '../../entities/workspace/useWorkspaceQuery';
import { cn } from '../../shared/utils/cn';
import { useI18n } from '../../shared/i18n/useI18n';

export function ContextMenu() {
  const { isOpen, x, y, type, targetId, closeMenu } = useContextStore();
  const { openModal, showToast } = useLayoutStore();
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  
  const createSessionMutation = useCreateSession();

  useLayoutEffect(() => {
    if (isOpen && menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      let top = y;
      let left = x;

      if (y + menuRect.height > viewportHeight - 20) {
        top = y - menuRect.height;
      }
      if (x + menuRect.width > viewportWidth - 20) {
        left = viewportWidth - menuRect.width - 20;
      }
      
      setPos({ top, left });
    }
  }, [isOpen, x, y]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, closeMenu]);

  if (!isOpen) return null;

  const handleNewChat = async () => {
    if (type !== 'project' || !targetId) return;
    try {
      await createSessionMutation.mutateAsync({ workspaceId: targetId, title: t('contextMenu.newChatDefaultTitle') });
      showToast(t('contextMenu.newChatCreated'));
      closeMenu();
    } catch (_e) {
      showToast(t('contextMenu.newChatError'));
    }
  };

  return (
    <div 
      ref={menuRef}
      className={cn(
        "fixed bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl shadow-2xl z-[100] min-w-[190px] p-1.5 dropdown-menu pop-in",
        isOpen && "active"
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      {type === 'project' && (
        <>
          <button 
            onClick={handleNewChat}
            disabled={createSessionMutation.isPending}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-graphite-hover rounded-lg transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4 text-gray-400" />
            <span>{createSessionMutation.isPending ? t('common.loading') : t('contextMenu.newChat')}</span>
          </button>
          <div className="h-px bg-gray-100 dark:bg-graphite-border my-1" />
          <button 
            onClick={() => { openModal('modal-edit-project'); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-graphite-hover rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4 text-gray-400" />
            <span>{t('contextMenu.edit')}</span>
          </button>
          <button 
            onClick={() => { openModal('modal-archive-project'); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-graphite-hover rounded-lg transition-colors"
          >
            <Archive className="w-4 h-4 text-gray-400" />
            <span>{t('contextMenu.archive')}</span>
          </button>
          <div className="h-px bg-gray-100 dark:bg-graphite-border my-1" />
          <button 
            onClick={() => { openModal('modal-delete-project'); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>{t('contextMenu.deleteProject')}</span>
          </button>
        </>
      )}

      {type === 'chat' && (
        <>
          <button 
            onClick={() => { openModal('modal-rename-chat'); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-graphite-hover rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4 text-gray-400" />
            <span>{t('contextMenu.renameChat')}</span>
          </button>
          <button 
            onClick={() => { openModal('modal-delete-chat'); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>{t('contextMenu.deleteChat')}</span>
          </button>
        </>
      )}
    </div>
  );
}
