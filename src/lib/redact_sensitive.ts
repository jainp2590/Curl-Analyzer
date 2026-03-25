/**
 * Strips or masks values that should not be sent to third-party APIs (e.g. OpenAI).
 * Heuristic — when in doubt, redact.
 */

export function redactForOpenAi(text: string): string {
  if (!text) return text;
  let out = text;
  out = redactCurlHeaderFlags(out);
  out = redactAuthorizationHeaders(out);
  out = redactCookieHeaders(out);
  out = redactApiKeyHeaders(out);
  out = redactBearerTokens(out);
  out = redactBasicAuthFlags(out);
  out = redactUrlQuerySecrets(out);
  out = redactJsonSensitiveKeys(out);
  return out;
}

function redactCurlHeaderFlags(s: string): string {
  const sensitive = ['Authorization', 'Cookie', 'X-Api-Key', 'X-API-Key', 'Api-Key'];
  let out = s;
  for (const name of sensitive) {
    const esc = name.replace(/-/g, '\\-');
    out = out.replace(
      new RegExp(
        `(-H|--header)\\s+(["'])(${esc}\\s*:\\s*[^"']*)\\2`,
        'gi',
      ),
      (_m, flag: string, q: string) => `${flag} ${q}${name}: [REDACTED]${q}`,
    );
  }
  return out;
}

function redactAuthorizationHeaders(s: string): string {
  return s.replace(
    /(^|[\r\n>])\s*(Authorization\s*:\s*)([^\r\n]+)/gim,
    (_m, prefix, label) => `${prefix}${label}[REDACTED]`,
  );
}

function redactCookieHeaders(s: string): string {
  return s.replace(
    /(^|[\r\n>])\s*(Cookie\s*:\s*)([^\r\n]+)/gim,
    (_m, prefix, label) => `${prefix}${label}[REDACTED]`,
  );
}

function redactApiKeyHeaders(s: string): string {
  return s.replace(
    /(^|[\r\n>])\s*((?:X-Api-Key|X-API-Key|Api-Key)\s*:\s*)([^\r\n]+)/gim,
    (_m, prefix, label) => `${prefix}${label}[REDACTED]`,
  );
}

function redactBearerTokens(s: string): string {
  return s.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');
}

function redactBasicAuthFlags(s: string): string {
  let out = s.replace(/\b(-u|--user)\s+[^\s]+/gi, '$1 [REDACTED]');
  out = out.replace(/\b(--proxy-user)\s+[^\s]+/gi, '$1 [REDACTED]');
  return out;
}

function redactUrlQuerySecrets(s: string): string {
  const param_names = [
    'access_token',
    'token',
    'id_token',
    'refresh_token',
    'api_key',
    'apikey',
    'key',
    'secret',
    'password',
    'passwd',
    'client_secret',
    'authorization',
  ];
  let out = s;
  for (const name of param_names) {
    const re = new RegExp(
      `([?&]${name}=)([^&\\s#"'<>]+)`,
      'gi',
    );
    out = out.replace(re, '$1[REDACTED]');
  }
  return out;
}

function redactJsonSensitiveKeys(s: string): string {
  const keys = [
    'password',
    'passwd',
    'secret',
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'apiKey',
    'api_key',
    'authorization',
    'client_secret',
    'private_key',
  ];
  let out = s;
  for (const k of keys) {
    out = out.replace(
      new RegExp(`("${k}"\\s*:\\s*)("[^"]*"|[^,}\\]\\s]+)`, 'gi'),
      '$1"[REDACTED]"',
    );
  }
  return out;
}
