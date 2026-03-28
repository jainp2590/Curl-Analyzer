import { parse as shellParse } from 'shell-quote';

/**
 * Prepare pasted cURL for tokenization.
 * - Normalizes CRLF / CR (fixes `\\` + `\\r\\n` so it is not parsed as a stray `r`).
 * - Collapses bash line continuation (`\\` + newline) into a space (same as bash).
 * - Turns any remaining newlines into spaces (multiline paste without `\\`).
 */
export function preprocessCurlInput(input: string): string {
  let s = input.replace(/^\uFEFF/, '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\\\s*\n/g, ' ');
  s = s.replace(/\n/g, ' ');
  return s.trim();
}

/**
 * Tokenize a cURL string like a POSIX shell would.
 */
export function parseCurlTokens(input: string): string[] | null {
  try {
    const preprocessed = preprocessCurlInput(input);
    const parsed = shellParse(preprocessed);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.replace(/\r/g, ''))
      .filter((t) => t.length > 0);
  } catch {
    return null;
  }
}
