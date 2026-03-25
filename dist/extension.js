"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const analyze_curl_1 = require("./lib/analyze_curl");
const analyze_curl_code_actions_1 = require("./lib/analyze_curl_code_actions");
const run_curl_1 = require("./lib/run_curl");
const rca_report_1 = require("./lib/rca_report");
const openai_rca_1 = require("./lib/openai_rca");
const DIAGNOSTICS_OWNER = 'curlDoctor';
const CURL_TIMEOUT_MS = 30000;
function activate(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTICS_OWNER);
    context.subscriptions.push(diagnostics);
    const code_actions = vscode.languages.registerCodeActionsProvider([
        { language: 'python', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' },
    ], new analyze_curl_code_actions_1.AnalyzeCurlCodeActionProvider(), { providedCodeActionKinds: analyze_curl_code_actions_1.AnalyzeCurlCodeActionProvider.providedCodeActionKinds });
    context.subscriptions.push(code_actions);
    const analyze_command = vscode.commands.registerCommand('curlDoctor.analyze', async () => {
        const editor = vscode.window.activeTextEditor;
        const active_document = editor?.document;
        const selected_text = editor?.selection && !editor.selection.isEmpty
            ? active_document?.getText(editor.selection)
            : undefined;
        const curl_text = await vscode.window.showInputBox({
            prompt: 'Paste a cURL command to analyze',
            placeHolder: 'curl https://example.com -H "Accept: application/json"',
            value: selected_text?.trim(),
            ignoreFocusOut: true,
        });
        if (!curl_text || curl_text.trim().length === 0) {
            return;
        }
        const output_channel = getOutputChannel();
        output_channel.clear();
        const static_result = (0, analyze_curl_1.analyzeCurl)(curl_text);
        output_channel.appendLine(static_result.summary);
        for (const detail_line of static_result.detail_lines) {
            output_channel.appendLine(detail_line);
        }
        const run_result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Curl Analyzer: Running cURL',
            cancellable: false,
        }, async () => (0, run_curl_1.runCurl)(curl_text, CURL_TIMEOUT_MS));
        output_channel.appendLine('');
        output_channel.appendLine(`Run: exit_code=${run_result.exit_code} duration_ms=${run_result.duration_ms}`);
        const openai_rca = await maybeGenerateOpenAiRca({
            curl_text,
            run_result,
            static_result,
            output_channel,
        });
        const report = (0, rca_report_1.buildRcaReportMd)({ curl_text, run_result, openai_rca });
        const report_uri = await writeReportToWorkspace(report.md_text);
        output_channel.appendLine(`Report written: ${report_uri.fsPath}`);
        output_channel.show(true);
        if (!active_document) {
            return;
        }
        const doc_uri = active_document.uri;
        const doc_diagnostics = [];
        for (const issue of static_result.issues) {
            const range = issue.range_in_document ?? new vscode.Range(0, 0, 0, 1);
            const diagnostic = new vscode.Diagnostic(range, issue.message, toVsCodeSeverity(issue.severity));
            diagnostic.source = DIAGNOSTICS_OWNER;
            diagnostic.code = issue.code;
            doc_diagnostics.push(diagnostic);
        }
        diagnostics.set(doc_uri, doc_diagnostics);
    });
    context.subscriptions.push(analyze_command);
}
function deactivate() { }
let output_channel;
function getOutputChannel() {
    if (!output_channel) {
        output_channel = vscode.window.createOutputChannel('Curl Analyzer');
    }
    return output_channel;
}
function toVsCodeSeverity(severity) {
    if (severity === 'error')
        return vscode.DiagnosticSeverity.Error;
    if (severity === 'warning')
        return vscode.DiagnosticSeverity.Warning;
    return vscode.DiagnosticSeverity.Information;
}
async function maybeGenerateOpenAiRca(params) {
    const config = vscode.workspace.getConfiguration('curlAnalyzer');
    const use_openai = Boolean(config.get('useOpenAiRca', true));
    if (!use_openai)
        return undefined;
    const api_key = getOpenAiApiKey();
    if (!api_key)
        return undefined;
    const model = String(config.get('openaiModel', 'gpt-4.1-mini'));
    params.output_channel.appendLine('');
    params.output_channel.appendLine('OpenAI: generating RCA...');
    try {
        return await (0, openai_rca_1.generateOpenAiRca)({
            api_key,
            model,
            curl_text: params.curl_text,
            static_summary: params.static_result.summary,
            static_details: params.static_result.detail_lines,
            exit_code: params.run_result.exit_code,
            duration_ms: params.run_result.duration_ms,
            stdout_text: params.run_result.stdout_text,
            stderr_text: params.run_result.stderr_text,
        });
    }
    catch (err) {
        params.output_channel.appendLine(`OpenAI: RCA failed (${String(err)})`);
        return undefined;
    }
}
function getOpenAiApiKey() {
    const env_key = process.env.OPENAI_API_KEY;
    if (env_key && env_key.trim().length > 0)
        return env_key.trim();
    const config_key = vscode.workspace.getConfiguration('curlAnalyzer').get('openaiApiKey');
    if (typeof config_key === 'string' && config_key.trim().length > 0) {
        return config_key.trim();
    }
    return undefined;
}
async function writeReportToWorkspace(md_text) {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    const base_uri = workspace?.uri ?? vscode.Uri.file(process.cwd());
    const file_name = `curl_analyzer_report_${timestampForFilename()}.md`;
    const report_uri = vscode.Uri.joinPath(base_uri, file_name);
    await vscode.workspace.fs.writeFile(report_uri, Buffer.from(md_text, 'utf8'));
    return report_uri;
}
function timestampForFilename() {
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
