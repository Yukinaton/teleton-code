import { repairMojibake } from '../../shared/utils/text';
import type { ChatTaskState } from '../../entities/chat/types';

export interface MessagePart {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

export function formatAttachmentSize(bytes?: number) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function extractStepFileHint(step: any) {
  const params = step?.params || {};
  const candidates = [
    params.path,
    params.targetPath,
    params.targetFile,
    params.file,
    step?.thought,
    step?.title,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;
    const match = normalized.match(/([A-Za-z0-9_./-]+\.(?:html?|css|js|jsx|ts|tsx|json|md|txt))/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return '';
}

function buildStepIdentity(step: any) {
  if (step?.toolCallId) {
    return `tool:${step.toolCallId}`;
  }

  const params = step?.params || {};
  const path = params.path || params.targetPath || params.targetFile || params.file || '';
  const command = params.command || '';
  const fileHint = extractStepFileHint(step);

  if (step?.type === 'planning') {
    if (['structured_plan', 'structured_bundle', 'structured_dom_repair'].includes(step?.name)) {
      return `planning:${step.name}`;
    }
    return `planning:${step?.name || step?.title || 'step'}:${fileHint}`;
  }

  return `step:${step?.type || 'unknown'}:${step?.name || step?.title || 'step'}:${path || command || fileHint}`;
}

export function inferPreviewBlockType(path: string): 'markdown' | 'code' | 'runnable_code' {
  const normalized = String(path || '').toLowerCase();
  if (normalized.endsWith('.md') || normalized.endsWith('.txt')) {
    return 'markdown';
  }
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'runnable_code';
  }
  return 'code';
}

export function inferSnippetBlockType(language: string | undefined, content: string): 'markdown' | 'code' | 'runnable_code' {
  const normalizedLanguage = String(language || '').toLowerCase();
  const source = String(content || '').trim().toLowerCase();

  if (['md', 'markdown', 'txt', 'text'].includes(normalizedLanguage)) {
    return 'markdown';
  }

  if (['html', 'htm'].includes(normalizedLanguage)) {
    return 'runnable_code';
  }

  if (normalizedLanguage) {
    return 'code';
  }

  if (/^<!doctype html>|^<html\b|^<head\b|^<body\b|^<main\b|^<div\b/i.test(source)) {
    return 'runnable_code';
  }

  if (/^#|\n#|\n##|\n- |\n\* /.test(source)) {
    return 'markdown';
  }

  return 'code';
}

export function inferSnippetFileName(language: string | undefined, content: string) {
  const blockType = inferSnippetBlockType(language, content);
  if (blockType === 'runnable_code') {
    return 'snippet.html';
  }
  if (blockType === 'markdown') {
    return 'snippet.md';
  }
  return language ? `snippet.${language}` : 'snippet.js';
}

function looksLikeBrokenText(value: string) {
  return /(?:Р.|С.|Ѓ|Ќ|љ|ў|џ){3,}/.test(String(value || '')) || repairMojibake(value) !== String(value || '');
}

function deriveStepCopy(step: any, language: 'ru' | 'en') {
  const params = step?.params || {};
  const path = params.path || params.targetPath || params.targetFile || '';
  const fileName = String(path || '').split(/[\\/]/).pop() || '';
  const command = params.command || '';

  const fallback = {
    code_list_files: {
      ru: { title: 'Обзор проекта', thought: 'Проверяю структуру файлов и каталогов.' },
      en: { title: 'Project overview', thought: 'Reviewing the workspace structure first.' },
    },
    code_read_file: {
      ru: { title: 'Чтение файла', thought: `Открываю ${fileName || 'файл'}, чтобы понять текущую реализацию.` },
      en: { title: 'Reading file', thought: `Opening ${fileName || 'the file'} to inspect the current implementation.` },
    },
    code_inspect_project: {
      ru: { title: 'Анализ проекта', thought: 'Собираю контекст по проекту перед следующими действиями.' },
      en: { title: 'Project analysis', thought: 'Gathering project context before the next changes.' },
    },
    code_search_context: {
      ru: { title: 'Поиск контекста', thought: 'Ищу связанные места в коде и похожие реализации.' },
      en: { title: 'Searching context', thought: 'Looking for related code paths and similar implementations.' },
    },
    code_write_file: {
      ru: { title: 'Создание файла', thought: `Записываю ${fileName || 'новый файл'} с нужной логикой.` },
      en: { title: 'Creating file', thought: `Writing ${fileName || 'a new file'} with the required logic.` },
    },
    code_write_file_lines: {
      ru: { title: 'Запись файла', thought: `Формирую содержимое ${fileName || 'файла'} построчно.` },
      en: { title: 'Writing file', thought: `Building ${fileName || 'the file'} line by line.` },
    },
    code_write_json: {
      ru: { title: 'Запись JSON', thought: `Обновляю ${fileName || 'JSON-файл'} структурированными данными.` },
      en: { title: 'Writing JSON', thought: `Updating ${fileName || 'the JSON file'} with structured data.` },
    },
    code_patch_file: {
      ru: { title: 'Правка кода', thought: `Вношу точечные изменения в ${fileName || 'файл'}.` },
      en: { title: 'Updating code', thought: `Applying a targeted patch to ${fileName || 'the file'}.` },
    },
    code_make_dirs: {
      ru: { title: 'Создание каталогов', thought: 'Подготавливаю структуру каталогов для следующего шага.' },
      en: { title: 'Creating directories', thought: 'Preparing the folder structure for the next step.' },
    },
    code_run_command: {
      ru: { title: 'Запуск команды', thought: `Выполняю ${command || 'команду'} для проверки результата.` },
      en: { title: 'Running command', thought: `Executing ${command || 'a command'} to validate the result.` },
    },
    code_install_dependencies: {
      ru: { title: 'Установка зависимостей', thought: 'Добавляю или обновляю пакеты проекта.' },
      en: { title: 'Installing dependencies', thought: 'Adding or updating project packages.' },
    },
    code_delete_path: {
      ru: { title: 'Удаление пути', thought: `Удаляю ${fileName || 'файл или папку'} в рамках задачи.` },
      en: { title: 'Deleting path', thought: `Removing ${fileName || 'a file or folder'} as part of the task.` },
    },
    code_move_path: {
      ru: { title: 'Перемещение пути', thought: `Перемещаю или переименовываю ${fileName || 'элемент проекта'}.` },
      en: { title: 'Moving path', thought: `Moving or renaming ${fileName || 'a project item'}.` },
    },
    code_git_diff: {
      ru: { title: 'Просмотр diff', thought: 'Проверяю получившийся патч после изменений.' },
      en: { title: 'Reviewing diff', thought: 'Inspecting the resulting patch after changes.' },
    },
  } as Record<string, Record<'ru' | 'en', { title: string; thought: string }>>;

  return fallback[step?.name]?.[language] || {
    title:
      language === 'ru'
        ? String(step?.name || '')
            .replace(/^code_/, '')
            .split('_')
            .filter(Boolean)
            .join(' ')
        : String(step?.name || '')
            .replace(/^code_/, '')
            .split('_')
            .filter(Boolean)
            .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' '),
    thought: language === 'ru' ? 'Выполняю рабочий шаг по задаче.' : 'Executing the next task step.',
  };
}

function humanizeStepTitle(step: any, language: 'ru' | 'en') {
  if (step?.title && !looksLikeBrokenText(step.title)) return step.title;
  if (!step?.name) return '';
  return deriveStepCopy(step, language).title;
}

export function normalizeTaskSteps(steps: any[] = [], language: 'ru' | 'en') {
  const latestApprovalResolutionIndex = steps.findLastIndex(
    (step) =>
      step?.type === 'permission_decision' &&
      ['accept', 'accept_all', 'reject', 'reject_all'].includes(String(step?.decision || '').toLowerCase())
  );

  const normalizedSteps = steps
    .filter((step, index) => {
      if (['permission_request', 'permission_decision'].includes(step?.type)) {
        return false;
      }

      if (
        step?.type === 'tool_finished' &&
        step?.result?.requiresPermission === true &&
        latestApprovalResolutionIndex > index
      ) {
        return false;
      }

      return true;
    })
    .map((step) => {
      const fallback = deriveStepCopy(step, language);
      const title = humanizeStepTitle(step, language);
      const thought =
        step?.thought && !looksLikeBrokenText(step.thought)
          ? step.thought
          : fallback.thought;
      const status =
        step?.status ||
        (step?.type === 'tool_started'
          ? 'running'
          : step?.type === 'tool_finished'
            ? (step?.result?.success === false ? 'failed' : 'completed')
            : 'running');

      return {
        ...step,
        title,
        thought,
        status,
        _identity: buildStepIdentity(step),
      };
    })
    .filter((step) => step.title || (step.thought && String(step.thought).trim().length > 0));

  const mergedSteps: any[] = [];
  const positions = new Map<string, number>();

  for (const step of normalizedSteps) {
    const identity = step._identity;
    if (!identity) {
      mergedSteps.push(step);
      continue;
    }

    const existingIndex = positions.get(identity);
    if (existingIndex === undefined) {
      positions.set(identity, mergedSteps.length);
      mergedSteps.push(step);
      continue;
    }

    mergedSteps[existingIndex] = {
      ...mergedSteps[existingIndex],
      ...step,
      _identity: identity,
    };
  }

  return mergedSteps.map(({ _identity, ...step }) => step);
}

export function stepStatusLabel(status: string, language: 'ru' | 'en') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'success') {
    return language === 'ru' ? 'готово' : 'done';
  }
  if (normalized === 'failed') {
    return language === 'ru' ? 'ошибка' : 'failed';
  }
  if (normalized === 'waiting') {
    return language === 'ru' ? 'ожидание' : 'waiting';
  }
  return language === 'ru' ? 'в работе' : 'running';
}

export function buildStepFeedSummary(steps: any[] = [], language: 'ru' | 'en') {
  const total = steps.length;
  const completed = steps.filter((step) => ['completed', 'success'].includes(step.status)).length;
  const failed = steps.filter((step) => step.status === 'failed').length;
  const running = steps.filter((step) => step.status === 'running').length;
  const waiting = steps.filter((step) => step.status === 'waiting').length;
  const latest = [...steps].reverse().find((step) => step.status === 'running') || steps[steps.length - 1] || null;

  return {
    headline: failed > 0
      ? (language === 'ru' ? 'Нужна проверка шага' : 'A step needs attention')
      : running > 0
        ? (language === 'ru' ? 'Агент работает над задачей' : 'The agent is working on the task')
        : waiting > 0
          ? (language === 'ru' ? 'Ожидается следующее действие' : 'Waiting for the next action')
          : (language === 'ru' ? 'Шаги по задаче выполнены' : 'Task steps completed'),
    counter: language === 'ru'
      ? `${completed} из ${total} шагов завершено`
      : `${completed} of ${total} steps completed`,
    detailCta: language === 'ru' ? 'Открыть шаги' : 'Open steps',
    latest,
  };
}

export function taskPhaseHeadline(taskState: ChatTaskState | null | undefined, language: 'ru' | 'en') {
  const phase = taskState?.phase || 'idle';
  const map = {
    idle: language === 'ru' ? 'Готов к следующему шагу' : 'Ready for the next step',
    inspecting: language === 'ru' ? 'Изучаю проект' : 'Inspecting the project',
    editing: language === 'ru' ? 'Вношу изменения' : 'Applying changes',
    verifying: language === 'ru' ? 'Проверяю результат' : 'Verifying the result',
    awaiting_approval: language === 'ru' ? 'Нужно разрешение' : 'Approval required',
    completed: language === 'ru' ? 'Задача завершена' : 'Task completed',
    failed: language === 'ru' ? 'Нужна корректировка' : 'Task needs attention',
  } as const;

  return map[phase as keyof typeof map] || (language === 'ru' ? 'Рабочий цикл агента' : 'Agent task state');
}

export function taskPhaseBadge(taskState: ChatTaskState | null | undefined, language: 'ru' | 'en') {
  const phase = taskState?.phase || 'idle';
  const map = {
    idle: language === 'ru' ? 'ожидание' : 'idle',
    inspecting: language === 'ru' ? 'анализ' : 'inspect',
    editing: language === 'ru' ? 'изменения' : 'execute',
    verifying: language === 'ru' ? 'проверка' : 'verify',
    awaiting_approval: language === 'ru' ? 'разрешение' : 'approval',
    completed: language === 'ru' ? 'готово' : 'done',
    failed: language === 'ru' ? 'ошибка' : 'failed',
  } as const;

  return map[phase as keyof typeof map] || (language === 'ru' ? 'статус' : 'status');
}

export function taskEvidenceSummary(taskState: ChatTaskState | null | undefined, language: 'ru' | 'en') {
  const evidence = taskState?.evidenceState || 'none';
  const verify = taskState?.verify;
  if (evidence === 'verify_passed') {
    return language === 'ru' ? 'Результат подтверждён проверкой.' : 'The result is confirmed by verification.';
  }
  if (evidence === 'verify_failed') {
    return repairMojibake(
      language === 'ru'
        ? `Проверка не прошла${verify?.reason ? `: ${verify.reason}` : '.'}`
        : `Verification failed${verify?.reason ? `: ${verify.reason}` : '.'}`
    );
  }
  if (evidence === 'claim_mismatch') {
    return language === 'ru' ? 'Ответ не совпал с фактическими действиями.' : 'The answer did not match the executed actions.';
  }
  if (evidence === 'tool_confirmed') {
    return language === 'ru' ? 'Изменения подтверждены действиями в проекте.' : 'Changes were confirmed by tool actions in the project.';
  }
  return null;
}

export function shouldRenderCompatibilityStatusCard(
  taskState: ChatTaskState | null | undefined,
  options: { isStreaming?: boolean } = {}
) {
  if (!taskState) return false;

  if (taskState.mode === 'answer' || taskState.mode === 'clarify') {
    return false;
  }

  if (['editing', 'verifying', 'awaiting_approval', 'failed'].includes(taskState.phase)) {
    return true;
  }

  if (taskState.phase === 'idle' && options.isStreaming) {
    return Boolean(String(taskState.currentAction || '').trim());
  }

  return false;
}

export function taskPrimaryDetail(taskState: ChatTaskState | null | undefined, language: 'ru' | 'en') {
  if (!taskState) return '';

  const evidence = repairMojibake(taskEvidenceSummary(taskState, language) || '');
  const result = repairMojibake(String(taskState.resultSummary || '').trim());
  const action = repairMojibake(String(taskState.currentAction || '').trim());

  if (taskState.phase === 'completed') {
    return evidence || result || (language === 'ru' ? 'Задача завершена.' : 'Task completed.');
  }

  if (taskState.phase === 'failed') {
    return result || evidence || (language === 'ru' ? 'Во время выполнения возникла ошибка.' : 'An execution error occurred.');
  }

  if (taskState.phase === 'awaiting_approval') {
    return action || evidence || (language === 'ru' ? 'Следующее действие требует подтверждения.' : 'The next action requires approval.');
  }

  return action || evidence || (language === 'ru'
    ? 'Агент выполняет следующий рабочий шаг.'
    : 'The agent is executing the next work step.');
}

export function parseContent(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const regex = /```(?:([a-zA-Z0-9]+)\n)?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', content: match[2].trim(), language: match[1] || undefined });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return parts;
}
