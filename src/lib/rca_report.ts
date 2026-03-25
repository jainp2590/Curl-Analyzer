import { analyzeCurl } from './analyze_curl';
import type { CurlRunResult } from './run_curl';
import type { OpenAiRcaResult } from './openai_rca';

type Rca = {
  title: string;
  failure_stage: string;
  evidence_lines: string[];
  suggested_fix_title: string;
  suggested_curl: string;
  confidence_score: number;
  ai?: {
    model: string;
  };
};

export function buildRcaReportMd(params: {
  curl_text: string;
  run_result: CurlRunResult;
  openai_rca?: OpenAiRcaResult;
}): { md_text: string; rca: Rca } {
  const { curl_text, run_result, openai_rca } = params;
  const static_analysis = analyzeCurl(curl_text);

  const fallback_rca = classifyFailure({
    curl_text,
    run_result,
    static_analysis_summary: static_analysis.summary,
  });

  const rca: Rca = openai_rca
    ? {
      title: openai_rca.title,
      failure_stage: openai_rca.failure_stage,
      evidence_lines: openai_rca.evidence_lines,
      suggested_fix_title: openai_rca.suggested_fix_title,
      suggested_curl: openai_rca.suggested_curl,
      confidence_score: openai_rca.confidence_score,
      ai: { model: openai_rca.model },
    }
    : fallback_rca;

  const md_lines: string[] = [];
  md_lines.push(`# Curl Analyzer Report`);
  md_lines.push('');
  md_lines.push(`## Summary`);
  md_lines.push(`- **Exit code**: ${run_result.exit_code}`);
  md_lines.push(`- **Duration**: ${run_result.duration_ms} ms`);
  md_lines.push(`- **Failure stage**: ${rca.failure_stage}`);
  md_lines.push(`- **Confidence score**: ${formatConfidence(rca.confidence_score)}`);
  if (rca.ai?.model) {
    md_lines.push(`- **RCA source**: OpenAI (${rca.ai.model})`);
  } else {
    md_lines.push(`- **RCA source**: heuristic`);
  }
  md_lines.push('');
  md_lines.push(`## Input cURL`);
  md_lines.push('```bash');
  md_lines.push(curl_text.trim());
  md_lines.push('```');
  md_lines.push('');
  md_lines.push(`## Static analysis`);
  md_lines.push(`- ${static_analysis.summary}`);
  for (const line of static_analysis.detail_lines) {
    md_lines.push(`- ${line}`);
  }
  md_lines.push('');
  md_lines.push(`## Execution evidence`);
  for (const line of rca.evidence_lines) {
    md_lines.push(`- ${line}`);
  }
  md_lines.push('');
  md_lines.push(`## RCA`);
  md_lines.push(`**${rca.title}**`);
  md_lines.push('');
  md_lines.push(`## Suggested fix`);
  md_lines.push(`- **Fix**: ${rca.suggested_fix_title}`);
  md_lines.push('');
  md_lines.push('```bash');
  md_lines.push(rca.suggested_curl.trim());
  md_lines.push('```');
  md_lines.push('');
  md_lines.push(`## Raw stderr (truncated)`);
  md_lines.push('```');
  md_lines.push(truncate(run_result.stderr_text, 4000));
  md_lines.push('```');
  md_lines.push('');
  md_lines.push(`## Raw stdout (truncated)`);
  md_lines.push('```');
  md_lines.push(truncate(run_result.stdout_text, 4000));
  md_lines.push('```');
  md_lines.push('');

  return { md_text: md_lines.join('\n'), rca };
}

function classifyFailure(params: {
  curl_text: string;
  run_result: CurlRunResult;
  static_analysis_summary: string;
}): Rca {
  const { curl_text, run_result } = params;
  const stderr = run_result.stderr_text;
  const exit_code = run_result.exit_code;

  const evidence_lines: string[] = [];
  evidence_lines.push(`curl exit code ${exit_code}`);
  if (stderr.includes('Could not resolve host')) {
    return {
      title: 'DNS resolution failed (host not found).',
      failure_stage: 'dns_resolution',
      evidence_lines: [...evidence_lines, pickEvidence(stderr, 'Could not resolve host')],
      suggested_fix_title: 'Verify hostname, DNS, and network/VPN; try quoting URL.',
      suggested_curl: curl_text,
      confidence_score: 0.9,
    };
  }

  if (stderr.includes('Failed to connect') || stderr.includes('Connection refused')) {
    return {
      title: 'TCP connection failed (refused/unreachable).',
      failure_stage: 'tcp_connect',
      evidence_lines: [
        ...evidence_lines,
        pickEvidence(stderr, 'Failed to connect'),
        pickEvidence(stderr, 'Connection refused'),
      ].filter(Boolean) as string[],
      suggested_fix_title: 'Check host/port, firewall, and service availability; verify scheme.',
      suggested_curl: ensureHttpsIfMissing(curl_text),
      confidence_score: 0.75,
    };
  }

  if (stderr.includes('SSL') || stderr.includes('TLS')) {
    return {
      title: 'TLS/SSL handshake failed.',
      failure_stage: 'tls_handshake',
      evidence_lines: [
        ...evidence_lines,
        pickEvidence(stderr, 'SSL'),
        pickEvidence(stderr, 'TLS'),
      ].filter(Boolean) as string[],
      suggested_fix_title: 'Verify cert chain/hostname; for debugging only try `-k`.',
      suggested_curl: maybeAddInsecureForDebug(curl_text),
      confidence_score: 0.7,
    };
  }

  if (exit_code === 6) {
    return {
      title: 'DNS resolution failed (curl exit code 6).',
      failure_stage: 'dns_resolution',
      evidence_lines,
      suggested_fix_title: 'Verify hostname and DNS; check `/etc/hosts` and VPN.',
      suggested_curl: curl_text,
      confidence_score: 0.85,
    };
  }

  if (exit_code === 7) {
    return {
      title: 'Failed to connect to host (curl exit code 7).',
      failure_stage: 'tcp_connect',
      evidence_lines,
      suggested_fix_title: 'Check host/port reachability and scheme; try correct port.',
      suggested_curl: curl_text,
      confidence_score: 0.8,
    };
  }

  if (exit_code === 35) {
    return {
      title: 'TLS/SSL connect error (curl exit code 35).',
      failure_stage: 'tls_handshake',
      evidence_lines,
      suggested_fix_title: 'Verify TLS settings; for debugging only try `-k`.',
      suggested_curl: maybeAddInsecureForDebug(curl_text),
      confidence_score: 0.8,
    };
  }

  if (exit_code === 3) {
    return {
      title: 'URL is malformed (curl exit code 3).',
      failure_stage: 'url_parse',
      evidence_lines: [...evidence_lines, pickEvidence(stderr, 'URL')],
      suggested_fix_title: 'Fix URL and quote it if it contains special characters.',
      suggested_curl: ensureHttpsIfMissing(curl_text),
      confidence_score: 0.85,
    };
  }

  const http_status = parseHttpStatusFromVerbose(stderr);
  if (http_status && http_status >= 400) {
    return {
      title: `Server returned HTTP ${http_status}.`,
      failure_stage: 'http_response',
      evidence_lines: [...evidence_lines, `HTTP ${http_status} observed in verbose output`],
      suggested_fix_title: 'Check auth/headers/body; try adding `--fail-with-body` for clearer errors.',
      suggested_curl: addFailWithBody(curl_text),
      confidence_score: http_status === 401 || http_status === 403 ? 0.65 : 0.55,
    };
  }

  return {
    title: 'Unknown failure; inspect stderr and request/response details.',
    failure_stage: 'unknown',
    evidence_lines,
    suggested_fix_title: 'Re-run with `-v` and add `--fail-with-body`.',
    suggested_curl: addFailWithBody(curl_text),
    confidence_score: 0.35,
  };
}

function addFailWithBody(curl_text: string): string {
  if (curl_text.includes('--fail-with-body')) return curl_text;
  if (/^curl\b/i.test(curl_text.trim())) return `${curl_text} --fail-with-body`;
  return `curl ${curl_text} --fail-with-body`;
}

function ensureHttpsIfMissing(curl_text: string): string {
  if (curl_text.includes('http://') || curl_text.includes('https://')) return curl_text;
  return curl_text.replace(/\b(curl\s+)(\S+\.\S+)/i, '$1https://$2');
}

function maybeAddInsecureForDebug(curl_text: string): string {
  if (curl_text.includes(' -k') || curl_text.includes(' --insecure')) return curl_text;
  if (/^curl\b/i.test(curl_text.trim())) return `${curl_text} -k`;
  return `curl ${curl_text} -k`;
}

function parseHttpStatusFromVerbose(stderr_text: string): number | undefined {
  const match = stderr_text.match(/< HTTP\/\d(?:\.\d)?\s+(\d{3})/);
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : undefined;
}

function pickEvidence(stderr_text: string, needle: string): string {
  const lines = stderr_text.split('\n');
  const line = lines.find((l) => l.includes(needle));
  return line ? line.trim() : `stderr contains "${needle}"`;
}

function truncate(text: string, max_len: number): string {
  if (text.length <= max_len) return text;
  return `${text.slice(0, max_len)}\n... truncated ...`;
}

function formatConfidence(confidence_score: number): string {
  const normalized = Math.max(0, Math.min(1, confidence_score));
  return `${Math.round(normalized * 100)}%`;
}

