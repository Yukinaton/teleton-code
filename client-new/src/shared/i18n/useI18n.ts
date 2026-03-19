import { useCallback } from 'react';
import { useLayoutStore } from '../../entities/layout/useLayoutStore';
import { translate, type TranslationKey } from './translations';

export function useI18n() {
  const language = useLayoutStore((state) => state.language);

  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number | undefined>) =>
      translate(language, key, values),
    [language]
  );

  return {
    language,
    t,
  };
}
