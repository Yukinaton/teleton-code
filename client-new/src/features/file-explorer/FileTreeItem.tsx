import { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';
import type { FileNode } from '../../entities/workspace/types';
import { cn } from '../../shared/utils/cn';
import { useEditorStore } from '../../entities/editor/useEditorStore';

interface FileTreeItemProps {
  node: FileNode;
  depth?: number;
}

export function FileTreeItem({ node, depth = 0 }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const openTab = useEditorStore((state) => state.openTab);
  const activePath = useEditorStore((state) => state.activePath);

  const handleClick = () => {
    if (node.isDir) {
      setIsOpen(!isOpen);
    } else {
      openTab(node.path, node.name);
    }
  };

  const isActive = activePath === node.path;

  return (
    <div>
      <div
        className={cn(
          'flex items-center py-1 px-2 cursor-pointer hover:bg-slate-800 text-sm group transition-colors',
          isActive && 'bg-slate-700 text-sky-400 font-medium border-l-2 border-sky-400'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        <span className="mr-1 text-slate-500 group-hover:text-slate-300">
          {node.isDir ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <div className="w-[14px]" />
          )}
        </span>
        <span className="mr-2">
          {node.isDir ? (
            <Folder size={16} className="text-amber-400/80 fill-amber-400/20" />
          ) : (
            <File size={16} className="text-slate-400" />
          )}
        </span>
        <span className="truncate">{node.name}</span>
      </div>

      {node.isDir && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
