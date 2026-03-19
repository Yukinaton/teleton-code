export function buildPreviewBaseUrl(previewPort?: number | null) {
  if (!previewPort || typeof window === 'undefined') {
    return null;
  }

  const url = new URL(window.location.origin);
  url.port = String(previewPort);
  return url.origin;
}

export function resolvePreviewUrl(previewBaseUrl: string | null | undefined, value?: string | null) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (!previewBaseUrl) {
    return value;
  }

  const normalizedBase = previewBaseUrl.replace(/\/+$/, '');
  const normalizedValue = value.startsWith('/') ? value : `/${value}`;
  return `${normalizedBase}${normalizedValue}`;
}

export function buildWorkspacePreviewUrl(
  previewBaseUrl: string | null | undefined,
  workspaceId?: string | null,
  filePath?: string | null
) {
  if (!workspaceId || !filePath) {
    return null;
  }

  const normalizedPath = String(filePath).replace(/\\/g, '/');
  return resolvePreviewUrl(previewBaseUrl, `/preview/${workspaceId}/${normalizedPath}`);
}
