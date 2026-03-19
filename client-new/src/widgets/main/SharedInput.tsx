import { useRef, useState, useEffect } from 'react';
import { Paperclip, Mic, ArrowUp, X, Check } from 'lucide-react';
import { useChatStore } from '../../entities/chat/useChatStore';
import { useWorkspaces } from '../../entities/workspace/useWorkspaceQuery';
import { useVoiceRecording } from '../../features/voice-input/useVoiceRecording';
import { VoiceVisualizer } from '../../features/voice-input/VoiceVisualizer';
import { cn } from '../../shared/utils/cn';
import { useI18n } from '../../shared/i18n/useI18n';
import type { ChatUploadAttachment } from '../../entities/chat/types';

interface SharedInputProps {
  isChatEmpty: boolean;
}

interface PendingAttachment {
  id: string;
  file: File;
}

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 200_000;
const SUPPORTED_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'xml', 'csv',
  'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'php', 'java', 'kt', 'swift', 'go', 'rs', 'sh',
  'ps1', 'sql', 'env', 'ini', 'toml', 'log',
]);

function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fileExtension(name: string) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function isSupportedAttachment(file: File) {
  return SUPPORTED_EXTENSIONS.has(fileExtension(file.name));
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(file.name));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const [, contentBase64 = ''] = dataUrl.split(',', 2);
      resolve(contentBase64);
    };
    reader.readAsDataURL(file);
  });
}

export function SharedInput({ isChatEmpty }: SharedInputProps) {
  const { isStreaming, activeWorkspaceId } = useChatStore();
  const { data: workspaces } = useWorkspaces();
  const { language, t } = useI18n();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { 
    isRecording, 
    startRecording, 
    stopRecording, 
    amplitude,
    transcript,
    interimTranscript,
    status
  } = useVoiceRecording(language);
  const effectiveWorkspaceId = activeWorkspaceId || workspaces?.[0]?.id || null;
  const trimmedInput = input.trim();
  const canSend =
    isRecording ||
    (Boolean(trimmedInput || attachments.length > 0) &&
      !isStreaming &&
      !isPreparingAttachments &&
      Boolean(effectiveWorkspaceId));

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
  };

  useEffect(() => {
    if (!isRecording && (status === 'idle' || status === 'error') && transcript.trim()) {
      const fullText = (transcript + interimTranscript).trim();
      if (fullText) {
        setInput(prev => {
          const separator = prev && !prev.endsWith(' ') ? ' ' : '';
          return prev + separator + fullText;
        });
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 192)}px`;
          }
        }, 100);
      }
    }
  }, [isRecording, status, transcript, interimTranscript]);

  const handleSend = async () => {
    if ((!trimmedInput && attachments.length === 0) || isStreaming || !effectiveWorkspaceId || isPreparingAttachments) {
      return;
    }

    setIsPreparingAttachments(true);
    try {
      const serializedAttachments: ChatUploadAttachment[] = await Promise.all(
        attachments.map(async (attachment) => ({
          name: attachment.file.name,
          type: attachment.file.type || 'application/octet-stream',
          size: attachment.file.size,
          contentBase64: await readFileAsBase64(attachment.file),
        }))
      );

      const success = await useChatStore
        .getState()
        .submitPrompt(input, effectiveWorkspaceId, serializedAttachments);

      if (!success) {
        return;
      }

      setInput('');
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      const fileName = error instanceof Error ? error.message : 'file';
      alert(
        t('sharedInput.attachmentReadError', {
          name: fileName,
        })
      );
    } finally {
      setIsPreparingAttachments(false);
    }
  };

  const handleConfirmVoice = () => {
    stopRecording();
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 192)}px`;
        textareaRef.current.focus();
      }
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) {
      return;
    }

    setAttachments((current) => {
      const next = [...current];

      for (const file of selectedFiles) {
        if (next.length >= MAX_ATTACHMENTS) {
          alert(
            t('sharedInput.attachmentLimit', {
              count: MAX_ATTACHMENTS,
            })
          );
          break;
        }

        if (!isSupportedAttachment(file)) {
          alert(
            t('sharedInput.attachmentUnsupported', {
              name: file.name,
            })
          );
          continue;
        }

        if (file.size > MAX_ATTACHMENT_BYTES) {
          alert(
            t('sharedInput.attachmentTooLarge', {
              name: file.name,
              maxKb: Math.round(MAX_ATTACHMENT_BYTES / 1024),
            })
          );
          continue;
        }

        const duplicate = next.some(
          (attachment) =>
            attachment.file.name === file.name &&
            attachment.file.size === file.size &&
            attachment.file.lastModified === file.lastModified
        );
        if (duplicate) {
          continue;
        }

        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
        });
      }

      return next;
    });

    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  return (
    <div 
      id="input-wrapper" 
      className={cn(
        "absolute top-0 left-0 w-full h-full transition-all duration-500 ease-in-out flex flex-col z-20 px-4 pointer-events-none",
        isChatEmpty ? "justify-center" : "justify-end pb-6"
      )}
    >
      <div 
        id="welcome-text" 
        className={cn(
          "text-center mb-6 transition-all duration-500 overflow-hidden relative z-20",
          isChatEmpty ? "opacity-100 h-auto" : "opacity-0 h-0 scale-95"
        )}
      >
        <h1 className="text-2xl sm:text-3xl font-[800] tracking-tighter whitespace-nowrap text-gray-900 dark:text-white uppercase">{t('sharedInput.welcomeTitle')}</h1>
      </div>

      <div className="w-full max-w-3xl mx-auto relative shadow-2xl rounded-xl z-20 pointer-events-auto">
        <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl flex flex-col relative transition-colors duration-300 focus-within:border-gray-400 dark:focus-within:border-gray-500 overflow-hidden shadow-sm">
          {!isRecording ? (
            <textarea 
              id="prompt-input"
              ref={textareaRef}
              rows={1} 
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent border-none text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-none px-4 py-3.5 focus:ring-0 text-[0.95rem] leading-relaxed max-h-48 overflow-y-auto outline-none" 
              placeholder={t('sharedInput.placeholder')}
            ></textarea>
          ) : (
            <div id="audio-visualizer-container" className="w-full h-12 px-4 flex items-center justify-center">
              <VoiceVisualizer amplitude={amplitude} />
            </div>
          )}

          {attachments.length > 0 && (
            <div className="px-3 pt-1 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[0.78rem] text-gray-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300"
                >
                  <span className="truncate max-w-[220px]">{attachment.file.name}</span>
                  <span className="text-gray-400 dark:text-gray-500">
                    {formatAttachmentSize(attachment.file.size)}
                  </span>
                  <button
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    title={t('common.delete')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-1">
              <input type="file" id="file-upload" ref={fileInputRef} className="hidden" onChange={handleFileUpload} multiple />
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-graphite-hover rounded-lg transition-colors" 
                title={t('sharedInput.attachFile')}
              >
                <Paperclip className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button 
                id="mic-btn"
                onClick={() => isRecording ? stopRecording() : startRecording(handleConfirmVoice)}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-graphite-hover rounded-lg transition-colors relative" 
                title={t('sharedInput.voiceInput')}
              >
                <div id="mic-indicator" className="flex items-center justify-center w-5 h-5 rounded-full">
                  {isRecording ? <X id="mic-icon" className="w-5 h-5 transition-all text-gray-500" /> : <Mic id="mic-icon" className="w-5 h-5 transition-all" />}
                </div>
              </button>
              
              <button 
                id="send-btn"
                onClick={isRecording ? handleConfirmVoice : handleSend}
                disabled={!canSend}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-lg transition-all shadow-sm",
                  isRecording 
                    ? "bg-green-600 hover:bg-green-700 text-white" 
                    : "bg-[#2563eb] hover:bg-blue-700 text-white disabled:bg-gray-200 dark:disabled:bg-graphite-border disabled:text-gray-400 dark:disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100 active:scale-95"
                )}
              >
                <div id="send-icon-container">
                  {isRecording ? <Check className="w-5 h-5" /> : <ArrowUp className="w-5 h-5" />}
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div 
        id="bottom-bg" 
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-[#0a0a0a] dark:via-[#0a0a0a]/80 dark:to-transparent z-0 transition-opacity duration-1000 pointer-events-none",
          isChatEmpty ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}
