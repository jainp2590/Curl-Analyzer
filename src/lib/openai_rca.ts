import { request } from 'https';
import { redactForOpenAi } from './redact_sensitive';

export type OpenAiRcaResult = {
  title: string;
  failure_stage: string;
  evidence_lines: string[];
  suggested_fix_title: string;
  suggested_curl: string;
  confidence_score: number;
  model: string;
};

export async function generateOpenAiRca(params: {
  api_key: string;
  model: string;
  curl_text: string;
  static_summary: string;
  static_details: string[];
  exit_code: number;
  duration_ms: number;
  stdout_text: string;
  stderr_text: string;
}): Promise<OpenAiRcaResult> {
  const prompt = buildPrompt(params);
  const response = await callResponsesApi({
    api_key: params.api_key,
    model: params.model,
    input: prompt,
  });

  const json_text = extractJsonText(response);
  const parsed = safeJsonParse(json_text);
  if (!parsed) {
    throw new Error('OpenAI returned non-JSON output.');
  }

  return {
    title: String(parsed.title ?? 'Unknown failure'),
    failure_stage: String(parsed.failure_stage ?? 'unknown'),
    evidence_lines: asStringArray(parsed.evidence_lines),
    suggested_fix_title: String(parsed.suggested_fix_title ?? 'Inspect stderr and adjust request'),
    suggested_curl: String(parsed.suggested_curl ?? params.curl_text),
    confidence_score: clamp01(Number(parsed.confidence_score ?? 0.35)),
    model: params.model,
  };
}

function buildPrompt(params: {
  curl_text: string;
  static_summary: string;
  static_details: string[];
  exit_code: number;
  duration_ms: number;
  stdout_text: string;
  stderr_text: string;
}): string {
  const curl_safe = redactForOpenAi(params.curl_text.trim());
  const summary_safe = redactForOpenAi(params.static_summary);
  const details_safe = params.static_details.map((l) => redactForOpenAi(l));
  const stderr = truncate(redactForOpenAi(params.stderr_text), 6000);
  const stdout = truncate(redactForOpenAi(params.stdout_text), 3000);

  return [
    'You are a senior engineer writing an RCA for a failing cURL request.',
    'Return ONLY valid JSON with this schema:',
    '{',
    '  "title": string,',
    '  "failure_stage": "url_parse"|"dns_resolution"|"tcp_connect"|"tls_handshake"|',
    '    "http_response"|"auth"|"request_format"|"timeout"|"unknown",',
    '  "evidence_lines": string[],',
    '  "suggested_fix_title": string,',
    '  "suggested_curl": string,',
    '  "confidence_score": number (0..1)',
    '}',
    '',
    'Inputs:',
    `- Exit code: ${params.exit_code}`,
    `- Duration ms: ${params.duration_ms}`,
    `- Static summary: ${summary_safe}`,
    ...details_safe.map((l) => `- Static detail: ${l}`),
    '',
    'cURL:',
    curl_safe,
    '',
    'stderr (truncated):',
    stderr,
    '',
    'stdout (truncated):',
    stdout,
    '',
    'Rules:',
    '- Keep evidence_lines concise and quote exact stderr lines when possible.',
    '- If you suggest changing the cURL, output the full updated cURL.',
  ].join('\n');
}

function callResponsesApi(params: {
  api_key: string;
  model: string;
  input: string;
}): Promise<unknown> {
  const body = JSON.stringify({
    model: params.model,
    input: params.input,
    text: { format: { type: 'text' } },
  });

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'api.openai.com',
        path: '/v1/responses',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.api_key}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`OpenAI HTTP ${res.statusCode}: ${text}`));
            return;
          }
          const parsed = safeJsonParse(text);
          if (!parsed) {
            reject(new Error('OpenAI response was not JSON.'));
            return;
          }
          resolve(parsed);
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractJsonText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const r = response as { output_text?: string };
  if (typeof r.output_text === 'string') return r.output_text;
  return JSON.stringify(response);
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

function truncate(text: string, max_len: number): string {
  if (text.length <= max_len) return text;
  return `${text.slice(0, max_len)}\n... truncated ...`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.35;
  return Math.max(0, Math.min(1, value));
}

