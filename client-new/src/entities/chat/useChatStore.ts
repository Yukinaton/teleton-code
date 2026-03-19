import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatState, ChatUploadAttachment } from './types';
import { useLayoutStore } from '../layout/useLayoutStore';
import { translate } from '../../shared/i18n/translations';
import { queryClient } from '../../app/providers/queryClient';

interface ExtendedChatState extends ChatState {
  submitPrompt: (prompt: string, workspaceId: string, attachments?: ChatUploadAttachment[]) => Promise<boolean>;
  fetchMessages: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  saveEditedCode: (messageId: string, oldCode: string, newCode: string) => void;
  updateLastMessageSteps: (steps: import('./types').TaskStep[]) => void;
}

export const useChatStore = create<ExtendedChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isStreaming: false,
      activeSessionId: null,
      activeWorkspaceId: null,

      setStreaming: (isStreaming) => set({ isStreaming }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      addMessage: (msg) => set((state) => ({
        messages: [...state.messages, msg],
      })),

      updateLastMessage: (content, blocks) => set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (!last || last.role !== 'agent') return state;
        
        const newMessages = [...state.messages];
        newMessages[newMessages.length - 1] = {
          ...last,
          content,
          blocks: blocks || last.blocks,
        };
        
        return { messages: newMessages };
      }),

      updateLastMessageStatus: (status) => set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (!last || last.role !== 'agent') return state;
        
        const newMessages = [...state.messages];
        newMessages[newMessages.length - 1] = { ...last, status };
        return { messages: newMessages };
      }),

      updateLastMessageSteps: (steps: import('./types').TaskStep[]) => set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (!last || last.role !== 'agent') return state;
        
        const newMessages = [...state.messages];
        newMessages[newMessages.length - 1] = { ...last, steps };
        return { messages: newMessages };
      }),

      addMessageStep: (_step) => set((state) => state),
      updateMessageStep: (_stepId, _updates) => set((state) => state),

      setMessages: (messages) => set({ messages }),

      setActiveSession: (sessionId) => {
        if (!sessionId) {
          set({ activeSessionId: null, messages: [] });
        } else {
          set((state) => ({
            activeSessionId: sessionId,
            messages: state.activeSessionId === sessionId ? state.messages : [],
          }));
        }
      },

      fetchMessages: async (sessionId) => {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/messages`);
          const data = await res.json();
          if (data.success && data.data && data.data.messages) {
            set({ 
              messages: data.data.messages.map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.text || m.content,
                timestamp: m.createdAt ? new Date(m.createdAt).getTime() : m.timestamp,
                attachments: m.attachments || [],
                blocks: m.blocks || []
              }))
            });
          }
        } catch (error) {
          console.error('Failed to fetch messages:', error);
        }
      },

      selectSession: async (sessionId) => {
        set({ activeSessionId: sessionId, messages: [] });
        const { fetchMessages } = get();
        await fetchMessages(sessionId);
      },

      submitPrompt: async (prompt, workspaceId, attachments = []) => {
        const state = get();
        const layoutState = useLayoutStore.getState();
        if (state.isStreaming) return false;

        set({ isStreaming: true });
        let optimisticUserMessageId: string | null = null;

        try {
          const actualWorkspaceId = workspaceId || state.activeWorkspaceId;
          let sessionId = state.activeSessionId;
          if (!actualWorkspaceId) {
            throw new Error('No active project selected');
          }

          if (state.activeWorkspaceId !== actualWorkspaceId) {
            set({ activeWorkspaceId: actualWorkspaceId });
          }

          if (!sessionId) {
            const res = await fetch(`/api/workspaces/${actualWorkspaceId}/sessions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: prompt.substring(0, 30) })
            });
            const data = await res.json();
            sessionId = data.data?.activeSessionId || data.data?.id;
            if (sessionId) set({ activeWorkspaceId: actualWorkspaceId, activeSessionId: sessionId });
          }

          const activeId = get().activeSessionId;
          if (!activeId) throw new Error('Failed to establish session');

          optimisticUserMessageId = Math.random().toString(36).substring(7);
          const optimisticUserContent =
            prompt.trim() ||
            translate(layoutState.language, 'sharedInput.attachmentsOnly', {
              count: attachments.length,
            });

          state.addMessage({
            id: optimisticUserMessageId,
            role: 'user',
            content: optimisticUserContent,
            timestamp: Date.now(),
            attachments: attachments.map((attachment) => ({
              name: attachment.name,
              size: attachment.size,
              mimeType: attachment.type,
            })),
          });

          const msgRes = await fetch(`/api/sessions/${activeId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: prompt,
              attachments,
              settings: {
                fullAccess: layoutState.fullAccess,
                language: layoutState.language,
              }
            })
          });
          const msgData = await msgRes.json();
          if (!msgRes.ok || !msgData?.success) {
            throw new Error(msgData?.error || 'Failed to send message');
          }
          const taskId = msgData.data.task.id;
          const initialAssistantMessage = msgData.data.assistantMessage;
          const persistedUserMessage = msgData.data.userMessage;

          if (persistedUserMessage) {
            set((s) => {
              const newMessages = [...s.messages];
              const idx = newMessages.findLastIndex((m) => m.id === optimisticUserMessageId);
              if (idx !== -1) {
                newMessages[idx] = {
                  ...newMessages[idx],
                  id: persistedUserMessage.id,
                  content: persistedUserMessage.text || persistedUserMessage.content || optimisticUserContent,
                  attachments: persistedUserMessage.attachments || newMessages[idx].attachments || [],
                  timestamp: persistedUserMessage.createdAt
                    ? new Date(persistedUserMessage.createdAt).getTime()
                    : newMessages[idx].timestamp,
                };
              }
              return { messages: newMessages };
            });
          }

          const assistantMsgId = Math.random().toString(36).substring(7);
          state.addMessage({
            id: assistantMsgId,
            role: 'agent',
            content: initialAssistantMessage?.text || '',
            timestamp: Date.now(),
            blocks: initialAssistantMessage?.blocks || [],
            steps: [],
            isStreaming: initialAssistantMessage ? false : true,
            status: initialAssistantMessage ? undefined : translate(layoutState.language, 'chat.runningStep')
          });

          const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);

          eventSource.addEventListener('task.snapshot', (event: any) => {
            const data = JSON.parse(event.data);
            const task = data.task;
            const snapshotMessages = Array.isArray(data.messages) ? data.messages : [];
            const latestAgentMessage = [...snapshotMessages]
              .reverse()
              .find((message: any) => message.role === 'agent');

            if (!latestAgentMessage) {
              set({ isStreaming: task?.status === 'running' });
              return;
            }

            set((s) => {
              const newMessages = [...s.messages];
              const idx = newMessages.findLastIndex((m) => m.role === 'agent');
              if (idx !== -1) {
                newMessages[idx] = {
                  ...newMessages[idx],
                  content: latestAgentMessage.text || latestAgentMessage.content || '',
                  blocks: latestAgentMessage.blocks || [],
                  isStreaming: task?.status === 'running',
                  status: task?.status === 'running' ? newMessages[idx].status : undefined,
                  steps: task?.steps || newMessages[idx].steps,
                };
              }
              return {
                messages: newMessages,
                isStreaming: task?.status === 'running',
              };
            });
          });
          
          eventSource.addEventListener('task.step', (event: any) => {
            const data = JSON.parse(event.data);
            const task = data.task;
            if (task.status) {
              get().updateLastMessageStatus(task.status);
            }
            if (task.steps) {
              (get() as any).updateLastMessageSteps(task.steps);
            }
          });

          eventSource.addEventListener('task.completed', (event: any) => {
            const data = JSON.parse(event.data);
            const agentMsg = data.assistantMessage;
            
            queryClient.invalidateQueries({ queryKey: ['workspace-files'] });
            
            set((s) => {
              const newMessages = [...s.messages];
              const idx = newMessages.findLastIndex(m => m.role === 'agent');
              if (idx !== -1) {
                newMessages[idx] = {
                  ...newMessages[idx],
                  content: agentMsg.text,
                  blocks: agentMsg.blocks,
                  isStreaming: false,
                  status: undefined,
                  steps: data.task?.steps || newMessages[idx].steps,
                };
              }
              return { messages: newMessages, isStreaming: false };
            });
            eventSource.close();
          });

          eventSource.addEventListener('task.awaiting_approval', (event: any) => {
            const data = JSON.parse(event.data);
            const agentMsg = data.assistantMessage;

            set((s) => {
              const newMessages = [...s.messages];
              const idx = newMessages.findLastIndex(m => m.role === 'agent');
              if (idx !== -1 && agentMsg) {
                newMessages[idx] = {
                  ...newMessages[idx],
                  content: agentMsg.text,
                  blocks: agentMsg.blocks,
                  isStreaming: false,
                  status: undefined,
                  steps: data.task?.steps || newMessages[idx].steps,
                };
              }
              return { messages: newMessages, isStreaming: false };
            });
          });

          eventSource.addEventListener('task.failed', (event: any) => {
            const data = JSON.parse(event.data);
            const agentMsg = data.assistantMessage;
            if (agentMsg) {
              set((s) => {
                const newMessages = [...s.messages];
                const idx = newMessages.findLastIndex(m => m.role === 'agent');
                if (idx !== -1) {
                  newMessages[idx] = {
                    ...newMessages[idx],
                    content: agentMsg.text,
                    blocks: agentMsg.blocks,
                    isStreaming: false,
                    status: undefined,
                    steps: data.task?.steps || newMessages[idx].steps,
                  };
                }
                return { messages: newMessages, isStreaming: false };
              });
            } else {
              state.updateLastMessage(data.error || 'Task failed');
              set({ isStreaming: false });
            }
            eventSource.close();
          });

          eventSource.onerror = () => {
            console.error('SSE Connection Error');
            set({ isStreaming: false });
            eventSource.close();
          };

          return true;
        } catch (error) {
          console.error('[Chat] Submit error:', error);
          if (optimisticUserMessageId) {
            set((s) => ({
              messages: s.messages.filter((message) => message.id !== optimisticUserMessageId),
            }));
          }
          alert(
            translate(layoutState.language, 'toast.messageSendError', {
              message: error instanceof Error ? error.message : String(error),
            })
          );
          set({ isStreaming: false });
          return false;
        }
      },

      saveEditedCode: (messageId, oldCode, newCode) => set((state) => {
        const newMessages = state.messages.map(msg => {
          if (msg.id === messageId) {
            const updatedContent = msg.content.replace(oldCode, newCode);
            
            const updatedBlocks = msg.blocks?.map(block => {
              const b = block as any;
              if (b.type === 'runnable_code' && b.code === oldCode) {
                return { ...b, code: newCode };
              }
              if (b.type === 'file_actions' && (b.code === oldCode || b.content === oldCode)) {
                return { ...b, code: newCode, content: newCode };
              }
              return b;
            });

            return { ...msg, content: updatedContent, blocks: updatedBlocks };
          }
          return msg;
        });
        return { messages: newMessages };
      }),
    }),
    {
      name: 'teleton-chat-storage',
      version: 2,
      partialize: (state) => ({
        activeSessionId: state.activeSessionId,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
      migrate: (persistedState: any) => ({
        activeSessionId: persistedState?.activeSessionId ?? null,
        activeWorkspaceId: persistedState?.activeWorkspaceId ?? null,
      }),
    }
  )
);
