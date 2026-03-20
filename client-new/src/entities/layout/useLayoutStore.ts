import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RuntimePreference {
  language: 'ru' | 'en';
  fullAccess: boolean;
}

interface LayoutState {
  sidebarOpen: boolean;
  activeModal: string | null;
  toast: { message: string; visible: boolean } | null;
  language: 'ru' | 'en';
  fullAccess: boolean;
  instanceKey: string | null;
  runtimePreferences: Record<string, RuntimePreference>;
  
  toggleSidebar: () => void;
  openModal: (id: string) => void;
  closeModal: () => void;
  showToast: (message: string) => void;
  setLanguage: (language: 'ru' | 'en') => void;
  setFullAccess: (fullAccess: boolean) => void;
  syncRuntimeDefaults: (instanceKey: string) => void;
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
      instanceKey: null,
      runtimePreferences: {},

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
        document.documentElement.lang = language;
        set((state) => ({
          language,
          runtimePreferences: state.instanceKey
            ? {
                ...state.runtimePreferences,
                [state.instanceKey]: {
                  language,
                  fullAccess: state.fullAccess,
                },
              }
            : state.runtimePreferences,
        }));
      },

      setFullAccess: (fullAccess) =>
        set((state) => ({
          fullAccess,
          runtimePreferences: state.instanceKey
            ? {
                ...state.runtimePreferences,
                [state.instanceKey]: {
                  language: state.language,
                  fullAccess,
                },
              }
            : state.runtimePreferences,
        })),

      syncRuntimeDefaults: (instanceKey) => {
        set((state) => {
          const runtimePreference = state.runtimePreferences[instanceKey];
          const language = runtimePreference?.language === 'ru' ? 'ru' : 'en';
          const fullAccess = runtimePreference?.fullAccess === true;

          document.documentElement.lang = language;

          if (
            state.instanceKey === instanceKey &&
            state.language === language &&
            state.fullAccess === fullAccess
          ) {
            return {};
          }

          return {
            instanceKey,
            language,
            fullAccess,
          };
        });
      },
      
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
      version: 6,
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        activeModal: null,
        toast: null,
        language: state.language,
        fullAccess: state.fullAccess,
        instanceKey: state.instanceKey,
        runtimePreferences: state.runtimePreferences,
        theme: state.theme,
        previewCode: null,
        previewUrl: null,
        previewBaseUrl: null,
        previewMaximized: state.previewMaximized,
      }),
      migrate: (persistedState: any, version) => ({
        sidebarOpen: persistedState?.sidebarOpen ?? true,
        activeModal: null,
        toast: null,
        language: 'en',
        fullAccess: false,
        instanceKey: typeof persistedState?.instanceKey === 'string' ? persistedState.instanceKey : null,
        runtimePreferences:
          version >= 6 && persistedState?.runtimePreferences && typeof persistedState.runtimePreferences === 'object'
            ? persistedState.runtimePreferences
            : typeof persistedState?.instanceKey === 'string'
              ? {
                  [persistedState.instanceKey]: {
                    language: persistedState?.language === 'ru' ? 'ru' : 'en',
                    fullAccess: Boolean(persistedState?.fullAccess),
                  },
                }
              : {},
        theme: persistedState?.theme === 'light' ? 'light' as const : 'dark' as const,
        previewCode: null,
        previewUrl: null,
        previewBaseUrl: null,
        previewMaximized: Boolean(persistedState?.previewMaximized),
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.className = state.theme;
        }
        document.documentElement.lang = 'en';
      }
    }
  )
);
