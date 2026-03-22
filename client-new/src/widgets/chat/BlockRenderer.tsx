import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@monaco-editor/react';
import { 
  ClipboardList, Terminal, FileCode, Check, Code, 
  Play, Copy, CheckSquare, GitMerge, FileSearch, 
  Search, ExternalLink, ShieldQuestion, 
  AlertTriangle, Wrench, Loader2, Pencil, Save, Maximize2, Minimize2, FileText
} from 'lucide-react';
import { cn } from '../../shared/utils/cn';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { useChatStore } from '../../entities/chat/useChatStore';
import { useI18n } from '../../shared/i18n/useI18n';
import { repairMojibake } from '../../shared/utils/text';
import { buildWorkspacePreviewUrl, resolvePreviewUrl } from '../../shared/utils/preview';

interface Block {
  type: string;
  text?: string;
  workspaceId?: string | null;
  recoveryAvailable?: boolean;
  files?: Array<string | { name: string; path?: string; status?: string }>;
  items?: string[];
  steps?: string[];
  command?: string;
  query?: string;
  output?: string;
  status?: string;
  exitCode?: number;
  title?: string;
  description?: string;
  results?: Array<{ url?: string; title?: string; description?: string; text?: string; file?: string; snippet?: string }>;
  taskId?: string;
  content?: string;
  file?: string;
  path?: string;
  code?: string;
  diff?: string;
  url?: string;
}

interface BlockRendererProps {
  block: Block;
  messageId?: string;
  workspaceId?: string | null;
}

// Custom syntax highlighting is replaced by Monaco Editor

function inferWorkspaceBlockType(path = ''): 'markdown' | 'code' | 'runnable_code' {
  const normalized = String(path || '').toLowerCase();
  if (normalized.endsWith('.md') || normalized.endsWith('.txt')) {
    return 'markdown';
  }
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'runnable_code';
  }
  return 'code';
}

function normalizeDisplaySource(code = '', blockType: string, filePath = '') {
  if (blockType === 'markdown') {
    return String(code || '');
  }

  const source = String(code || '');
  const actualNewlines = (source.match(/\n/g) || []).length;
  const escapedNewlines = (source.match(/\\n/g) || []).length;
  const normalizedPath = String(filePath || '').toLowerCase();
  const isSourceLike = /\.(html?|css|js|jsx|ts|tsx|json)$/i.test(normalizedPath) || ['code', 'runnable_code'].includes(blockType);

  if (!isSourceLike || escapedNewlines < 3 || actualNewlines > 2) {
    return source;
  }

  return source
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractFileLikePath(value = '') {
  const normalized = String(value || '').trim();
  const match = normalized.match(/([A-Za-z0-9_./-]+\.(?:html?|css|js|jsx|ts|tsx|json|md))/i);
  return match ? match[1] : '';
}

function renderInlineText(text: string) {
  return repairMojibake(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderRichText(text?: string) {
  const source = repairMojibake(String(text || '')).replace(/\r\n/g, '\n').trim();
  if (!source) return null;

  const segments = source.split(/(```[\w-]*\n[\s\S]*?```)/g).filter(Boolean);
  const renderNarrativeSection = (section: string, prefix: string) =>
    section.split('\n').map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return <div key={`${prefix}-space-${index}`} className="h-2" />;
      }

      if (trimmed.startsWith('# ')) {
        return <h1 key={`${prefix}-h1-${index}`} className="text-[1.35rem]">{renderInlineText(trimmed.slice(2))}</h1>;
      }

      if (trimmed.startsWith('## ')) {
        return <h2 key={`${prefix}-h2-${index}`} className="text-[1.1rem]">{renderInlineText(trimmed.slice(3))}</h2>;
      }

      if (trimmed.startsWith('### ')) {
        return <h3 key={`${prefix}-h3-${index}`} className="text-[0.98rem]">{renderInlineText(trimmed.slice(4))}</h3>;
      }

      if (trimmed.startsWith('> ')) {
        return <blockquote key={`${prefix}-quote-${index}`}>{renderInlineText(trimmed.slice(2))}</blockquote>;
      }

      if (/^\d+\.\s/.test(trimmed)) {
        const [, marker, body] = trimmed.match(/^(\d+\.)\s(.+)$/) || [];
        return (
          <div key={`${prefix}-ordered-${index}`} className="my-2 flex items-start gap-3">
            <span className="w-7 shrink-0 text-right text-[0.78rem] font-semibold text-primary-600 dark:text-primary-400">{marker}</span>
            <div className="min-w-0 flex-1"><p>{renderInlineText(body || trimmed)}</p></div>
          </div>
        );
      }

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return (
          <div key={`${prefix}-bullet-${index}`} className="my-2 flex items-start gap-3">
            <span className="mt-[0.72rem] inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
            <div className="min-w-0 flex-1"><p>{renderInlineText(trimmed.slice(2))}</p></div>
          </div>
        );
      }

      return <p key={`${prefix}-text-${index}`}>{renderInlineText(trimmed)}</p>;
    });

  return (
    <div className="agent-copy">
      {segments.map((segment, index) => {
        const codeFence = segment.match(/^```([\w-]*)\n([\s\S]*?)```$/);
        if (codeFence) {
          const languageLabel = codeFence[1]?.trim();
          const code = codeFence[2]?.replace(/\n$/, '') || '';
          return (
            <div
              key={`code-segment-${index}`}
              className="my-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#0a0a0a]"
            >
              {languageLabel ? (
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-[0.72rem] font-bold uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:bg-[#1a1b1e] dark:text-gray-400">
                  {languageLabel}
                </div>
              ) : null}
              <pre className="overflow-x-auto px-4 py-3 text-[0.84rem] leading-relaxed text-gray-800 dark:text-gray-200">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        return renderNarrativeSection(segment, `narrative-${index}`);
      })}
    </div>
  );
}

export function BlockRenderer({ block, messageId, workspaceId }: BlockRendererProps) {
  const [viewMode, setViewMode] = useState<Record<string, 'code' | 'preview'>>({});
  const [isEditing, setIsEditing] = useState<Record<string, boolean>>({});
  const { theme: globalTheme, showToast, language, previewBaseUrl } = useLayoutStore();
  const { t } = useI18n();
  const saveEditedCode = useChatStore((state) => state.saveEditedCode);
  const fetchMessages = useChatStore((state) => state.fetchMessages);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useChatStore((state) => state.setActiveWorkspace);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<Record<string, boolean>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [expandedAppPreviews, setExpandedAppPreviews] = useState<Record<string, boolean>>({});
  const [workspaceFilePreviews, setWorkspaceFilePreviews] = useState<Record<string, { path: string; name: string; type: 'markdown' | 'code' | 'runnable_code'; content: string }>>({});
  const [approvalPending, setApprovalPending] = useState<string | null>(null);
  const [approvalResolved, setApprovalResolved] = useState<'accept' | 'reject' | 'accept_all' | 'reject_all' | null>(null);
  const [recoveryPending, setRecoveryPending] = useState<string | null>(null);
  const resolvedWorkspaceId = block.workspaceId || workspaceId || activeWorkspaceId || null;

  const previewSandbox = 'allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads';
  const srcDocSandbox = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setIsCopied(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setIsCopied(prev => ({ ...prev, [id]: false })), 2000);
  };

  const getMode = (file: string) => viewMode[file] || 'code';
  const setMode = (file: string, mode: 'code' | 'preview') => setViewMode(prev => ({ ...prev, [file]: mode }));

  const resolveWorkspacePath = (value: string) => {
    const candidate = extractFileLikePath(value);
    const normalizedCandidate = candidate.replace(/\\/g, '/');
    const blockFiles = Array.isArray(block.files) ? block.files : [];

    for (const entry of blockFiles) {
      const path = typeof entry === 'string' ? entry : (entry.path || entry.name || '');
      const normalizedPath = String(path || '').replace(/\\/g, '/');
      if (!normalizedPath) continue;
      if (
        normalizedPath === normalizedCandidate ||
        normalizedPath.endsWith(`/${normalizedCandidate}`) ||
        normalizedPath.split('/').pop() === normalizedCandidate
      ) {
        return normalizedPath;
      }
    }

    return normalizedCandidate || '';
  };

  const handleOpenWorkspaceFile = async (value: string) => {
    const path = resolveWorkspacePath(value);
    if (!path) return;
    if (!resolvedWorkspaceId) {
      showToast(t('toast.fileOpenError', { message: language === 'ru' ? 'Не найден контекст проекта для этого файла.' : 'Missing workspace context for this file.' }));
      return;
    }
    if (workspaceFilePreviews[path]) {
      setWorkspaceFilePreviews((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      return;
    }

    try {
      if (activeWorkspaceId !== resolvedWorkspaceId) {
        setActiveWorkspace(resolvedWorkspaceId);
      }

      const response = await fetch(`/api/workspaces/${resolvedWorkspaceId}/file?path=${encodeURIComponent(path)}`);
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load workspace file');
      }

      setWorkspaceFilePreviews((prev) => ({
        ...prev,
        [path]: {
          path,
          name: path.split('/').pop() || path,
          type: inferWorkspaceBlockType(path),
          content: payload.data.content || ''
        }
      }));
    } catch (error) {
      console.error('Failed to open workspace file preview:', error);
      showToast(t('toast.fileOpenError', { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const renderWorkspaceFileButton = (path: string, label?: string) => (
    <button
      type="button"
      key={`${block.type}:${path}:${label || path}`}
      onClick={() => void handleOpenWorkspaceFile(path)}
      className="rounded-md border border-primary-200 bg-primary-50 px-2 py-1 font-mono text-[0.8rem] text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-500/20 dark:bg-primary-500/10 dark:text-primary-300 dark:hover:bg-primary-500/20"
    >
      {repairMojibake(label || path.split('/').pop() || path)}
    </button>
  );

  const renderWorkspacePreviews = (paths: string[]) => (
    <>
      {paths
        .map((path) => workspaceFilePreviews[path])
        .filter(Boolean)
        .map((preview) => (
          <div key={`workspace-preview:${preview!.path}`} className="mt-3 w-full fade-in">
            <BlockRenderer
              block={{
                type: preview!.type,
                file: preview!.name,
                path: preview!.path,
                code: preview!.content
              }}
              messageId={messageId}
              workspaceId={resolvedWorkspaceId}
            />
          </div>
        ))}
    </>
  );

  const handleApprovalDecision = async (decision: 'accept' | 'reject' | 'accept_all' | 'reject_all') => {
    if (!block.taskId || approvalPending) return;

    try {
      setApprovalPending(decision);
      const response = await fetch(`/api/tasks/${block.taskId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Approval request failed');
      }

      setApprovalResolved(decision);
      if (activeSessionId) {
        await fetchMessages(activeSessionId);
      }
      showToast(t('toast.permissionSent'));
    } catch (error) {
      console.error('Approval request failed:', error);
      showToast(t('toast.permissionFailed'));
    } finally {
      setApprovalPending(null);
    }
  };

  const handleRecoveryAction = async (action: 'fix' | 'skip') => {
    if (!block.taskId || !activeSessionId || recoveryPending) return;

    try {
      setRecoveryPending(action);
      const response = await fetch(`/api/tasks/${block.taskId}/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Recovery request failed');
      }

      await fetchMessages(activeSessionId);

      if (action === 'fix' && payload?.data?.task?.id) {
        const stream = new EventSource(`/api/tasks/${payload.data.task.id}/stream`);
        const refresh = async () => {
          await fetchMessages(activeSessionId);
        };

        stream.addEventListener('task.snapshot', () => { void refresh(); });
        stream.addEventListener('task.step', () => { void refresh(); });
        stream.addEventListener('task.completed', () => {
          void refresh();
          stream.close();
        });
        stream.addEventListener('task.failed', () => {
          void refresh();
          stream.close();
        });
        stream.addEventListener('task.awaiting_approval', () => {
          void refresh();
          stream.close();
        });
        stream.onerror = () => {
          stream.close();
        };
      }

      showToast(
        action === 'fix'
          ? repairMojibake(language === 'ru' ? 'Восстановление запущено' : 'Recovery started')
          : repairMojibake(language === 'ru' ? 'Восстановление пропущено' : 'Recovery skipped')
      );
    } catch (error) {
      console.error('Recovery request failed:', error);
      showToast(repairMojibake(language === 'ru' ? 'Не удалось запустить восстановление' : 'Failed to start recovery'));
    } finally {
      setRecoveryPending(null);
    }
  };

  // Force style injection to override Monaco internal styles
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const styleId = 'monaco-force-bg';
      let styleTag = document.getElementById(styleId);
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
      }
      styleTag.innerHTML = `
        .monaco-editor, 
        .monaco-editor .margin, 
        .monaco-editor-background, 
        .monaco-editor .scroll-node,
        .monaco-editor .overflow-guard,
        .monaco-editor .margin-view-overlays {
          background-color: var(--monaco-bg) !important;
        }
        html.light { --monaco-bg: #ffffff !important; }
        html.dark { --monaco-bg: #111111 !important; }
        
        /* Дополнительный фикс для конкретных элементов Monaco */
        .monaco-editor .inputarea.ime-input {
          background-color: var(--monaco-bg) !important;
        }
      `;
    }
  }, []);

  const handleEditorDidMount = (_editor: any, monaco: any) => {
    monaco.editor.setTheme(currentThemeId);
  };

  const handleEditorWillMount = (monaco: any) => {
    monaco.editor.defineTheme('teleton-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
      },
    });
    monaco.editor.defineTheme('teleton-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#111111',
      },
    });
  };

  const currentThemeId = globalTheme === 'dark' ? 'teleton-dark' : 'teleton-light';
  
  const buildPreviewBaseHref = (filePath: string) => {
    if (!activeWorkspaceId) {
      return '';
    }

    const parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    const suffix = parts.length > 0 ? `${parts.join('/')}/` : '';
    return resolvePreviewUrl(previewBaseUrl, `/preview/${activeWorkspaceId}/${suffix}`) || '';
  };

  const getPreviewCode = (code: string, filePath = '') => {
    const injectedScrollbarStyle = `
<style>
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(150, 150, 150, 0.3); border-radius: 10px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(150, 150, 150, 0.5); }
  * { scrollbar-width: thin; scrollbar-color: rgba(150, 150, 150, 0.3) transparent; }
</style>
`;
    const baseHref = buildPreviewBaseHref(filePath);
    const baseTag = baseHref ? `<base href="${baseHref}">` : '';
    if (code.includes('</head>')) {
      return code.replace('</head>', `${baseTag}${injectedScrollbarStyle}</head>`);
    } else if (code.includes('</body>')) {
      return `${baseTag}${code.replace('</body>', `${injectedScrollbarStyle}</body>`)}`;
    }
    return `${baseTag}${code}${injectedScrollbarStyle}`;
  };

  switch (block.type) {
    case 'narrative':
      return (
        <div className="agent-block bg-transparent rounded-xl w-full max-w-2xl fade-in">
          {renderRichText(block.text || block.content)}
        </div>
      );

    case 'files_inspected':
      return (
        <div className="agent-block bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl p-3.5 shadow-sm mt-1 w-fit max-w-[90%] fade-in">
          <div className="text-[0.75rem] font-bold text-gray-500 mb-2.5 flex items-center gap-2">
            <FileSearch className="w-3.5 h-3.5 text-primary-500" /> {t('block.filesInspected')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(block.files || []).map((f: any, i: number) => {
              const name = typeof f === 'string' ? f : f.name;
              return (
                <div key={i} className="flex items-center px-2 py-1 bg-gray-50 dark:bg-[#1a1b1e] rounded-md border border-gray-200 dark:border-gray-800 text-[0.8rem] font-mono text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 cursor-default">
                  {repairMojibake(name)}
                </div>
              );
            })}
          </div>
        </div>
      );

    case 'execution_plan': {
      const planItems = block.items || block.steps || [];
      return (
        <div className="agent-block bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl p-4 shadow-sm w-full fade-in mt-1 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 border-b border-gray-100 dark:border-graphite-border pb-3">
            <h4 className="font-bold text-[0.95rem] text-gray-900 dark:text-white flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600">
                <ClipboardList className="w-4 h-4" />
              </div>
              {t('block.structuredPlan')}
            </h4>
            <span className="text-[0.7rem] px-2 py-0.5 font-bold uppercase tracking-wider rounded-md bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400">
              {t('block.awaitingApproval')}
            </span>
          </div>
          
          <ul className="space-y-3 text-sm agent-plan-list">
            {planItems.map((s: string, i: number) => (
              <li key={i} className="flex items-start gap-3 text-gray-700 dark:text-gray-300 group/step">
                <div className="w-6 h-6 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0 mt-0.5 text-[0.7rem] font-bold text-gray-400 group-hover/step:border-blue-300 dark:group-hover/step:border-blue-700 group-hover/step:text-blue-500 transition-colors bg-gray-50 dark:bg-[#1a1b1e]">
                  {i + 1}
                </div>
                <span className="pt-1 leading-snug">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'permission':
      return (
        <div className="agent-block bg-white dark:bg-graphite-card border border-primary-200 dark:border-primary-900/50 rounded-xl p-3 shadow-sm relative overflow-hidden mt-1 w-full max-w-xl fade-in" id="agent-permission-block">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary-400 to-indigo-500"></div>
          <div className="flex items-start gap-2.5 mb-2 mt-1">
            <div className="w-7 h-7 rounded-full bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center text-primary-600 shrink-0 border border-primary-100 dark:border-primary-900/30">
              <ShieldQuestion className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-[0.85rem] font-bold text-gray-900 dark:text-white leading-tight">{repairMojibake(block.title || t('block.permissionRequired'))}</h3>
              <p className="text-[0.75rem] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{repairMojibake(block.description || t('block.permissionDescription'))}</p>
            </div>
          </div>
          {block.text && (
            <div className="bg-gray-50 dark:bg-[#1a1b1e] border border-gray-200 dark:border-gray-800 rounded-lg p-2 mb-3.5 font-mono text-[0.7rem] text-gray-800 dark:text-gray-300 flex items-center gap-2 overflow-x-auto">
              {repairMojibake(block.text)}
            </div>
          )}
          {block.items && block.items.length > 0 && (
            <div className="mb-3.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1b1e] p-3">
              <div className="text-[0.65rem] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                {t('block.structuredPlan')}
              </div>
              <ul className="space-y-2">
                {block.items.map((item, index) => (
                  <li key={index} className="flex items-start gap-2 text-[0.8rem] text-gray-700 dark:text-gray-300">
                    <span className="mt-1 inline-flex h-1.5 w-1.5 rounded-full bg-primary-500 shrink-0"></span>
                    <span>{repairMojibake(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {approvalResolved ? (
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[0.78rem] font-semibold text-primary-700 dark:border-primary-500/20 dark:bg-primary-500/10 dark:text-primary-300">
              {approvalResolved === 'reject' || approvalResolved === 'reject_all'
                ? repairMojibake(language === 'ru' ? 'Решение отправлено. Задача остановлена.' : 'Decision sent. The task has been stopped.')
                : repairMojibake(language === 'ru' ? 'Решение отправлено. Агент продолжает работу.' : 'Decision sent. The agent is continuing the task.')}
            </div>
          ) : (
            <div className="flex gap-1.5 permission-actions">
              <button
                onClick={() => handleApprovalDecision('reject')}
                disabled={!!approvalPending}
                className="flex-1 px-3 py-1.5 text-[0.75rem] font-bold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg transition-colors active:scale-95 disabled:opacity-50"
              >
                {approvalPending === 'reject' ? t('common.loading') : t('block.reject')}
              </button>
              <button
                onClick={() => handleApprovalDecision('accept')}
                disabled={!!approvalPending}
                className="flex-1 px-3 py-1.5 text-[0.75rem] font-bold text-primary-700 bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 dark:text-primary-300 rounded-lg transition-colors active:scale-95 disabled:opacity-50"
              >
                {approvalPending === 'accept' ? t('common.loading') : t('block.allowOneStep')}
              </button>
              <button
                onClick={() => handleApprovalDecision('accept_all')}
                disabled={!!approvalPending}
                className="flex-[1.5] px-3 py-1.5 text-[0.75rem] font-bold bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm active:scale-95 disabled:opacity-50"
              >
                {approvalPending === 'accept_all' ? t('common.loading') : t('block.allowAll')}
              </button>
            </div>
          )}
        </div>
      );

    case 'file_actions': {
      const filePaths = (block.files || [])
        .map((entry: any) => typeof entry === 'string' ? entry : (entry.path || entry.name || ''))
        .filter(Boolean);
      const isPartial = block.status === 'partial';
      return (
        <div className="agent-block bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl p-3.5 shadow-sm mt-1 w-full max-w-3xl fade-in">
          <div className="text-[0.75rem] font-bold text-gray-500 mb-2.5 flex items-center gap-2">
            <GitMerge className={cn("w-3.5 h-3.5", isPartial ? "text-amber-500" : "text-orange-500")} />
            {repairMojibake(block.title || t('block.workResults'))}
            {isPartial ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {repairMojibake(language === 'ru' ? 'частично' : 'partial')}
              </span>
            ) : null}
          </div>
          {block.description ? (
            <div className="mb-2.5 text-[0.82rem] leading-relaxed text-gray-600 dark:text-gray-400">
              {repairMojibake(block.description)}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {filePaths.map((path) => renderWorkspaceFileButton(path))}
          </div>
          {renderWorkspacePreviews(filePaths)}
        </div>
      );
    }

    case 'terminal':
      return (
        <div className="bg-gray-50 dark:bg-black border border-gray-300 dark:border-graphite-border rounded-xl overflow-hidden shadow-md font-mono text-[0.8rem] agent-terminal-block mt-2 w-full max-w-2xl fade-in relative group/term">
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-200 dark:bg-[#111] border-b border-gray-300 dark:border-graphite-border text-gray-600 dark:text-gray-400 font-semibold tracking-wider text-[0.65rem] uppercase select-none">
            <div className="flex items-center">
              <Terminal className="w-3.5 h-3.5 mr-2" /> {t('block.terminal')}
              <span className={cn(
                "ml-3 px-1.5 py-0.5 rounded lowercase status-badge flex items-center gap-1 border bg-white dark:bg-[#1e1e1e]",
                block.status === 'success' ? "border-green-300 dark:border-green-800 text-green-600 dark:text-green-400" : "border-blue-300 dark:border-blue-800 text-blue-600 dark:text-blue-400"
              )}>
                {block.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : (block.status === 'success' ? <Check className="w-3 h-3" /> : null)}
                {block.status || 'running'}
              </span>
            </div>
            <div className="flex gap-1.5 opacity-0 group-hover/term:opacity-100 transition-opacity">
              <button 
                onClick={() => handleCopy(block.command || '', `term-${messageId}`)}
                className={cn("p-1 transition-colors rounded hover:bg-white dark:hover:bg-[#444]", isCopied[`term-${messageId}`] ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")}
                title={t('block.copy')}
              >
                {isCopied[`term-${messageId}`] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="p-4 font-mono text-sm max-h-[300px] overflow-y-auto bg-transparent text-gray-700 dark:text-gray-300">
            <div className="font-bold mb-2 break-all"><span className="text-green-600 dark:text-green-500 mr-2">$</span><span className="text-blue-600 dark:text-blue-400">~/project</span> <span className="text-gray-900 dark:text-white">{block.command}</span></div>
            {block.output && <div className="whitespace-pre-wrap text-gray-600 dark:text-gray-400 opacity-90">{block.output}</div>}
          </div>
          <div className="px-4 py-1.5 bg-gray-100 dark:bg-[#111] border-t border-gray-300 dark:border-graphite-border text-[0.7rem] text-gray-500 dark:text-gray-400 font-mono flex items-center gap-3">
            <span>{t('block.exitCode')}: <span className={block.exitCode === 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400 font-bold"}>{block.exitCode ?? 0}</span></span>
            {block.exitCode === 0 && <span className="text-green-600/80 dark:text-green-400/80 font-semibold">{t('block.success')}</span>}
          </div>
        </div>
      );

    case 'diff': {
      const diffValue = (block.diff || '').trim();
      const fileLabel = block.file || block.path || 'changes.diff';
      if (!diffValue) return null;

      const statusLabel =
        block.status === 'created'
          ? t('block.created')
          : block.status === 'deleted'
            ? t('block.deleted')
            : t('block.modified');

      return (
        <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden font-mono text-[0.82rem] shadow-sm bg-white dark:bg-[#0a0a0a] transition-all w-full max-w-2xl fade-in">
          <div className="bg-gray-50 dark:bg-[#1a1b1e] px-4 py-2.5 flex justify-between items-center border-b border-gray-200 dark:border-gray-800 gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <GitMerge className="w-4 h-4 text-orange-500 shrink-0" />
              <span className="font-medium text-gray-700 dark:text-gray-300 text-xs truncate">{fileLabel}</span>
            </div>
            <span className="text-[0.65rem] px-2 py-0.5 font-bold uppercase tracking-wider rounded-md bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 shrink-0">
              {statusLabel}
            </span>
          </div>
          <div className="max-h-[320px] overflow-auto bg-white dark:bg-[#0a0a0a]">
            {diffValue.split('\n').map((line, index) => {
              const lineClass =
                line.startsWith('+')
                  ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                  : line.startsWith('-')
                    ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                    : line.startsWith('@@')
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300';

              return (
                <div
                  key={`${fileLabel}-${index}`}
                  className={cn('px-4 py-1 whitespace-pre-wrap break-all border-b border-gray-100 dark:border-white/5', lineClass)}
                >
                  {line || ' '}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case 'markdown':
    case 'code':
    case 'runnable_code': {
      const codeValue = normalizeDisplaySource((block.code || block.content || '').trim(), block.type, String(block.path || block.file || block.title || ''));
      const currentPath = block.path || block.file || block.title || (block.type === 'markdown' ? 'content.md' : 'untitled.txt');
      const currentFile = block.file || (typeof currentPath === 'string' ? currentPath.split(/[\\/]/).pop() : '') || (block.type === 'markdown' ? 'content.md' : 'untitled.txt');
      const currentKey = String(currentPath || currentFile);
      const isCodeOnly = block.type === 'code';
      const isMarkdown = block.type === 'markdown';
      const projectHtmlPreviewUrl =
        block.type === 'runnable_code' &&
        activeWorkspaceId &&
        /\.(html?|xhtml)$/i.test(String(currentPath || ''))
          ? buildWorkspacePreviewUrl(previewBaseUrl, activeWorkspaceId, String(currentPath))
          : null;

      if (!codeValue) return null;

      if (isCodeOnly || isMarkdown) {
        return (
          <div className={cn(
            "w-full max-w-3xl border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden font-mono text-[0.85rem] shadow-sm bg-white dark:bg-[#0a0a0a] transition-all diff-block"
          )}>
            <div className="bg-gray-50 dark:bg-[#1a1b1e] px-4 py-2.5 flex justify-between items-center border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2">
                {isMarkdown ? <FileText className="w-4 h-4 text-primary-500" /> : <FileCode className="w-4 h-4 text-blue-500" />}
                <span className="font-medium text-gray-700 dark:text-gray-300 text-xs">{currentFile}</span> 
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => handleCopy(codeValue, currentKey)}
                  className={cn("p-1.5 transition-colors rounded", isCopied[currentKey] ? "text-green-500" : "text-gray-500 hover:text-gray-900 dark:hover:text-white")} 
                  title={t('block.copy')}
                >
                  {isCopied[currentKey] ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {isMarkdown ? (
              <div className="relative w-full overflow-hidden p-5 text-gray-800 dark:text-gray-200 leading-relaxed overflow-y-auto font-sans whitespace-pre-wrap markdown-body" style={{ maxHeight: '60vh' }}>
                {codeValue.split('\n').map((line, i) => {
                   if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold mt-4 mb-2 dark:text-white">{line.replace('# ', '')}</h1>;
                   if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold mt-3 mb-2 dark:text-white">{line.replace('## ', '')}</h2>;
                   if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold mt-2 mb-1 dark:text-white">{line.replace('### ', '')}</h3>;
                   if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc">{line.slice(2)}</li>;
                   return <div key={i} className="min-h-[1.5rem]">{line}</div>;
                })}
              </div>
            ) : (
              <div className="relative h-64 w-full overflow-hidden">
                <div 
                  className={cn(
                    "code-area absolute inset-0 w-full flex transition-colors",
                    globalTheme === 'dark' ? "bg-[#0a0a0a]" : "bg-white"
                  )} 
                  style={{ backgroundColor: globalTheme === 'dark' ? '#0a0a0a' : '#ffffff' }}
                >
                  <Editor
                    key={`diff-${currentFile}-${globalTheme}`}
                    height="100%"
                    defaultLanguage={currentFile.endsWith('.html') ? 'html' : (currentFile.endsWith('.css') ? 'css' : (currentFile.endsWith('.json') ? 'json' : 'javascript'))}
                    defaultValue={codeValue}
                    theme={currentThemeId}
                    beforeMount={handleEditorWillMount}
                    onMount={handleEditorDidMount}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 16, bottom: 16 },
                      overviewRulerLanes: 0,
                      hideCursorInOverviewRuler: true,
                      overviewRulerBorder: false,
                      scrollbar: { 
                        alwaysConsumeMouseWheel: false,
                        verticalScrollbarSize: 4,
                        horizontalScrollbarSize: 4,
                        verticalSliderSize: 4,
                        horizontalSliderSize: 4
                      },
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      }

      return (
        <div className={cn(
          "runnable-code-block border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden font-mono text-[0.85rem] shadow-sm transition-colors",
          globalTheme === 'dark' ? "bg-[#0a0a0a]" : "bg-white"
        )} style={{ backgroundColor: globalTheme === 'dark' ? '#0a0a0a' : '#ffffff' }} data-file={currentKey}>
          <div className="bg-gray-50 dark:bg-[#1a1b1e] px-3 py-2 flex justify-between items-center border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 ml-1">
              <GitMerge className="w-4 h-4 text-orange-500" />
              <span className="font-medium text-gray-700 dark:text-gray-300 text-xs">{currentFile}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700 mx-1"></div>
              <button 
                className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors rounded" 
                onClick={() => {
                  if (isEditing[currentKey] && messageId && editedCode !== null) {
                    saveEditedCode(messageId, codeValue, editedCode);
                  }
                  setIsEditing(prev => ({...prev, [currentKey]: !prev[currentKey]}));
                }} 
                title={t('block.edit')}
              >
                {isEditing[currentKey] ? <Save className="w-4 h-4 text-gray-500" /> : <Pencil className="w-4 h-4" />}
              </button>
              <button 
                className={cn("p-1.5 transition-colors rounded", isCopied[currentKey] ? "text-green-500" : "text-gray-500 hover:text-gray-900 dark:hover:text-white")} 
                onClick={() => handleCopy(codeValue, currentKey)}
                title={t('block.copy')}
              >
                {isCopied[currentKey] ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              {block.type === 'runnable_code' ? (
                <div className="flex bg-gray-200 dark:bg-black p-0.5 rounded-lg border border-gray-300 dark:border-gray-800 font-sans ml-1">
                  <button className={cn("toggle-btn p-1 rounded-md transition-all", getMode(currentKey) === 'code' ? "bg-white dark:bg-gray-800 shadow-sm text-gray-900 dark:text-white" : "text-gray-500")} onClick={() => setMode(currentKey, 'code')} title={t('block.code')}><Code className="w-3.5 h-3.5" /></button>
                  <button className={cn("toggle-btn p-1 rounded-md transition-all", getMode(currentKey) === 'preview' ? "bg-white dark:bg-gray-800 shadow-sm text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300")} onClick={() => setMode(currentKey, 'preview')} title={t('block.preview')}><Play className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <div className="flex bg-gray-200 dark:bg-black p-0.5 rounded-lg border border-gray-300 dark:border-gray-800 font-sans ml-1">
                  <div className="px-2 py-0.5 text-[0.65rem] font-bold uppercase text-gray-500 flex items-center gap-1">
                    <Code className="w-3 h-3" /> Code
                  </div>
                </div>
              )}
            </div>
          </div>
            <div className={cn(
              "relative w-full overflow-hidden transition-all duration-300",
              expandedFiles[currentKey] ? "h-80" : "h-80"
            )}>
              {getMode(currentKey) === 'code' ? (
                <div 
                  className={cn(
                    "code-area absolute inset-0 w-full flex transition-colors",
                    globalTheme === 'dark' ? "bg-[#0a0a0a]" : "bg-white"
                  )} 
                  style={{ backgroundColor: globalTheme === 'dark' ? '#0a0a0a' : '#ffffff' }}
                >
                  <Editor
                    key={`run-${currentKey}-${globalTheme}`}
                    height="100%"
                    defaultLanguage={currentFile.endsWith('.html') ? 'html' : (currentFile.endsWith('.css') ? 'css' : (currentFile.endsWith('.md') ? 'markdown' : (currentFile.endsWith('.json') ? 'json' : 'javascript')))}
                    defaultValue={codeValue}
                    theme={currentThemeId}
                    beforeMount={handleEditorWillMount}
                    onMount={handleEditorDidMount}
                    onChange={(value) => setEditedCode(value || '')}
                    options={{
                      readOnly: !isEditing[currentKey],
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 16, bottom: 16 },
                      overviewRulerLanes: 0,
                      hideCursorInOverviewRuler: true,
                      overviewRulerBorder: false,
                      scrollbar: { 
                        alwaysConsumeMouseWheel: false,
                        verticalScrollbarSize: 4,
                        horizontalScrollbarSize: 4,
                        verticalSliderSize: 4,
                        horizontalSliderSize: 4
                      },
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="preview-area absolute inset-0 w-full h-full bg-white flex items-center justify-center border-t border-gray-100 dark:border-gray-800 relative">
                    {projectHtmlPreviewUrl ? (
                      <iframe className="w-full h-full border-none" src={projectHtmlPreviewUrl} sandbox={previewSandbox} referrerPolicy="no-referrer" title={`${currentFile}-preview`}></iframe>
                    ) : (
                      <iframe className="w-full h-full border-none" srcDoc={getPreviewCode(codeValue, currentPath)} sandbox={srcDocSandbox} referrerPolicy="no-referrer" title={`${currentFile}-preview`}></iframe>
                    )}
                    <button 
                      className="absolute bottom-6 right-6 p-4 bg-gray-950/90 hover:bg-black text-white rounded-2xl transition-all backdrop-blur-xl shadow-2xl z-20 border border-white/10 active:scale-95 group" 
                      title={t('block.expand')}
                      onClick={() => setExpandedFiles(prev => ({ ...prev, [currentKey]: true }))}
                    >
                      <Maximize2 className="w-6 h-6" />
                    </button>
                  </div>

                  {expandedFiles[currentKey] && createPortal(
                    <div className="absolute inset-0 z-[100] flex bg-gray-50 dark:bg-black p-1.5 sm:p-2">
                      <div className="relative w-full h-full bg-white dark:bg-[#0a0a0a] rounded-2xl overflow-hidden flex flex-col pointer-events-auto shadow-sm border border-gray-200 dark:border-white/10">
                        <div className="flex-1 relative bg-white">
                          {projectHtmlPreviewUrl ? (
                            <iframe className="w-full h-full border-none bg-white font-sans" src={projectHtmlPreviewUrl} sandbox={previewSandbox} referrerPolicy="no-referrer" title={`${currentFile}-expanded-preview`}></iframe>
                          ) : (
                            <iframe className="w-full h-full border-none bg-white font-sans" srcDoc={getPreviewCode(codeValue, currentPath)} sandbox={srcDocSandbox} referrerPolicy="no-referrer" title={`${currentFile}-expanded-preview`}></iframe>
                          )}
                        </div>
                        <button 
                          className="absolute bottom-6 right-6 p-4 bg-gray-950 hover:bg-black text-white rounded-2xl transition-all shadow-2xl z-20 border border-white/20 active:scale-95"
                          onClick={() => setExpandedFiles(prev => ({ ...prev, [currentKey]: false }))}
                          title={t('block.collapse')}
                        >
                          <Minimize2 className="w-6 h-6" />
                        </button>
                      </div>
                    </div>,
                    document.getElementById('preview-portal-root') || document.body
                  )}
                </>
              )}
            </div>
        </div>
      );
    }

    case 'error': {
      const recoveryAvailable = block.recoveryAvailable !== false;
      return (
        <div className="agent-block bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-xl p-4 shadow-sm">
          <h4 className="font-bold text-[0.95rem] text-red-800 dark:text-red-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {repairMojibake(block.title || t('block.executionError'))}
          </h4>
          <p className="text-sm text-red-600 dark:text-red-300 mb-4 font-mono text-xs p-2 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-800/50">
            {repairMojibake(block.text)}
          </p>
          {block.description ? (
            <div className="mb-4 text-[0.82rem] leading-relaxed text-red-700 dark:text-red-300">
              {repairMojibake(block.description)}
            </div>
          ) : null}
          {recoveryAvailable ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleRecoveryAction('skip')}
                disabled={!block.taskId || !!recoveryPending}
                className="px-4 py-1.5 text-xs font-semibold text-red-600 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 rounded-lg transition-colors border border-red-200 dark:border-red-800/50 disabled:opacity-50"
              >
                {t('block.skipStep')}
              </button>
              <button
                type="button"
                onClick={() => handleRecoveryAction('fix')}
                disabled={!block.taskId || !!recoveryPending}
                className="px-4 py-1.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Wrench className="w-3.5 h-3.5" /> {t('block.fixIt')}
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    case 'decision':
    case 'next_step':
    case 'validation':
    case 'recovery':
    case 'clarification':
      return (
        <div className="agent-block bg-transparent rounded-xl p-0 w-full max-w-2xl fade-in">
          {renderRichText(block.text)}
        </div>
      );

    case 'findings':
      return (
        <div className="agent-block bg-transparent rounded-xl p-0 w-full max-w-2xl fade-in">
          <h4 className="font-bold text-[0.95rem] text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" /> {language === 'ru' ? 'Замечания' : 'Findings'}
          </h4>
          <div className="agent-copy">
            {(block.items || []).map((item, index) => (
              <div key={index} className="my-2 flex items-start gap-3">
                <span className="mt-[0.72rem] inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                <div className="min-w-0 flex-1"><p>{renderInlineText(repairMojibake(item))}</p></div>
              </div>
            ))}
          </div>
        </div>
      );

    case 'summary': {
      const summaryItems = Array.isArray(block.items) ? block.items : [];
      const summaryPreviewPaths = summaryItems
        .map((item) => resolveWorkspacePath(item))
        .filter(Boolean);
      return (
        <div className="agent-block bg-transparent rounded-xl p-0 summary-block w-full max-w-2xl fade-in">
          <h4 className="font-bold text-[0.95rem] text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-primary-500" /> {t('block.workResults')}
          </h4>
          {summaryItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {summaryItems.map((item, index) => {
                const path = resolveWorkspacePath(item);
                return path
                  ? renderWorkspaceFileButton(path, extractFileLikePath(item) || item)
                  : (
                    <div key={`summary-item:${index}`} className="text-[0.92rem] text-gray-700 dark:text-gray-300">
                      {repairMojibake(item)}
                    </div>
                  );
              })}
            </div>
          ) : (
            renderRichText(block.text)
          )}
          {renderWorkspacePreviews(summaryPreviewPaths)}
        </div>
      );
    }

    case 'search_results':
        return (
          <div className="agent-block bg-gray-50 dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden mb-6 w-full fade-in">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#1a1b1e]">
              <Search className="w-4 h-4 text-primary-500" />
              <span className="text-[0.65rem] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{t('block.search')}: {repairMojibake(block.query || block.title || '')}</span>
            </div>
            <div className="p-3 space-y-2">
              {(block.results || []).map((res: any, i: number) => (
                <div key={i} className="flex flex-col gap-1 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-white/10 cursor-pointer">
                  <div className="flex items-center gap-2 text-[0.85rem] font-bold text-primary-600">
                     {res.url ? <ExternalLink className="w-3.5 h-3.5" /> : <FileCode className="w-3.5 h-3.5" />}
                    {repairMojibake(res.file || res.title || t('block.source'))}
                  </div>
                  <div className="text-[0.75rem] text-gray-500 line-clamp-1">{repairMojibake(res.snippet || res.text || res.description || '')}</div>
                </div>
              ))}
            </div>
          </div>
        );

    case 'app_preview': {
      const previewKey = `${messageId || 'preview'}:${block.url || block.taskId || 'current'}`;
      const previewUrl = resolvePreviewUrl(
        previewBaseUrl,
        block.url || (block.taskId ? `/api/tasks/${block.taskId}/preview` : `/preview/${block.taskId || 'current'}/index.html`)
      );
      return (
        <div className="agent-block bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl shadow-lg overflow-hidden mt-2 w-full max-w-3xl fade-in flex flex-col h-[520px]">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-[#1a1b1e] border-b border-gray-200 dark:border-gray-800 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary-500/10 flex items-center justify-center text-primary-600">
                <Play className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-tight">{t('block.appPreview')}</span>
            </div>
            <div className="flex items-center gap-1.5">
               <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400">LIVE</span>
               {previewUrl && (
                 <a href={previewUrl} target="_blank" rel="noreferrer" className="p-1 text-gray-400 hover:text-primary-500 transition-colors">
                   <ExternalLink className="w-3.5 h-3.5" />
                 </a>
               )}
            </div>
          </div>
          <div className="flex-1 bg-white relative group">
            <iframe 
               src={previewUrl || undefined}
               className="w-full h-full border-none shadow-inner bg-white"
               sandbox={previewSandbox}
               referrerPolicy="no-referrer"
               title="App Preview"
            ></iframe>
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
               <button 
                  onClick={() => setExpandedAppPreviews((prev) => ({ ...prev, [previewKey]: true }))}
                  className="p-2 bg-white/90 backdrop-blur shadow-sm rounded-lg border border-gray-200 hover:bg-white text-gray-700 active:scale-95"
                  title={t('block.expand')}
               >
                  <Maximize2 className="w-4 h-4" />
               </button>
            </div>
          </div>
          <div className="px-4 py-2 bg-gray-50 dark:bg-[#0d0d0d] border-t border-gray-200 dark:border-gray-800 text-[0.65rem] text-gray-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5 italic">
               <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
               {t('block.readyToTest')}
            </span>
            <span className="font-mono opacity-60 truncate max-w-[50%]">{previewUrl}</span>
          </div>
          {expandedAppPreviews[previewKey] && createPortal(
            <div className="fixed inset-0 z-[100] flex bg-gray-50 dark:bg-black p-1.5 sm:p-2">
              <div className="relative w-full h-full bg-white dark:bg-[#0a0a0a] rounded-2xl overflow-hidden flex flex-col pointer-events-auto shadow-sm border border-gray-200 dark:border-white/10">
                <div className="flex-1 relative bg-white">
                  <iframe className="w-full h-full border-none bg-white" src={previewUrl || undefined} sandbox={previewSandbox} referrerPolicy="no-referrer" title="Expanded App Preview"></iframe>
                </div>
                <button
                  className="absolute bottom-6 right-6 p-4 bg-gray-950 hover:bg-black text-white rounded-2xl transition-all shadow-2xl z-20 border border-white/20 active:scale-95"
                  onClick={() => setExpandedAppPreviews((prev) => ({ ...prev, [previewKey]: false }))}
                  title={t('block.collapse')}
                >
                  <Minimize2 className="w-6 h-6" />
                </button>
              </div>
            </div>,
            document.getElementById('preview-portal-root') || document.body
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
