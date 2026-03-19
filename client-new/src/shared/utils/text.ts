const MOJIBAKE_PATTERN = /(?:Р.|С.|Ð.|Ñ.|â€¦|â€”|вЂ|ѓ|Ќ|љ|ў|џ){2,}/;

export function looksLikeMojibake(value: string | null | undefined) {
  return MOJIBAKE_PATTERN.test(String(value || ''));
}

export function repairMojibake(value: string | null | undefined) {
  const source = String(value || '');
  if (!source || !looksLikeMojibake(source)) {
    return source;
  }

  try {
    const bytes = Uint8Array.from(Array.from(source), (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const decodedCyrillic = (decoded.match(/[А-Яа-яЁё]/g) || []).length;
    const sourceCyrillic = (source.match(/[А-Яа-яЁё]/g) || []).length;
    return decodedCyrillic > sourceCyrillic ? decoded : source;
  } catch {
    return source;
  }
}
