"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCurl = runCurl;
const child_process_1 = require("child_process");
const parse_curl_tokens_1 = require("./parse_curl_tokens");
async function runCurl(curl_text, timeout_ms) {
    const start_ms = Date.now();
    if (shouldRunViaShell()) {
        return runCurlViaShell(curl_text, timeout_ms, start_ms);
    }
    return runCurlViaSpawnArgv(curl_text, timeout_ms, start_ms);
}
const TIMEOUT_KILL_BUFFER_MS = 2000;
function shouldRunViaShell() {
    return process.platform !== 'win32';
}
/**
 * POSIX: one script string matches bash/sh line continuations after preprocess.
 * Avoids argv splitting quirks from shell-quote vs real curl.
 */
async function runCurlViaShell(curl_text, timeout_ms, start_ms) {
    const script = (0, parse_curl_tokens_1.preprocessCurlInput)(curl_text);
    if (!/^curl\s/i.test(script.trim())) {
        return runCurlViaSpawnArgv(curl_text, timeout_ms, start_ms);
    }
    const seconds = Math.max(1, Math.ceil(timeout_ms / 1000));
    const injected = script.replace(/^curl\s+/i, `curl -v -s -S --max-time ${seconds} `);
    const child = (0, child_process_1.spawn)('/bin/sh', ['-c', injected], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LC_ALL: 'C' },
    });
    return collectCurlResult(child, start_ms, [injected], timeout_ms);
}
async function runCurlViaSpawnArgv(curl_text, timeout_ms, start_ms) {
    const parsed = (0, parse_curl_tokens_1.parseCurlTokens)(curl_text);
    if (parsed === null) {
        return {
            exit_code: 2,
            stdout_text: '',
            stderr_text: 'curl-analyzer: could not parse cURL (check quoting).',
            duration_ms: Date.now() - start_ms,
            effective_curl_args: [],
        };
    }
    const normalized_tokens = normalizeToCurlTokens(parsed);
    const curl_args = withSafetyArgs(normalized_tokens.slice(1), timeout_ms);
    const child = (0, child_process_1.spawn)('curl', curl_args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return collectCurlResult(child, start_ms, curl_args, timeout_ms);
}
function collectCurlResult(child, start_ms, effective_curl_args, timeout_ms) {
    const stdout_chunks = [];
    const stderr_chunks = [];
    child.stdout?.on('data', (chunk) => stdout_chunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr_chunks.push(Buffer.from(chunk)));
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
        }, timeout_ms + TIMEOUT_KILL_BUFFER_MS);
        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({
                exit_code: typeof code === 'number' ? code : 0,
                stdout_text: Buffer.concat(stdout_chunks).toString('utf8'),
                stderr_text: Buffer.concat(stderr_chunks).toString('utf8'),
                duration_ms: Date.now() - start_ms,
                effective_curl_args,
            });
        });
    });
}
function normalizeToCurlTokens(tokens) {
    if (tokens.length === 0)
        return ['curl'];
    if (tokens[0] === 'curl')
        return tokens;
    return ['curl', ...tokens];
}
function withSafetyArgs(args, timeout_ms) {
    const has_max_time = args.some((a) => a === '--max-time' || a === '-m');
    const has_verbose = args.some((a) => a === '-v' || a === '--verbose');
    const has_show_error = args.some((a) => a === '-S' || a === '--show-error');
    const has_silent = args.some((a) => a === '-s' || a === '--silent');
    const safe_args = [];
    if (!has_verbose)
        safe_args.push('-v');
    if (!has_silent)
        safe_args.push('-s');
    if (!has_show_error)
        safe_args.push('-S');
    safe_args.push(...args);
    if (!has_max_time) {
        const seconds = Math.max(1, Math.ceil(timeout_ms / 1000));
        safe_args.push('--max-time', String(seconds));
    }
    return safe_args.filter((a) => a.length > 0);
}
