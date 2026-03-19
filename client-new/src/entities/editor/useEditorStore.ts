import { create } from 'zustand';
import type { EditorState } from './types';

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activePath: null,

  openTab: (path, name) => set((state) => {
    const exists = state.tabs.find((t) => t.path === path);
    if (exists) return { activePath: path };
    return {
      tabs: [...state.tabs, { path, name, isDirty: false }],
      activePath: path,
    };
  }),

  closeTab: (path) => set((state) => {
    const newTabs = state.tabs.filter((t) => t.path !== path);
    let newActive = state.activePath;
    if (state.activePath === path) {
      newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].path : null;
    }
    return {
      tabs: newTabs,
      activePath: newActive,
    };
  }),

  setActiveTab: (path) => set({ activePath: path }),

  setDirty: (path, isDirty) => set((state) => ({
    tabs: state.tabs.map((t) => 
      t.path === path ? { ...t, isDirty } : t
    ),
  })),
}));
