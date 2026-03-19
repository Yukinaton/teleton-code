export interface EditorTab {
  path: string;
  name: string;
  isDirty?: boolean;
}

export interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  openTab: (path: string, name: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  setDirty: (path: string, isDirty: boolean) => void;
}
