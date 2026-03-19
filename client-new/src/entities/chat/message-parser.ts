import type { ChatBlock } from './types';

export function parseMessageBlocks(content: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  
  // Very basic regex-based parser for demonstration
  // In real IDE we'd use a more robust parser (marked or similar)
  
  // 1. Terminal blocks: ```bash ... ```
  const terminalRegex = /```(?:bash|sh|powershell|cmd)\n([\s\S]*?)```/g;
  let match;
  while ((match = terminalRegex.exec(content)) !== null) {
    blocks.push({
      id: Math.random().toString(36).substring(2, 9),
      type: 'terminal',
      content: match[1].trim(),
      language: 'bash'
    });
  }

  // 2. Diff blocks: ```diff ... ```
  const diffRegex = /```diff\n([\s\S]*?)```/g;
  while ((match = diffRegex.exec(content)) !== null) {
    blocks.push({
      id: Math.random().toString(36).substring(2, 9),
      type: 'diff',
      content: match[1].trim(),
    });
  }

  // 3. Simple narrative for the rest (simplified)
  if (blocks.length === 0) {
    blocks.push({
      id: 'root-narrative',
      type: 'narrative',
      content: content
    });
  }

  return blocks;
}
