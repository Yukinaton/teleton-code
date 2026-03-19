import * as monaco from 'monaco-editor';
import { useEditorStore } from './useEditorStore';

class ModelManager {
  private models: Map<string, monaco.editor.ITextModel> = new Map();

  getModel(path: string, content: string, language?: string): monaco.editor.ITextModel {
    if (this.models.has(path)) {
      return this.models.get(path)!;
    }

    const uri = monaco.Uri.file(path);
    const model = monaco.editor.createModel(content, language, uri);
    
    model.onDidChangeContent(() => {
      useEditorStore.getState().setDirty(path, true);
    });

    this.models.set(path, model);
    return model;
  }

  disposeModel(path: string) {
    const model = this.models.get(path);
    if (model) {
      model.dispose();
      this.models.delete(path);
    }
  }

  getContent(path: string): string | null {
    return this.models.get(path)?.getValue() || null;
  }
}

export const editorModelManager = new ModelManager();
