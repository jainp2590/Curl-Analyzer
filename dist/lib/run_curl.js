"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCurl = runCurl;
const child_process_1 = require("child_process");
const shell_quote_1 = require("shell-quote");
async function runCurl(curl_text, timeout_ms) {
    const start_ms = Date.now();
    const parsed = safeShellParse(curl_text);
    const tokens = parsed
        .filter((t) => typeof t === 'string')
        .map((t) => String(t));
    const normalized_tokens = normalizeToCurlTokens(tokens);
    const curl_args = withSafetyArgs(normalized_tokens.slice(1), timeout_ms);
    const child = (0, child_process_1.spawn)('curl', curl_args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout_chunks = [];
    const stderr_chunks = [];
    child.stdout.on('data', (chunk) => stdout_chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr_chunks.push(Buffer.from(chunk)));
    const result = await new Promise((resolve) => {
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
function safeShellParse(input) {
    try {
        const parsed = (0, shell_quote_1.parse)(input);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
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
    return safe_args;
}
