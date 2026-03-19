import { useState } from 'react';
import { Send, Bot, User, StopCircle } from 'lucide-react';
import { useChatStore } from '../../entities/chat/useChatStore';
import { Button } from '../../shared/ui/Button';
import { cn } from '../../shared/utils/cn';

export function ChatPanel() {
  const { messages, isStreaming } = useChatStore();
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-[#1e293b]/50">
      <div className="p-4 font-bold border-b border-slate-700/50 flex items-center gap-2">
        <Bot size={18} className="text-sky-400" />
        <span>AI Assistant</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
             <Bot size={48} className="mb-4 opacity-20" />
             <p className="text-sm">Welcome to Teleton Code Next!</p>
             <p className="text-xs mt-1">Ask me anything about your project.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn(
              'flex gap-3 max-w-[90%]',
              msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
            )}>
              <div className={cn(
                'w-8 h-8 rounded flex items-center justify-center flex-shrink-0',
                msg.role === 'user' ? 'bg-sky-600' : 'bg-slate-700'
              )}>
                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className={cn(
                'p-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap',
                msg.role === 'user' ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-200'
              )}>
                {msg.content}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-slate-700/50 bg-[#0f172a]/50">
        <div className="relative">
          <textarea
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 resize-none custom-scrollbar"
            rows={3}
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="absolute right-2 bottom-2">
            {isStreaming ? (
              <Button variant="danger" size="icon" className="h-8 w-8 rounded-full">
                <StopCircle size={16} />
              </Button>
            ) : (
              <Button onClick={handleSend} variant="primary" size="icon" className="h-8 w-8 rounded-full shadow-lg shadow-sky-500/20">
                <Send size={16} />
              </Button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-slate-600 mt-2 text-center uppercase tracking-widest">Powered by Antigravity AI</p>
      </div>
    </div>
  );
}
