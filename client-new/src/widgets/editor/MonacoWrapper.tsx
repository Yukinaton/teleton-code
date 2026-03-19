import { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { editorModelManager } from '../../entities/editor/model-manager';
import { useFileContent } from '../../entities/workspace/useWorkspaceQuery';
import { useEditorStore } from '../../entities/editor/useEditorStore';
import { useChatStore } from '../../entities/chat/useChatStore';

interface MonacoWrapperProps {
  path: string;
}

export function MonacoWrapper({ path }: MonacoWrapperProps) {
  const editorRef = useRef<any>(null);
  const activePath = useEditorStore((state) => state.activePath);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  
  const { data: fileData, isLoading } = useFileContent(activeWorkspaceId || '', path);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    if (editorRef.current && fileData && path === activePath) {
      const model = editorModelManager.getModel(path, fileData.content, fileData.language);
      editorRef.current.setModel(model);
    }
  }, [fileData, path, activePath]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 italic">
        Loading content...
      </div>
    );
  }

  if (!activeWorkspaceId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 italic">
        Select a project to load file content.
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      options={{
        fontSize: 14,
        minimap: { enabled: true },
        scrollbar: { vertical: 'visible', horizontal: 'visible' },
        automaticLayout: true,
        padding: { top: 10 },
        tabSize: 2,
        wordWrap: 'on'
      }}
      onMount={handleEditorDidMount}
    />
  );
}
