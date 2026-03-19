import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { FileNode, Workspace } from './types';

const API_BASE = '/api';

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/bootstrap`);
      const json = await res.json();
      const { workspaces, sessionsByWorkspace } = json.data;
      return workspaces.map((ws: Workspace) => ({
        ...ws,
        sessions: sessionsByWorkspace[ws.id] || []
      })) as Workspace[];
    },
  });
}

export function useRuntimeStatus() {
  return useQuery({
    queryKey: ['runtime-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/runtime/status`);
      const json = await res.json();
      return json.data as {
        loaded: boolean;
        webSearch?: {
          provider?: string;
          enabled?: boolean;
          configured?: boolean;
        };
      };
    },
  });
}

export function useWorkspaceFiles(workspaceId: string, path = '') {
  return useQuery({
    queryKey: ['workspace-files', workspaceId, path],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/files?path=${encodeURIComponent(path)}`);
      const json = await res.json();
      return json.data.entries as FileNode[];
    },
    enabled: !!workspaceId,
  });
}

export function useFileContent(workspaceId: string, path: string) {
  return useQuery({
    queryKey: ['file-content', workspaceId, path],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`);
      const json = await res.json();
      return json.data as { content: string; language: string };
    },
    enabled: !!workspaceId && !!path,
  });
}

export function useSaveFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, path, content }: { workspaceId: string; path: string; content: string }) => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/file`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['file-content', variables.workspaceId, variables.path] });
    },
  });
}
export function useArchivedWorkspaces() {
  return useQuery({
    queryKey: ['archived-workspaces'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/bootstrap`);
      const json = await res.json();
      const { archivedWorkspaces, sessionsByWorkspace } = json.data;
      return archivedWorkspaces.map((ws: Workspace) => ({
        ...ws,
        sessions: sessionsByWorkspace[ws.id] || []
      })) as Workspace[];
    },
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, icon }: { name: string; icon: string }) => {
      const res = await fetch(`${API_BASE}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-files'] });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, icon }: { id: string; name: string; icon: string }) => {
      const res = await fetch(`${API_BASE}/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetch(`${API_BASE}/workspaces/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}
export function useArchiveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetch(`${API_BASE}/workspaces/${id}/archive`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['archived-workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-files'] });
    },
  });
}
export function useRestoreWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetch(`${API_BASE}/workspaces/${id}/restore`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['archived-workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-files'] });
    },
  });
}
export function useCreateWorkspaceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, type, path }: { workspaceId: string; type: 'file' | 'folder'; path: string }) => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, path }),
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-files', variables.workspaceId] });
    },
  });
}

export function useDeleteWorkspaceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, path }: { workspaceId: string; path: string }) => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/items?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-files', variables.workspaceId] });
    },
  });
}

export function useRenameWorkspaceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, oldPath, newPath }: { workspaceId: string; oldPath: string; newPath: string }) => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-files', variables.workspaceId] });
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, title }: { workspaceId: string; title: string }) => {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await fetch(`${API_BASE}/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}
