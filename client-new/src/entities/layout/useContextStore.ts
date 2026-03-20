import { create } from 'zustand';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'project' | 'chat' | null;
  targetId: string | null;
  
  openMenu: (x: number, y: number, type: 'project' | 'chat', targetId: string) => void;
  closeMenu: (options?: { preserveTarget?: boolean }) => void;
  clearTarget: () => void;
}

export const useContextStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  x: 0,
  y: 0,
  type: null,
  targetId: null,

  openMenu: (x, y, type, targetId) => set({ isOpen: true, x, y, type, targetId }),
  closeMenu: (options) =>
    set((state) => ({
      isOpen: false,
      type: options?.preserveTarget ? state.type : null,
      targetId: options?.preserveTarget ? state.targetId : null,
    })),
  clearTarget: () => set({ type: null, targetId: null }),
}));
