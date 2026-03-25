import { spawn } from 'child_process';
import { parse as shellParse } from 'shell-quote';

export type CurlRunResult = {
  exit_code: number;
  stdout_text: string;
  stderr_text: string;
  duration_ms: number;
  effective_curl_args: string[];
};

export async function runCurl(curl_text: string, timeout_ms: number): Promise<CurlRunResult> {
  const start_ms = Date.now();
  const parsed = safeShellParse(curl_text);
  const tokens = parsed
    .filter((t) => typeof t === 'string')
    .map((t) => String(t));

  const normalized_tokens = normalizeToCurlTokens(tokens);
  const curl_args = withSafetyArgs(normalized_tokens.slice(1), timeout_ms);

  const child = spawn('curl', curl_args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const stdout_chunks: Buffer[] = [];
  const stderr_chunks: Buffer[] = [];

  child.stdout.on('data', (chunk) => stdout_chunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr_chunks.push(Buffer.from(chunk)));

  const result = await new Promise<CurlRunResult>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeout_ms + 2000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        exit_code: typeof code === 'number' ? code : 0,
        stdout_text: Buffer.concat(stdout_chunks).toString('utf8'),
        stderr_text: Buffer.concat(stderr_chunks).toString('utf8'),
        duration_ms: Date.now() - start_ms,
        effective_curl_args: curl_args,
      });
    });
  });

  return result;
}

function safeShellParse(input: string): unknown[] {
  try {
    const parsed = shellParse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeToCurlTokens(tokens: string[]): string[] {
  if (tokens.length === 0) return ['curl'];
  if (tokens[0] === 'curl') return tokens;
  return ['curl', ...tokens];
}

function withSafetyArgs(args: string[], timeout_ms: number): string[] {
  const has_max_time = args.some((a) => a === '--max-time' || a === '-m');
  const has_verbose = args.some((a) => a === '-v' || a === '--verbose');
  const has_show_error = args.some((a) => a === '-S' || a === '--show-error');
  const has_silent = args.some((a) => a === '-s' || a === '--silent');

  const safe_args: string[] = [];
  if (!has_verbose) safe_args.push('-v');
  if (!has_silent) safe_args.push('-s');
  if (!has_show_error) safe_args.push('-S');
  safe_args.push(...args);

  if (!has_max_time) {
    const seconds = Math.max(1, Math.ceil(timeout_ms / 1000));
    safe_args.push('--max-time', String(seconds));
  }

  return safe_args;
}

