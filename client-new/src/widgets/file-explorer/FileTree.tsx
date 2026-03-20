import React, { useMemo, useState, useRef, useCallback } from 'react';
import { FolderPlus, FilePlus } from 'lucide-react';
import { cn } from '../../shared/utils/cn';
import { useFileStore } from '../../entities/workspace/useFileStore';
import { FileNode } from './FileNode';
import { Archive, File, FileTerminal, FileCode, CodeXml, Palette, FileJson, FileText, Image, Music, Video } from 'lucide-react';
import { useI18n } from '../../shared/i18n/useI18n';

const FILE_TREE_GRID = "grid-cols-[minmax(220px,1fr)_72px_112px_64px]";

interface FileTreeProps {
  files: any[];
  isLoading: boolean;
  onOpenFile: (path: string) => void;
  onSetModal: (type: 'create_file' | 'create_folder' | 'delete' | 'edit' | null) => void;
  theme: 'light' | 'dark';
}

export function FileTree({ files, isLoading, onOpenFile, onSetModal, theme }: FileTreeProps) {
  const { t } = useI18n();
  const { 
    selectedPath, setSelectedPath, 
    expandedFolders, toggleFolder
  } = useFileStore();

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const treeInnerRef = useRef<HTMLDivElement>(null);

  // Tree Construction
  const tree = useMemo(() => {
    if (!files) return {};
    const newTree: any = {};
    files.forEach(f => {
      if (!f || !f.path) return;
      const parts = f.path.replace(/\\/g, "/").split("/").filter(Boolean);
      let current = newTree;
      parts.forEach((part: string, i: number) => {
        const isLeaf = i === parts.length - 1;
        if (!current[part]) {
          current[part] = {
            _meta: (isLeaf ? f : { isDir: true, path: parts.slice(0, i + 1).join('/'), name: part }),
            _children: {}
          };
        } else if (isLeaf) {
          current[part]._meta = f;
        }
        current = current[part]._children;
      });
    });
    return newTree;
  }, [files]);

  const getFileIconInfo = (name?: string) => {
    if (!name) return { icon: File, color: 'text-gray-400' };
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': case 'mjs': case 'cjs': return { icon: FileTerminal, color: 'text-blue-500' };
      case 'ts': case 'tsx': return { icon: FileCode, color: 'text-blue-500' };
      case 'html': case 'htm': return { icon: CodeXml, color: 'text-blue-500' };
      case 'css': case 'scss': case 'less': return { icon: Palette, color: 'text-sky-400' };
      case 'json': case 'yaml': case 'yml': return { icon: FileJson, color: 'text-green-500' };
      case 'md': return { icon: FileText, color: 'text-gray-400' };
      case 'png': case 'jpg': case 'jpeg': case 'webp': case 'gif': case 'svg': return { icon: Image, color: 'text-gray-400' };
      case 'zip': case 'rar': case '7z': case 'gz': return { icon: Archive, color: 'text-gray-400' };
      case 'mp3': case 'wav': case 'ogg': return { icon: Music, color: 'text-gray-400' };
      case 'mp4': case 'mov': case 'webm': return { icon: Video, color: 'text-gray-400' };
      default: return { icon: File, color: 'text-gray-400' };
    }
  };

  const getFolderColor = (_name: string) => {
    return 'text-amber-500 fill-amber-500/20';
  };

  const handleDragStart = useCallback((e: React.DragEvent, path: string, targetEl: HTMLElement) => {
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.effectAllowed = 'move';

    const rect = targetEl.getBoundingClientRect();
    const clone = targetEl.cloneNode(true) as HTMLElement;
    
    if (treeInnerRef.current) {
      treeInnerRef.current.style.minWidth = `${treeInnerRef.current.scrollWidth}px`;
    }

    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.position = 'fixed';
    clone.style.top = '-2000px';
    clone.style.left = '-2000px';
    clone.style.backgroundColor = theme === 'dark' ? '#1c1c1c' : '#ffffff';
    clone.style.border = '2px dashed #4f46e5'; 
    clone.style.borderRadius = '8px';
    clone.style.zIndex = '999999';
    clone.style.opacity = '1';
    clone.style.pointerEvents = 'none';
    clone.style.boxShadow = '0 0 30px rgba(79,70,229,0.4)';
    clone.style.transform = 'scale(1.02)';
    clone.style.color = theme === 'dark' ? '#fff' : '#000';
    clone.style.display = 'grid'; 
    clone.style.gridTemplateColumns = 'inherit';
    clone.style.transition = 'none';
    clone.classList.remove('group');
    
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);
    
    setTimeout(() => {
      setDraggingPath(path);
      document.body.removeChild(clone);
    }, 0);
  }, [theme]);

  const handleDragEnd = useCallback(() => {
    setDraggingPath(null);
    setDropTargetPath(null);
    if (treeInnerRef.current) {
      treeInnerRef.current.style.minWidth = '';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, path: string) => {
    e.preventDefault();
    if (draggingPath === path) return;
    if (dropTargetPath !== path) setDropTargetPath(path);
  }, [draggingPath, dropTargetPath]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    setDropTargetPath(null);
    const dragged = e.dataTransfer.getData('text/plain');
    if (!dragged || dragged === targetPath) return;

    // Trigger rename mutation from parent context (passed via hook or props)
    window.dispatchEvent(new CustomEvent('file-move', { detail: { dragged, targetPath } }));
    setDraggingPath(null);
  }, []);

  const renderLevel = (obj: any, d: number = 0): React.ReactNode => {
    const keys = Object.keys(obj).sort((a, b) => {
      const aDir = obj[a]._meta.isDir;
      const bDir = obj[b]._meta.isDir;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });

    return keys.map(key => {
      const entry = obj[key];
      const meta = entry._meta;
      return (
        <React.Fragment key={meta.path}>
          <FileNode
            meta={meta}
            depth={d}
            isSelected={selectedPath === meta.path}
            isExpanded={expandedFolders.has(meta.path)}
            isDropTarget={dropTargetPath === meta.path}
            isDragging={draggingPath === meta.path}
            fileIconInfo={getFileIconInfo(meta.name)}
            folderColor={getFolderColor(meta.name)}
            onToggle={toggleFolder}
            onSelect={setSelectedPath}
            onDoubleClick={onOpenFile}
            onRename={(path, name) => { setSelectedPath(path); setRenamingPath(path); setRenameValue(name); }}
            onDelete={(path) => { setSelectedPath(path); onSetModal('delete'); }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragLeave={() => setDropTargetPath(null)}
            renamingPath={renamingPath}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            onRenameSubmit={() => {
               window.dispatchEvent(new CustomEvent('file-rename', { detail: { path: renamingPath, value: renameValue } }));
               setRenamingPath(null);
            }}
            renameInputRef={renameInputRef as React.RefObject<HTMLInputElement>}
          />
          {meta.isDir && expandedFolders.has(meta.path) && renderLevel(entry._children, d + 1)}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-graphite-base border-b border-gray-200 dark:border-graphite-border shrink-0">
        <div className="min-w-0 text-[0.65rem] font-bold text-gray-500 uppercase tracking-widest">{t('fileTree.workspaceFiles')}</div>
        <div className="flex gap-2">
          <button 
            onClick={() => onSetModal('create_folder')}
            title={t('settings.createFolder')}
            aria-label={t('settings.createFolder')}
            className="h-8 w-8 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center justify-center shadow-sm"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button 
            onClick={() => onSetModal('create_file')}
            title={t('settings.createFile')}
            aria-label={t('settings.createFile')}
            className="h-8 w-8 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center justify-center shadow-sm"
          >
            <FilePlus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col flex-1 min-h-0 relative">
        <div className={cn("grid gap-0 items-center border-b border-gray-200 dark:border-graphite-border text-[0.65rem] font-bold text-gray-400 dark:text-graphite-text uppercase tracking-wider shrink-0 bg-gray-50/50 dark:bg-graphite-base/50 sticky top-0 z-10 h-9", FILE_TREE_GRID)}>
          <div className="pl-4 h-full flex items-center border-r border-gray-200/50 dark:border-graphite-border/50">{t('common.name')}</div>
          <div className="text-right pr-4 h-full flex items-center justify-end border-r border-gray-200/50 dark:border-graphite-border/50 tabular-nums">{t('common.size')}</div>
          <div className="text-right pr-4 h-full flex items-center justify-end border-r border-gray-200/50 dark:border-graphite-border/50 tabular-nums">{t('common.modified')}</div>
          <div className="h-full"></div>
        </div>
        <div 
          className={cn(
            "overflow-x-hidden overflow-y-auto flex-1 font-mono pb-2 relative transition-all min-h-0",
            dropTargetPath === "" && draggingPath !== null && "bg-primary-500/[0.04] border-2 border-dashed border-primary-500/40"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTargetPath("");
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDrop(e, "");
          }}
          onClick={() => setSelectedPath(null)}
        >
          <div 
            ref={treeInnerRef}
            className={cn("flex flex-col min-w-full pb-32", draggingPath && "drag-active")}
          >
            {isLoading ? (
              <div className="p-4 text-center text-gray-500 italic opacity-50">{t('fileTree.loading')}</div>
            ) : files && files.length > 0 ? (
              renderLevel(tree)
            ) : (
              <div className="p-4 text-center text-gray-400 opacity-50 italic">{t('fileTree.empty')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
