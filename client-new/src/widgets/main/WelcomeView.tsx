import { useRef, useState } from 'react';
import { Paperclip, Mic, ArrowUp, X, Check } from 'lucide-react';
import { useChatStore } from '../../entities/chat/useChatStore';
import { useVoiceRecording } from '../../features/voice-input/useVoiceRecording';
import { VoiceVisualizer } from '../../features/voice-input/VoiceVisualizer';
import { cn } from '../../shared/utils/cn';
import { useI18n } from '../../shared/i18n/useI18n';

export function WelcomeView() {
  const { addMessage } = useChatStore();
  const { language, t } = useI18n();
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const { isRecording, startRecording, stopRecording, amplitude } = useVoiceRecording(language);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleSend = () => {
    if (!input.trim()) return;
    
    addMessage({
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: input,
      timestamp: Date.now()
    });
  };

  const handleConfirmVoice = () => {
    stopRecording();
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        textareaRef.current.focus();
      }
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div id="input-wrapper" className="absolute left-0 w-full transition-all duration-500 ease-in-out flex flex-col justify-center z-20 top-1/2 -translate-y-1/2 px-4 font-sans">
      <div id="welcome-text" className="text-center mb-6 transition-all duration-500 overflow-hidden relative z-20">
        <h1 className="text-2xl sm:text-3xl font-[800] tracking-tighter whitespace-nowrap text-gray-900 dark:text-white">{t('sharedInput.welcomeTitle')}</h1>
      </div>

      <div className="w-full max-w-3xl mx-auto relative shadow-2xl rounded-xl z-20">
        <div className="bg-white dark:bg-graphite-card border border-gray-200 dark:border-graphite-border rounded-xl flex flex-col relative transition-colors duration-300 focus-within:border-gray-400 dark:focus-within:border-gray-500 overflow-hidden shadow-sm">
          {!isRecording ? (
            <textarea 
              ref={textareaRef}
              rows={1} 
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent border-none text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-none px-4 py-3.5 focus:ring-0 text-[0.95rem] leading-relaxed max-h-48 overflow-y-auto outline-none" 
              placeholder={t('sharedInput.placeholder')}
            ></textarea>
          ) : (
            <div className="w-full h-12 flex items-center justify-center px-4">
              <VoiceVisualizer amplitude={amplitude} />
            </div>
          )}
          
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-1">
              <button 
                onClick={() => isRecording ? stopRecording() : null}
                className={cn(
                  "p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-graphite-hover rounded-lg transition-colors",
                  isRecording && "text-red-500 bg-red-50 dark:bg-red-900/10"
                )} 
                title={isRecording ? t('common.cancel') : t('sharedInput.attachFile')}
              >
                {isRecording ? <X className="w-5 h-5" /> : <Paperclip className="w-5 h-5" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {!isRecording ? (
                <button 
                  onClick={() => startRecording()}
                  className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-graphite-hover rounded-lg transition-colors relative" 
                  title={t('sharedInput.voiceInput')}
                >
                  <Mic className="w-5 h-5 transition-all" />
                </button>
              ) : null}
              
              <button 
                onClick={isRecording ? handleConfirmVoice : handleSend}
                disabled={!isRecording && !input.trim()}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-lg transition-colors shadow-sm text-white transition-colors duration-300",
                  isRecording ? "bg-green-600 hover:bg-green-700" : "bg-primary-600 hover:bg-primary-700",
                  !isRecording && !input.trim() && "opacity-50 cursor-not-allowed"
                )}
              >
                {isRecording ? <Check className="w-5 h-5" /> : <ArrowUp className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
