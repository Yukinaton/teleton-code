import { useRef, useEffect, useState } from 'react';
import { useChatStore } from '../../entities/chat/useChatStore';
import { useWorkspaceFiles } from '../../entities/workspace/useWorkspaceQuery';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { BlockRenderer } from '../chat/BlockRenderer';
import { cn } from '../../shared/utils/cn';
import { X, Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useI18n } from '../../shared/i18n/useI18n';
import { repairMojibake } from '../../shared/utils/text';
import { resolvePreviewUrl } from '../../shared/utils/preview';
import {
  buildStepFeedSummary,
  formatAttachmentSize,
  inferPreviewBlockType,
  inferSnippetBlockType,
  inferSnippetFileName,
  normalizeTaskSteps,
  parseContent,
  shouldRenderCompatibilityStatusCard,
  stepStatusLabel,
  taskEvidenceSummary,
  taskPhaseBadge,
  taskPhaseHeadline,
  taskPrimaryDetail,
} from './chat-view-helpers';

export function ChatView() {
  const { messages, activeWorkspaceId } = useChatStore();
  const language = useLayoutStore((state) => state.language);
  const previewBaseUrl = useLayoutStore((state) => state.previewBaseUrl);
  const { data: workspaceFiles } = useWorkspaceFiles(activeWorkspaceId || '');
  const { t } = useI18n();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastMessageCountRef = useRef(0);
  const lastUserMessageIdRef = useRef<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, { path: string, name: string, content: string }>>({});
  const trackedLastMessage = messages[messages.length - 1];
  const trackedLastMessageStatus = trackedLastMessage?.status;
  const trackedLastMessageStepCount = trackedLastMessage?.steps?.length ?? 0;
  const trackedLastMessageBlockCount = trackedLastMessage?.blocks?.length ?? 0;
  const trackedLastMessageContent = trackedLastMessage?.content ?? '';

  const toggleFilePreview = async (msgId: string, file: any) => {
    const key = `${msgId}-${file.path}`;
    if (expandedFiles[key]) {
      setExpandedFiles(prev => { const next = {...prev}; delete next[key]; return next; });
    } else {
      try {
        const res = await fetch(`/api/workspaces/${activeWorkspaceId}/file?path=${encodeURIComponent(file.path)}`);
        const json = await res.json();
        if (json.success) {
          setExpandedFiles(prev => ({ ...prev, [key]: { path: file.path, name: file.name, content: json.data.content } }));
        }
      } catch (_error) {
        return;
      }
    }
  };

  const openAppPreview = async () => {
    useLayoutStore.getState().openModal('modal-app-preview');
    try {
      const previewMetaRes = await fetch(`/api/workspaces/${activeWorkspaceId}/preview`);
      const previewMeta = await previewMetaRes.json();
      const previewUrl = resolvePreviewUrl(previewBaseUrl, previewMeta?.data?.url);

      if (!previewMetaRes.ok || !previewMeta?.success || !previewUrl) {
        throw new Error('Preview entry not found');
      }

      useLayoutStore.getState().setPreviewUrl(previewUrl);
      useLayoutStore.getState().setPreviewCode(null);
    } catch (_error) {
      useLayoutStore.getState().setPreviewUrl(null);
      useLayoutStore.getState().setPreviewCode(`<h1>${t('chat.previewLoadError')}</h1>`);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    chatEndRef.current?.scrollIntoView({ behavior });
  };

  const isNearBottom = () => {
    const container = chatContainerRef.current;
    if (!container) return true;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance < 120;
  };

  const renderInlineMarkdown = (text: string, msgId: string) => {
    text = repairMojibake(text);
    // Enhanced regex to detect filenames even without backticks if they have common extensions
    const fileRegex = /\b([a-zA-Z0-9_.-]+\.(?:html|css|js|jsx|ts|tsx|json|md))\b/g;
    const fileLikeRegex = /^[a-zA-Z0-9_.-]+\.(?:html|css|js|jsx|ts|tsx|json|md)$/i;
    
    // Simple bold, italic and inline code support
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-[800] text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic text-gray-800 dark:text-gray-200">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        const content = part.slice(1, -1);
        const isFileName = /^[a-zA-Z0-9_.-]+\.[a-z0-9]+$/i.test(content);
        
        if (isFileName) {
          const fileExists = workspaceFiles?.find((f: any) => !f.isDir && (f.path === content || f.name === content));
          if (fileExists) {
            return (
              <button 
                key={i} 
                onClick={() => toggleFilePreview(msgId, fileExists)}
                className="bg-primary-50 dark:bg-primary-500/10 px-1.5 py-0.5 rounded font-mono text-[0.85rem] text-primary-600 border border-primary-200 dark:border-primary-500/20 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors cursor-pointer"
              >
                {content}
              </button>
            );
          } else {
            return (
              <span 
                key={i} 
                className="bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded font-mono text-[0.85rem] text-gray-500 border border-gray-200 dark:border-white/5"
              >
                {content}
              </span>
            );
          }
        }

        return <code key={i} className="bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded font-mono text-[0.85rem] text-primary-600 border border-gray-200 dark:border-white/5">{content}</code>;
      }

      // Plain text part: try to detect filenames that aren't in backticks
      const textParts = part.split(fileRegex);
      if (textParts.length > 1) {
        return textParts.map((t, idx) => {
           if (fileLikeRegex.test(t) || (idx % 2 === 1)) {
              const fileExists = workspaceFiles?.find((f: any) => !f.isDir && (f.path === t || f.name === t));
              if (fileExists) {
                return (
                  <button 
                    key={`${i}-${idx}`} 
                    onClick={() => toggleFilePreview(msgId, fileExists)}
                    className="text-primary-600 hover:text-primary-700 underline decoration-primary-500/30 underline-offset-2 transition-colors cursor-pointer font-medium"
                  >
                    {t}
                  </button>
                );
              } else {
                return <span key={`${i}-${idx}`} className="text-gray-600 dark:text-gray-400 font-medium">{t}</span>;
              }
           }
           return t;
        });
      }

      return part;
    });
  };

  const renderFormattedText = (text: string, msgId: string) => {
    const lines = repairMojibake(text).split('\n');
    return (
      <div className="agent-copy flex flex-col gap-1 max-w-none">
        {lines.map((line, i) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return <div key={i} className="h-1.5" />;
          
          const isPreviewTrigger = /index\.html/i.test(line) && /(files?|файл)/i.test(repairMojibake(line));
          
          // Headers
          const headerMatch = trimmedLine.match(/^(#{1,6})\s*(.+)$/);
          if (headerMatch) {
            const level = headerMatch[1].length;
            const content = headerMatch[2];
            const classNames = [
              "", "text-xl font-bold text-gray-900 dark:text-white mt-4 mb-2",
              "text-lg font-bold text-gray-800 dark:text-gray-100 mt-3 mb-1.5",
              "text-base font-bold text-gray-800 dark:text-gray-200 mt-2 mb-1",
              "text-sm font-bold text-gray-700 dark:text-gray-300 mt-2",
              "text-xs font-bold text-gray-600 dark:text-gray-400 mt-1",
              "text-xs font-bold text-gray-500 dark:text-gray-500"
            ];
            return <div key={i} className={classNames[level]}>{renderInlineMarkdown(content, msgId)}</div>;
          }
  
          // Check for lists
          if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ') || /^\d+\.\s/.test(trimmedLine)) {
            return (
              <div key={i} className="pl-4 relative flex items-start gap-2 py-0.5">
                <span className="text-primary-500 mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-primary-500/20 border border-primary-500/30" />
                <span>{renderInlineMarkdown(trimmedLine.replace(/^[-*]\s|\d+\.\s/, ''), msgId)}</span>
              </div>
            );
          }
          
          return (
            <div key={i} className="py-0.5">
              {renderInlineMarkdown(line, msgId)}
              {isPreviewTrigger && (
                <button 
                  onClick={openAppPreview}
                  className="mt-3 mb-1 flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl shadow-sm transition-all w-fit"
                >
                  <Play size={16} fill="currentColor" />
                  {t('chat.runProjectPreview')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      shouldAutoScrollRef.current = isNearBottom();
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;

    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user') || null;
    const latestUserMessageId = latestUserMessage?.id || null;
    const hasNewUserMessage = Boolean(latestUserMessageId && latestUserMessageId !== lastUserMessageIdRef.current);
    const hasNewMessage = messages.length > lastMessageCountRef.current;

    if (hasNewUserMessage) {
      scrollToBottom('smooth');
      shouldAutoScrollRef.current = true;
    } else if (shouldAutoScrollRef.current) {
      const behavior: ScrollBehavior =
        lastMessage.role === 'agent' && !hasNewMessage ? 'auto' : 'smooth';
      scrollToBottom(behavior);
    }

    lastMessageCountRef.current = messages.length;
    lastUserMessageIdRef.current = latestUserMessageId;
  }, [
    messages,
    messages.length,
    trackedLastMessageStatus,
    trackedLastMessageStepCount,
    trackedLastMessageBlockCount,
    trackedLastMessageContent,
  ]);

  const isChatEmpty = messages.length === 0;

  return (
    <div 
      id="chat-container" 
      ref={chatContainerRef}
      className={cn(
        "flex-1 overflow-y-auto px-4 pt-6 relative z-10 transition-opacity duration-500",
        isChatEmpty ? "hidden opacity-0" : "flex flex-col opacity-100"
      )}
      style={{ paddingBottom: '180px' }}
    >
      <div id="chat-history" className="max-w-3xl mx-auto flex flex-col gap-2 w-full px-4">
        {messages.map((msg) => (
          <div key={msg.id} className={cn("chat-message fade-in flex flex-col w-full", msg.role === 'user' ? "items-end mt-2" : "items-start")}>
            {/* User Message */}
            {msg.role === 'user' && (
              <div className="flex max-w-[85%] flex-col items-end gap-2">
                <div 
                  className="w-full text-white px-5 py-3 rounded-2xl rounded-tr-sm text-[0.95rem] leading-relaxed shadow-md"
                  style={{ backgroundColor: '#2563eb' }}
                >
                  {repairMojibake(msg.content)}
                </div>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {msg.attachments.map((attachment, index) => (
                      <button
                        key={`${msg.id}-attachment-${index}`}
                        onClick={() => attachment.path && toggleFilePreview(msg.id, attachment)}
                        disabled={!attachment.path}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[0.78rem] transition-colors",
                          attachment.path
                            ? "border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-500/20 dark:bg-primary-500/10 dark:text-primary-300 dark:hover:bg-primary-500/20"
                            : "border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400"
                        )}
                      >
                        <span className="truncate max-w-[200px]">{attachment.name}</span>
                        {attachment.size ? (
                          <span className="text-[0.72rem] opacity-70">{formatAttachmentSize(attachment.size)}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AI Message */}
            {msg.role === 'agent' && (
              <div className="flex flex-col gap-4 w-full">
                {(() => {
                  const isCompatibilityMessage =
                    msg.taskState?.taskEngine
                      ? msg.taskState.taskEngine === 'compatibility'
                      : (msg.taskState?.agentLoopVersion || 1) === 2;
                  const rawVisibleSteps = normalizeTaskSteps(msg.steps || [], language);
                  const visibleSteps =
                    isCompatibilityMessage && ['answer', 'clarify'].includes(String(msg.taskState?.mode || ''))
                      ? []
                      : rawVisibleSteps;
                  const stepFeed = buildStepFeedSummary(visibleSteps, language);
                  const hasStepIssue = visibleSteps.some((step) => ['failed', 'waiting'].includes(step.status));
                  const shouldRenderCompatibilityDebugSteps =
                    visibleSteps.length > 0 &&
                    (hasStepIssue ||
                      msg.taskState?.phase === 'failed' ||
                      msg.taskState?.phase === 'awaiting_approval');
                  const shouldRenderStepFeed =
                    !isCompatibilityMessage &&
                    !msg.isStreaming &&
                    visibleSteps.length > 0 &&
                    (hasStepIssue || (!msg.blocks?.length && !msg.content?.trim()));
                  const visibleCompatibilityHeadline =
                    msg.isStreaming && msg.taskState?.phase === 'idle'
                      ? repairMojibake(language === 'ru' ? 'Подготавливаю следующий шаг' : 'Preparing the next step')
                      : repairMojibake(taskPhaseHeadline(msg.taskState, language));
                  const visibleCompatibilityBadge =
                    msg.isStreaming && msg.taskState?.phase === 'idle'
                      ? repairMojibake(language === 'ru' ? 'старт' : 'starting')
                      : repairMojibake(taskPhaseBadge(msg.taskState, language));
                  const visibleCompatibilityDetail =
                    msg.isStreaming && msg.taskState?.phase === 'idle' && !msg.taskState?.currentAction
                      ? repairMojibake(
                          language === 'ru'
                            ? 'Агент собирает контекст и подготавливает первый рабочий шаг.'
                            : 'The agent is gathering context and preparing the first work step.'
                        )
                      : taskPrimaryDetail(msg.taskState, language);
                  const concreteBlockTypes = new Set([
                    'file_actions',
                    'code',
                    'runnable_code',
                    'markdown',
                    'diff',
                    'app_preview',
                    'validation',
                    'summary',
                    'error',
                  ]);
                  const hasConcreteArtifactBlocks = Boolean(
                    msg.blocks?.some((block: any) => concreteBlockTypes.has(block?.type))
                  );
                  const hasFileActionBlock = Boolean(
                    msg.blocks?.some((block: any) => block?.type === 'file_actions')
                  );
                  const shouldHideExecutionNarrative =
                    isCompatibilityMessage &&
                    ['execute', 'recover'].includes(String(msg.taskState?.mode || '')) &&
                    hasConcreteArtifactBlocks;
                  const visibleBlocks = (msg.blocks || []).filter((block: any) => {
                    if (!block?.type) return false;
                    if (isCompatibilityMessage && block.type === 'recovery') {
                      return false;
                    }
                    if (shouldHideExecutionNarrative && block.type === 'narrative') {
                      return false;
                    }
                    if (
                      isCompatibilityMessage &&
                      hasFileActionBlock &&
                      ['code', 'runnable_code', 'markdown'].includes(block.type)
                    ) {
                      return false;
                    }
                    return true;
                  });
                  const shouldRenderTypingBubble = msg.isStreaming;
                  return (
                    <>
                {shouldRenderTypingBubble && (
                  <div className="flex w-fit items-center gap-1 py-1">
                    <span className="hidden">
                      {repairMojibake(language === 'ru' ? 'Агент печатает' : 'Agent is typing')}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500" />
                    </div>
                  </div>
                )}

                {/* Agent Steps */}
                {isCompatibilityMessage && !msg.isStreaming && msg.taskState && shouldRenderCompatibilityStatusCard(msg.taskState, { isStreaming: msg.isStreaming }) && (
                  <div className="w-full rounded-2xl border border-gray-200/80 bg-white/80 px-4 py-3.5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300">
                          {msg.taskState.phase === 'failed' ? (
                            <AlertCircle className="h-[18px] w-[18px]" />
                          ) : msg.taskState.phase === 'completed' ? (
                            <CheckCircle2 className="h-[18px] w-[18px]" />
                          ) : msg.taskState.phase === 'awaiting_approval' ? (
                            <AlertCircle className="h-[18px] w-[18px]" />
                          ) : (
                            <Loader2 className={cn('h-[18px] w-[18px]', msg.isStreaming ? 'animate-spin' : '')} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[0.95rem] font-semibold text-gray-900 dark:text-white">
                            {visibleCompatibilityHeadline}
                          </div>
                          <div className="mt-1 text-[0.84rem] leading-relaxed text-gray-600 dark:text-gray-400">
                            {visibleCompatibilityDetail}
                          </div>
                          {taskEvidenceSummary(msg.taskState, language) &&
                          msg.taskState.currentAction &&
                          visibleCompatibilityDetail !== repairMojibake(taskEvidenceSummary(msg.taskState, language) || '') ? (
                            <div className="mt-1.5 text-[0.78rem] text-gray-500 dark:text-gray-400">
                              {repairMojibake(taskEvidenceSummary(msg.taskState, language) || '')}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em]",
                            msg.taskState.phase === 'failed'
                              ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                              : msg.taskState.phase === 'completed'
                                ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                                : msg.taskState.phase === 'awaiting_approval'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                                  : 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300'
                          )}
                        >
                          {visibleCompatibilityBadge}
                        </span>
                      </div>
                    </div>
                    {shouldRenderCompatibilityDebugSteps ? (
                      <details className="mt-3 rounded-xl border border-gray-200/70 bg-gray-50/80 px-3 py-2.5 dark:border-white/10 dark:bg-black/20">
                        <summary className="cursor-pointer list-none text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                          {repairMojibake(language === 'ru' ? 'Отладочные шаги' : 'Debug steps')}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {visibleSteps.map((step, idx) => (
                            <div key={`${msg.id}-compat-step-${idx}`} className="rounded-lg bg-white px-3 py-2 text-[0.82rem] shadow-sm dark:bg-white/[0.03]">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  {repairMojibake(step.title || t('chat.runningStep'))}
                                </span>
                                <span className="text-[0.7rem] uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                                  {repairMojibake(stepStatusLabel(step.status, language))}
                                </span>
                              </div>
                              {step.thought ? (
                                <div className="mt-1 text-[0.8rem] text-gray-600 dark:text-gray-400">
                                  {repairMojibake(step.thought)}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                )}

                {shouldRenderStepFeed && (
                  <details
                    className="w-full rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.03]"
                    open={msg.isStreaming || hasStepIssue}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 select-none">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300">
                          {visibleSteps.some((step) => step.status === 'failed') ? (
                            <AlertCircle className="h-[18px] w-[18px]" />
                          ) : msg.isStreaming ? (
                            <Loader2 className="h-[18px] w-[18px] animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-[18px] w-[18px]" />
                          )}
                        </div>
                        <div className="min-w-0">
                    <div className="truncate text-[0.92rem] font-semibold text-gray-900 dark:text-white">
                            {repairMojibake(stepFeed.headline)}
                          </div>
                          <div className="mt-0.5 truncate text-[0.78rem] text-gray-500 dark:text-gray-400">
                            {repairMojibake(
                              msg.isStreaming && stepFeed.latest?.status === 'running'
                                ? (stepFeed.latest?.thought || stepFeed.counter)
                                : stepFeed.counter
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                          {repairMojibake(stepFeed.detailCta)}
                        </div>
                        <div className="mt-1 text-[0.76rem] text-gray-500 dark:text-gray-400">
                          {repairMojibake(stepFeed.counter)}
                        </div>
                      </div>
                    </summary>

                    <div className="border-t border-gray-200/70 px-3 pb-3 pt-2.5 dark:border-white/10">
                      <div className="flex flex-col gap-1.5">
                        {visibleSteps.map((step, idx) => {
                          const isRunning = step.status === 'running';
                          const isSuccess = step.status === 'completed' || step.status === 'success';
                          const isFailed = step.status === 'failed';

                          return (
                            <div
                              key={`${msg.id}-step-${idx}`}
                              className="rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50/80 dark:hover:border-white/10 dark:hover:bg-white/[0.03]"
                            >
                              <div className="flex items-start gap-3">
                                <span className="mt-0.5 shrink-0">
                                  {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary-500" />}
                                  {isSuccess && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                  {isFailed && <AlertCircle className="h-4 w-4 text-red-500" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      {repairMojibake(step.title || t('chat.runningStep'))}
                                    </span>
                                    <span
                                      className={cn(
                                        "rounded-full px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-wider",
                                        isFailed
                                          ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                                          : isSuccess
                                            ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                                            : "bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                                      )}
                                    >
                                      {repairMojibake(stepStatusLabel(step.status, language))}
                                    </span>
                                    {step.durationMs ? (
                                      <span className="text-[0.72rem] font-mono text-gray-400 dark:text-gray-500">
                                        {step.durationMs}ms
                                      </span>
                                    ) : null}
                                  </div>
                                  {step.thought && step.thought.trim().length > 0 && (
                                    <div className="mt-1.5 text-[0.84rem] leading-relaxed text-gray-600 dark:text-gray-400">
                                      {repairMojibake(step.thought.trim())}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                )}

                {/* Structured blocks are the primary rendering path. Fallback to legacy text parsing only when blocks are absent. */}
                {visibleBlocks.length > 0 ? (
                  visibleBlocks.map((block: any, i: number) => (
                    <div key={i} className="w-full fade-in">
                      <BlockRenderer
                        block={block}
                        messageId={msg.id}
                        workspaceId={msg.taskState?.workspaceId || activeWorkspaceId || undefined}
                      />
                    </div>
                  ))
                ) : (
                  msg.content && parseContent(msg.content).map((part, idx) => (
                    part.type === 'text' ? (
                      part.content.trim() && (
                        <div key={idx} className="w-full max-w-2xl fade-in">
                          {renderFormattedText(part.content, msg.id)}
                        </div>
                      )
                    ) : (
                      <div key={idx} className="w-full fade-in">
                        <BlockRenderer
                          block={{
                            type: inferSnippetBlockType(part.language, part.content),
                            code: part.content,
                            file: inferSnippetFileName(part.language, part.content)
                          }}
                          messageId={msg.id}
                          workspaceId={msg.taskState?.workspaceId || activeWorkspaceId || undefined}
                        />
                      </div>
                    )
                  ))
                )}
                
                {/* Expanded File Previews */}
                {Object.entries(expandedFiles).filter(([k]) => k.startsWith(`${msg.id}-`)).map(([k, preview]) => (
                   <div key={k} className="w-full fade-in slide-in-top mt-2 rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden shadow-sm bg-gray-50 dark:bg-black/20">
                      <div className="bg-gray-100 dark:bg-black/40 px-3 py-2 flex justify-between items-center border-b border-gray-200 dark:border-white/10">
                         <span className="text-xs font-mono font-semibold text-gray-700 dark:text-gray-300">{preview.name}</span>
                         <button onClick={() => setExpandedFiles(p => { const n = {...p}; delete n[k]; return n; })} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                            <X size={14} />
                         </button>
                      </div>
                      <div className="p-2">
                            <BlockRenderer 
                              block={{ 
                                type: inferPreviewBlockType(preview.path || preview.name),
                                code: preview.content, 
                                file: preview.name,
                                path: preview.path
                          }} 
                          messageId={msg.id}
                          workspaceId={msg.taskState?.workspaceId || activeWorkspaceId || undefined}
                        />
                      </div>
                   </div>
                ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} id="chat-anchor" className="h-4 shrink-0" />
      </div>
    </div>
  );
}
