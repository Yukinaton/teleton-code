export type BlockType = 
  | 'clarification'
  | 'code'
  | 'decision'
  | 'findings'
  | 'markdown'
  | 'narrative' 
  | 'next_step'
  | 'terminal' 
  | 'diff' 
  | 'success' 
  | 'runnable_code' 
  | 'file_actions' 
  | 'files_inspected' 
  | 'execution_plan' 
  | 'permission' 
  | 'recovery'
  | 'error' 
  | 'app_preview'
  | 'summary' 
  | 'search_results'
  | 'validation';

export interface ChatBlock {
  id?: string;
  type: BlockType;
  taskId?: string | null;
  workspaceId?: string | null;
  recoveryAvailable?: boolean;
  content?: string;
  code?: string;
  file?: string;
  language?: string;
  status?: string;
  metadata?: any;
  // Additional fields for various blocks
  text?: string;
  command?: string;
  output?: string;
  exitCode?: number;
  title?: string;
  description?: string;
  steps?: string[];
  items?: string[];
  files?: Array<string | { name: string; status?: string }>;
  results?: Array<{ url?: string; title?: string; description?: string; text?: string; file?: string; snippet?: string }>;
}

export interface ChatAttachment {
  name: string;
  path?: string;
  size?: number;
  mimeType?: string;
}

export interface ChatUploadAttachment {
  name: string;
  type: string;
  size: number;
  contentBase64: string;
}

export interface TaskStep {
  id: string;
  toolCallId?: string;
  type: 'thought' | 'tool' | 'error' | 'success';
  title: string;
  thought?: string;
  status: 'running' | 'completed' | 'failed' | 'success' | 'waiting';
  durationMs?: number;
  timestamp: number;
}

export interface ChatTaskState {
  id: string;
  workspaceId?: string | null;
  taskEngine?: 'standard' | 'compatibility';
  agentLoopVersion?: number;
  status: string | null;
  mode: 'answer' | 'clarify' | 'inspect' | 'execute' | 'review' | 'recover' | null;
  phase: 'idle' | 'inspecting' | 'editing' | 'verifying' | 'awaiting_approval' | 'completed' | 'failed';
  currentAction?: string | null;
  resultSummary?: string | null;
  approvalScope?: 'shell' | 'destructive' | null;
  evidenceState?: 'none' | 'tool_confirmed' | 'verify_passed' | 'verify_failed' | 'claim_mismatch';
  verify?: {
    status?: string;
    reason?: string;
    tool?: string;
    command?: string;
  } | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  taskId?: string | null;
  taskState?: ChatTaskState | null;
  attachments?: ChatAttachment[];
  blocks?: ChatBlock[];
  isStreaming?: boolean;
  status?: string;
  steps?: TaskStep[];
}

export interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  setStreaming: (isStreaming: boolean) => void;
  setActiveWorkspace: (id: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string, blocks?: ChatBlock[]) => void;
  updateLastMessageStatus: (status: string) => void;
  addMessageStep: (step: TaskStep) => void;
  updateMessageStep: (stepId: string, updates: Partial<TaskStep>) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setActiveSession: (sessionId: string | null) => void;
}
