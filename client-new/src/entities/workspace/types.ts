export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: FileNode[];
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  status: 'idle' | 'running';
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  icon?: string;
  archived?: boolean;
  sessions?: Session[];
}
