import { X, Circle } from 'lucide-react';
import { useEditorStore } from '../../entities/editor/useEditorStore';
import { MonacoWrapper } from './MonacoWrapper';
import { cn } from '../../shared/utils/cn';

export function EditorPane() {
  const { tabs, activePath, setActiveTab, closeTab } = useEditorStore();

  return (
    <div className="h-full flex flex-col bg-[#0f172a]">
      {/* Tabs Header */}
      <div className="h-10 border-b border-slate-700/50 bg-slate-900/50 flex items-center px-1 overflow-x-auto gap-0 custom-scrollbar">
        {tabs.map((tab) => (
          <div
            key={tab.path}
            className={cn(
              'group relative h-full min-w-[120px] max-w-[200px] flex items-center px-3 text-xs cursor-pointer border-r border-slate-700/30 transition-all select-none',
              activePath === tab.path 
                ? 'bg-[#0f172a] text-sky-400 font-medium border-t-2 border-t-sky-500 shadow-[0_-2px_8px_rgba(14,165,233,0.1)]' 
                : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
            )}
            onClick={() => setActiveTab(tab.path)}
          >
            <span className="truncate flex-1">{tab.name}</span>
            <div className="ml-2 flex items-center justify-center w-4 h-4 rounded-sm hover:bg-slate-700 transition-colors"
                 onClick={(e) => {
                   e.stopPropagation();
                   closeTab(tab.path);
                 }}>
              {tab.isDirty ? (
                <Circle size={8} className="fill-sky-500 text-sky-500" />
              ) : (
                <X size={12} className="opacity-0 group-hover:opacity-100" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Editor Surface */}
      <div className="flex-1 relative">
        {activePath ? (
          <MonacoWrapper path={activePath} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 bg-[#0f172a]/80 backdrop-blur-sm">
             <div className="w-24 h-24 mb-6 opacity-10">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                   <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                   <polyline points="14 2 14 8 20 8" />
                </svg>
             </div>
             <p className="text-sm font-medium tracking-wide">Select a file to start coding</p>
             <p className="text-[10px] uppercase mt-2 opacity-50">Press Ctrl+P to search files</p>
          </div>
        )}
      </div>
    </div>
  );
}
