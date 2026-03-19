import Editor from '@monaco-editor/react';
import { FileCode, Copy, Check, Save, Pencil, X } from 'lucide-react';
import { cn } from '../../../shared/utils/cn';
import { useI18n } from '../../../shared/i18n/useI18n';

interface CodeEditorProps {
  path: string | null;
  content: string;
  onChange: (val: string) => void;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
  isCopied: boolean;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

export function CodeEditor({ 
  path, content, onChange, isEditing, setIsEditing, 
  isCopied, onCopy, onSave, onClose, theme 
}: CodeEditorProps) {
  const { t } = useI18n();
  if (!path) return null;

  return (
    <div className="w-full max-w-2xl h-[min(480px,80dvh)] rounded-3xl bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border shadow-2xl overflow-hidden transform transition-all modal-content pop-in flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-[#111] border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileCode className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{path.split('/').pop()}</h3>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={onCopy}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-white rounded-lg transition-colors"
            title={t('common.copy')}
          >
            {isCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
          <button 
            onClick={() => {
              if (!isEditing) {
                setIsEditing(true);
                return;
              }
              onSave();
            }}
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-lg transition-all",
              isEditing 
                ? "bg-primary-600 text-white hover:bg-primary-700 shadow-sm" 
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            )}
            title={isEditing ? t('common.save') : t('common.edit')}
          >
            {isEditing ? <Save className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </button>
          <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-white dark:bg-[#0a0a0a] file-content-area flex relative h-[calc(100%-48px)]">
        <Editor
          loading={null}
          height="100%"
          language={
            path.endsWith('.js') ? 'javascript' : 
            path.endsWith('.ts') ? 'typescript' : 
            path.endsWith('.tsx') ? 'typescript' : 
            path.endsWith('.jsx') ? 'javascript' : 
            path.endsWith('.json') ? 'json' : 
            path.endsWith('.html') ? 'html' : 
            path.endsWith('.css') ? 'css' : 
            'plaintext'
          }
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={content}
          onChange={(val) => onChange(val || '')}
          options={{
            readOnly: !isEditing,
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            fixedOverflowWidgets: true,
            padding: { top: 16, bottom: 16 },
            domReadOnly: !isEditing,
            renderLineHighlight: (isEditing ? 'all' : 'none') as any,
            selectionHighlight: isEditing as any,
            occurrencesHighlight: isEditing as any,
            links: isEditing,
            contextmenu: isEditing,
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
              verticalScrollbarSize: 4,
              horizontalScrollbarSize: 4,
              arrowSize: 0,
              useShadows: false,
              verticalHasArrows: false,
              horizontalHasArrows: false
            }
          }}
        />
      </div>
    </div>
  );
}
