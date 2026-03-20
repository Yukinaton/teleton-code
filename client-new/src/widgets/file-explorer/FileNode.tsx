import React, { memo } from 'react';
import { ChevronDown, Folder, Edit2, Trash2 } from 'lucide-react';
import { cn } from '../../shared/utils/cn';
import { formatDate, formatFileSize } from '../../shared/utils/format-utils';

const FILE_TREE_GRID = "grid-cols-[minmax(0,1fr)_64px_96px_56px]";

interface FileNodeProps {
  meta: any;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  fileIconInfo: any;
  folderColor: string;
  onToggle: (path: string) => void;
  onSelect: (path: string, type: 'file' | 'dir') => void;
  onDoubleClick: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (path: string) => void;
  onDragStart: (e: React.DragEvent, path: string, el: HTMLElement) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, path: string) => void;
  onDrop: (e: React.DragEvent, path: string) => void;
  onDragLeave: () => void;
  renamingPath: string | null;
  renameValue: string;
  setRenameValue: (val: string) => void;
  onRenameSubmit: () => void;
  renameInputRef: React.RefObject<HTMLInputElement>;
}

export const FileNode = memo(({
  meta, depth, isSelected, isExpanded, isDropTarget, isDragging,
  fileIconInfo, folderColor, onToggle, onSelect, onDoubleClick,
  onRename, onDelete, onDragStart, onDragEnd, onDragOver, onDrop, onDragLeave,
  renamingPath, renameValue, setRenameValue, onRenameSubmit, renameInputRef
}: FileNodeProps) => {
  const { icon: FileIcon, color: fileColor } = fileIconInfo;

  return (
    <div 
      className={cn(
        "flex flex-col relative w-full overflow-visible", 
        isDragging && "opacity-20 grayscale brightness-50"
      )}
      style={isDragging ? { pointerEvents: 'none' } : {}}
    >
      <div 
        draggable
        onDragStart={(e) => onDragStart(e, meta.path, e.currentTarget as HTMLElement)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.stopPropagation();
          onDragOver(e, meta.path);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDrop(e, meta.path);
        }}
        onDragLeave={onDragLeave}
        className={cn(
          "grid gap-0 items-center hover:bg-gray-50 dark:hover:bg-graphite-hover/30 cursor-pointer group py-1.5 border-b border-gray-100 dark:border-gray-800/50 relative",
          FILE_TREE_GRID,
          isSelected && "selected-row bg-primary-50/30 dark:bg-primary-500/5",
          isDropTarget && "bg-primary-500/[0.08] outline outline-2 outline-dashed outline-primary-500/60 -outline-offset-2 z-20 shadow-[0_0_15px_rgba(79,70,229,0.3)]"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(meta.path, meta.isDir ? 'dir' : 'file');
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!meta.isDir) onDoubleClick(meta.path);
        }}
      >
        <div 
          className="pl-4 h-full flex items-center gap-2 border-r border-gray-200/50 dark:border-graphite-border/50 relative" 
          style={{ paddingLeft: `${(depth * 1.5) + 1}rem` }}
        >
          {meta.isDir && (
            <ChevronDown 
              className={cn("w-3.5 h-3.5 text-gray-400 transition-transform relative z-10", !isExpanded && "-rotate-90")} 
              onClick={(e) => { e.stopPropagation(); onToggle(meta.path); }}
            />
          )}
          {!meta.isDir && <div className="w-3.5 relative z-10" />}
          {meta.isDir ? (
            <Folder className={cn("w-4 h-4 shrink-0 relative z-10", folderColor)} />
          ) : (
            <FileIcon className={cn("w-4 h-4 shrink-0 relative z-10", fileColor)} />
          )}
          
          {renamingPath === meta.path ? (
            <div className="flex-1 min-w-0 max-w-[150px]">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={onRenameSubmit}
                onKeyDown={(e) => e.key === 'Enter' && onRenameSubmit()}
                className="bg-transparent text-primary-600 font-bold border-none outline-none p-0 m-0 w-full relative z-10 placeholder:opacity-50"
                spellCheck={false}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : (
            <span className={cn("truncate relative z-10 flex-1 min-w-0", meta.isDir ? "font-bold text-gray-900 dark:text-white" : "font-medium text-gray-800 dark:text-gray-200")}>
              {meta.name}
            </span>
          )}
        </div>
        
        <div className="text-right pr-4 text-[0.75rem] text-gray-500 h-full flex items-center justify-end border-r border-gray-200/50 dark:border-graphite-border/50 tabular-nums">
          {meta.isDir ? '-' : formatFileSize(meta.size)}
        </div>
        
        <div className="text-right pr-4 text-[0.75rem] text-gray-500 h-full flex items-center justify-end border-r border-gray-200/50 dark:border-graphite-border/50 tabular-nums">
          {formatDate(meta.mtime)}
        </div>
        
        <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity h-full items-center" onClick={e => e.stopPropagation()}>
          <button 
            onClick={() => onRename(meta.path, meta.name)}
            className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={() => onDelete(meta.path)}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});

FileNode.displayName = 'FileNode';
