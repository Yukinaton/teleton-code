import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface FileState {
  expandedFolders: Set<string>;
  selectedPath: string | null;
  selectedType: 'file' | 'dir' | null;
  
  toggleFolder: (path: string) => void;
  setSelectedPath: (path: string | null, type?: 'file' | 'dir' | null) => void;
  setExpandedFolders: (folders: Set<string>) => void;
  reset: () => void;
}

export const useFileStore = create<FileState>()(
  persist(
    (set) => ({
      expandedFolders: new Set<string>(),
      selectedPath: null,
      selectedType: null,

      toggleFolder: (path) => set((state) => {
        const next = new Set(state.expandedFolders);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return { expandedFolders: next };
      }),

      setSelectedPath: (path, type = null) => set({ selectedPath: path, selectedType: type }),
      
      setExpandedFolders: (folders) => set({ expandedFolders: folders }),

      reset: () => set({ selectedPath: null, selectedType: null }),
    }),
    {
      name: 'teleton-file-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist expandedFolders
      partialize: (state) => ({ 
        expandedFolders: Array.from(state.expandedFolders) 
      }) as any,
      // Map back to Set on rehydration
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.expandedFolders)) {
          state.expandedFolders = new Set(state.expandedFolders);
        }
      },
    }
  )
);
