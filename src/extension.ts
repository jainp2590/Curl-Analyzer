import * as vscode from 'vscode';
import { analyzeCurl } from './lib/analyze_curl';
import { AnalyzeCurlCodeActionProvider } from './lib/analyze_curl_code_actions';
import { runCurl } from './lib/run_curl';
import { buildRcaReportMd } from './lib/rca_report';
import { generateOpenAiRca } from './lib/openai_rca';

const DIAGNOSTICS_OWNER = 'curlDoctor';
const CURL_TIMEOUT_MS = 30000;

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTICS_OWNER);
  context.subscriptions.push(diagnostics);

  const code_actions = vscode.languages.registerCodeActionsProvider(
    [
      { language: 'python', scheme: 'file' },
      { language: 'javascript', scheme: 'file' },
      { language: 'typescript', scheme: 'file' },
    ],
    new AnalyzeCurlCodeActionProvider(),
    { providedCodeActionKinds: AnalyzeCurlCodeActionProvider.providedCodeActionKinds },
  );
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

    const static_result = analyzeCurl(curl_text);
    output_channel.appendLine(static_result.summary);
    for (const detail_line of static_result.detail_lines) {
      output_channel.appendLine(detail_line);
    }

    const run_result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Curl Analyzer: Running cURL',
        cancellable: false,
      },
      async () => runCurl(curl_text, CURL_TIMEOUT_MS),
    );

    output_channel.appendLine('');
    output_channel.appendLine(`Run: exit_code=${run_result.exit_code} duration_ms=${run_result.duration_ms}`);

    const openai_rca = await maybeGenerateOpenAiRca({
      curl_text,
      run_result,
      static_result,
      output_channel,
    });

    const report = buildRcaReportMd({ curl_text, run_result, openai_rca });
    const report_uri = await writeReportToWorkspace(report.md_text);
    output_channel.appendLine(`Report written: ${report_uri.fsPath}`);
    output_channel.show(true);

    if (!active_document) {
      return;
    }

    const doc_uri = active_document.uri;
    const doc_diagnostics: vscode.Diagnostic[] = [];
    for (const issue of static_result.issues) {
      const range = issue.range_in_document ?? new vscode.Range(0, 0, 0, 1);
      const diagnostic = new vscode.Diagnostic(
        range,
        issue.message,
        toVsCodeSeverity(issue.severity),
      );
      diagnostic.source = DIAGNOSTICS_OWNER;
      diagnostic.code = issue.code;
      doc_diagnostics.push(diagnostic);
    }

    diagnostics.set(doc_uri, doc_diagnostics);
  });

  context.subscriptions.push(analyze_command);
}

export function deactivate() {}

let output_channel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!output_channel) {
    output_channel = vscode.window.createOutputChannel('Curl Analyzer');
  }
  return output_channel;
}

function toVsCodeSeverity(severity: 'error' | 'warning' | 'info'): vscode.DiagnosticSeverity {
  if (severity === 'error') return vscode.DiagnosticSeverity.Error;
  if (severity === 'warning') return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

async function maybeGenerateOpenAiRca(params: {
  curl_text: string;
  run_result: Awaited<ReturnType<typeof runCurl>>;
  static_result: ReturnType<typeof analyzeCurl>;
  output_channel: vscode.OutputChannel;
}) {
  const config = vscode.workspace.getConfiguration('curlAnalyzer');
  const use_openai = Boolean(config.get('useOpenAiRca', true));
  if (!use_openai) return undefined;

  const api_key = getOpenAiApiKey();
  if (!api_key) return undefined;

  const model = String(config.get('openaiModel', 'gpt-4.1-mini'));
  params.output_channel.appendLine('');
  params.output_channel.appendLine('OpenAI: generating RCA...');

  try {
    return await generateOpenAiRca({
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
  } catch (err) {
    params.output_channel.appendLine(`OpenAI: RCA failed (${String(err)})`);
    return undefined;
  }
}

function getOpenAiApiKey(): string | undefined {
  const env_key = process.env.OPENAI_API_KEY;
  if (env_key && env_key.trim().length > 0) return env_key.trim();

  const config_key = vscode.workspace.getConfiguration('curlAnalyzer').get('openaiApiKey');
  if (typeof config_key === 'string' && config_key.trim().length > 0) {
    return config_key.trim();
  }

  return undefined;
}

async function writeReportToWorkspace(md_text: string): Promise<vscode.Uri> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  const base_uri = workspace?.uri ?? vscode.Uri.file(process.cwd());
  const file_name = `curl_analyzer_report_${timestampForFilename()}.md`;
  const report_uri = vscode.Uri.joinPath(base_uri, file_name);
  await vscode.workspace.fs.writeFile(report_uri, Buffer.from(md_text, 'utf8'));
  return report_uri;
}

function timestampForFilename(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

