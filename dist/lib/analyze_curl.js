"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeCurl = analyzeCurl;
const shell_quote_1 = require("shell-quote");
const url_1 = require("url");
const DEFAULT_METHOD = 'GET';
function analyzeCurl(curl_text) {
    const issues = [];
    const detail_lines = [];
    const model_result = parseCurlToModel(curl_text);
    issues.push(...model_result.issues);
    if (model_result.model) {
        const url_issues = validateUrl(model_result.model);
        issues.push(...url_issues.issues);
        detail_lines.push(...url_issues.details);
        const body_issues = validateBody(model_result.model);
        issues.push(...body_issues.issues);
        detail_lines.push(...body_issues.details);
    }
    const error_count = issues.filter((i) => i.severity === 'error').length;
    const warning_count = issues.filter((i) => i.severity === 'warning').length;
    const info_count = issues.filter((i) => i.severity === 'info').length;
    const summary = `Curl Analyzer: ${error_count} error(s), ${warning_count} warning(s), ` +
        `${info_count} info`;
    if (issues.length === 0) {
        detail_lines.unshift('No obvious cURL issues detected.');
    }
    return { summary, detail_lines, issues };
}
function parseCurlToModel(curl_text) {
    const issues = [];
    const tokens_raw = safeShellParse(curl_text);
    if (!tokens_raw) {
        issues.push({
            code: 'curlDoctor.parse_failed',
            severity: 'error',
            message: 'Could not parse command. Check quoting and escapes.',
            suggested_fix: {
                title: 'Wrap JSON/body in single quotes',
                replacement_curl: suggestQuoteBody(curl_text),
            },
        });
        return { issues };
    }
    const tokens = tokens_raw
        .filter((t) => typeof t === 'string')
        .map((t) => String(t));
    if (tokens.length === 0) {
        issues.push({
            code: 'curlDoctor.empty',
            severity: 'error',
            message: 'Empty input.',
        });
        return { issues };
    }
    if (tokens[0] !== 'curl') {
        issues.push({
            code: 'curlDoctor.not_curl',
            severity: 'warning',
            message: 'Command does not start with `curl`.',
        });
    }
    const model = {
        method: DEFAULT_METHOD,
        headers: {},
        raw_tokens: tokens,
    };
    let idx = 0;
    while (idx < tokens.length) {
        const token = tokens[idx];
        if (token === '-X' || token === '--request') {
            const method = tokens[idx + 1];
            if (!method) {
                issues.push({
                    code: 'curlDoctor.missing_method',
                    severity: 'error',
                    message: 'Missing HTTP method after -X/--request.',
                });
                idx += 1;
                continue;
            }
            model.method = method.toUpperCase();
            idx += 2;
            continue;
        }
        if (token === '-H' || token === '--header') {
            const header_line = tokens[idx + 1];
            if (!header_line) {
                issues.push({
                    code: 'curlDoctor.missing_header',
                    severity: 'error',
                    message: 'Missing header value after -H/--header.',
                });
                idx += 1;
                continue;
            }
            const parsed = splitHeader(header_line);
            if (!parsed) {
                issues.push({
                    code: 'curlDoctor.bad_header',
                    severity: 'error',
                    message: `Header is not in "Key: Value" form: ${header_line}`,
                    suggested_fix: {
                        title: 'Fix header format',
                        replacement_curl: curl_text.replace(header_line, `${header_line}: `),
                    },
                });
                idx += 2;
                continue;
            }
            model.headers[parsed.key] = parsed.value;
            idx += 2;
            continue;
        }
        if (token === '-d' || token === '--data' || token === '--data-raw' ||
            token === '--data-binary' || token === '--data-ascii') {
            const data = tokens[idx + 1];
            if (data === undefined) {
                issues.push({
                    code: 'curlDoctor.missing_data',
                    severity: 'error',
                    message: 'Missing data after -d/--data*.',
                });
                idx += 1;
                continue;
            }
            model.data = data;
            if (model.method === 'GET') {
                issues.push({
                    code: 'curlDoctor.get_with_body',
                    severity: 'warning',
                    message: 'GET request has a body; many servers ignore it.',
                    suggested_fix: {
                        title: 'Switch to POST',
                        replacement_curl: injectRequestMethod(curl_text, 'POST'),
                    },
                });
            }
            idx += 2;
            continue;
        }
        if (!token.startsWith('-') && !model.url && looksLikeUrl(token)) {
            model.url = token;
        }
        idx += 1;
    }
    if (!model.url) {
        issues.push({
            code: 'curlDoctor.missing_url',
            severity: 'error',
            message: 'No URL detected in the command.',
        });
    }
    return { model, issues };
}
function validateUrl(model) {
    const details = [];
    const issues = [];
    if (!model.url)
        return { details, issues };
    try {
        // eslint-disable-next-line no-new
        new url_1.URL(model.url);
        details.push(`URL: ${model.url}`);
    }
    catch {
        issues.push({
            code: 'curlDoctor.invalid_url',
            severity: 'error',
            message: `Invalid URL: ${model.url}`,
            suggested_fix: {
                title: 'Add https:// scheme',
                replacement_curl: model.raw_tokens.join(' ').replace(model.url, `https://${model.url}`),
            },
        });
    }
    if (model.url.includes(' ')) {
        issues.push({
            code: 'curlDoctor.url_has_spaces',
            severity: 'error',
            message: 'URL contains spaces; it must be quoted or encoded.',
        });
    }
    return { details, issues };
}
function validateBody(model) {
    const details = [];
    const issues = [];
    if (!model.data)
        return { details, issues };
    const content_type = headerLookup(model.headers, 'content-type');
    if (content_type) {
        details.push(`Content-Type: ${content_type}`);
    }
    if (content_type?.toLowerCase().includes('application/json')) {
        const trimmed = model.data.trim();
        if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
            issues.push({
                code: 'curlDoctor.json_not_object',
                severity: 'warning',
                message: 'Content-Type is JSON, but body does not look like JSON.',
            });
        }
        else {
            try {
                JSON.parse(model.data);
            }
            catch (err) {
                issues.push({
                    code: 'curlDoctor.invalid_json',
                    severity: 'error',
                    message: `Body is not valid JSON: ${String(err)}`,
                    suggested_fix: {
                        title: 'Quote JSON body with single quotes',
                        replacement_curl: suggestQuoteBody(model.raw_tokens.join(' ')),
                    },
                });
            }
        }
    }
    return { details, issues };
}
function safeShellParse(input) {
    try {
        const parsed = (0, shell_quote_1.parse)(input);
        if (!Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function looksLikeUrl(token) {
    return token.startsWith('http://') || token.startsWith('https://') || token.includes('.');
}
function splitHeader(header_line) {
    const idx = header_line.indexOf(':');
    if (idx <= 0)
        return null;
    const key = header_line.slice(0, idx).trim();
    const value = header_line.slice(idx + 1).trim();
    if (key.length === 0)
        return null;
    return { key, value };
}
function headerLookup(headers, key_lower) {
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === key_lower)
            return value;
    }
    return undefined;
}
function injectRequestMethod(curl_text, method) {
    if (/\s(-X|--request)\s+\w+/i.test(curl_text)) {
        return curl_text.replace(/\s(-X|--request)\s+\w+/i, ` -X ${method}`);
    }
    return `curl -X ${method} ${curl_text.replace(/^curl\s+/i, '')}`.trim();
}
function suggestQuoteBody(curl_text) {
    const match = curl_text.match(/\s(-d|--data|--data-raw|--data-binary|--data-ascii)\s+(.+)/);
    if (!match)
        return curl_text;
    const data_flag = match[1];
    const rest = match[2].trim();
    if (rest.startsWith("'") || rest.startsWith('"'))
        return curl_text;
    const parts = rest.split(/\s+/);
    if (parts.length === 0)
        return curl_text;
    const first = parts[0];
    const quoted = `'${first.replace(/'/g, "'\\''")}'`;
    const replacement = `${data_flag} ${quoted}`;
    return curl_text.replace(`${data_flag} ${first}`, replacement);
}
