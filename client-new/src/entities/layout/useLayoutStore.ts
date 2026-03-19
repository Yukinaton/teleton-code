import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutState {
  sidebarOpen: boolean;
  activeModal: string | null;
  toast: { message: string; visible: boolean } | null;
  language: 'ru' | 'en';
  fullAccess: boolean;
  
  toggleSidebar: () => void;
  openModal: (id: string) => void;
  closeModal: () => void;
  showToast: (message: string) => void;
  setLanguage: (language: 'ru' | 'en') => void;
  setFullAccess: (fullAccess: boolean) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  previewCode: string | null;
  setPreviewCode: (code: string | null) => void;
  previewUrl: string | null;
  setPreviewUrl: (url: string | null) => void;
  previewBaseUrl: string | null;
  setPreviewBaseUrl: (url: string | null) => void;
  previewMaximized: boolean;
  setPreviewMaximized: (maximized: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      activeModal: null,
      toast: null,
      language: 'en',
      fullAccess: false,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      
      openModal: (id) => set({ activeModal: id }),
      
      closeModal: () => set({ activeModal: null, previewCode: null, previewUrl: null, previewMaximized: false }),
      
      showToast: (message) => {
        set({ toast: { message, visible: true } });
        setTimeout(() => {
          set({ toast: null });
        }, 3000);
      },

      setLanguage: (language) => {
        set({ language });
        document.documentElement.lang = language;
      },

      setFullAccess: (fullAccess) => set({ fullAccess }),
      
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.classList.toggle('light', theme === 'light');
      },
      previewCode: null,
      setPreviewCode: (code) => set({ previewCode: code }),
      previewUrl: null,
      setPreviewUrl: (url) => set({ previewUrl: url }),
      previewBaseUrl: null,
      setPreviewBaseUrl: (url) => set({ previewBaseUrl: url }),
      previewMaximized: false,
      setPreviewMaximized: (maximized) => set({ previewMaximized: maximized }),
    }),
    {
      name: 'teleton-layout-storage',
      version: 3,
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        activeModal: null,
        toast: null,
        language: state.language,
        fullAccess: state.fullAccess,
        theme: state.theme,
        previewCode: null,
        previewUrl: null,
        previewBaseUrl: null,
        previewMaximized: state.previewMaximized,
      }),
      migrate: (persistedState: any) => ({
        sidebarOpen: persistedState?.sidebarOpen ?? true,
        activeModal: null,
        toast: null,
        language: persistedState?.language === 'ru' ? 'ru' : 'en',
        fullAccess: Boolean(persistedState?.fullAccess),
        theme: persistedState?.theme === 'light' ? 'light' : 'dark',
        previewCode: null,
        previewUrl: null,
        previewBaseUrl: null,
        previewMaximized: Boolean(persistedState?.previewMaximized),
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.className = state.theme;
        }
        if (state?.language) {
          document.documentElement.lang = state.language;
        }
      }
    }
  )
);
