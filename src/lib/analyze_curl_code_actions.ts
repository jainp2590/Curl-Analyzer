import * as vscode from 'vscode';
import { analyzeCurl } from './analyze_curl';

const DIAGNOSTICS_OWNER = 'curlDoctor';

export class AnalyzeCurlCodeActionProvider implements vscode.CodeActionProvider<vscode.CodeAction> {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const curl_diagnostics = context.diagnostics.filter(
      (d) => d.source === DIAGNOSTICS_OWNER,
    );
    if (curl_diagnostics.length === 0) {
      return [];
    }

    const doc_text = document.getText();
    if (!doc_text.includes('curl')) {
      return [];
    }
    const analysis = analyzeCurl(doc_text);

    const actions: vscode.CodeAction[] = [];
    for (const issue of analysis.issues) {
      if (!issue.suggested_fix) continue;

      const action = new vscode.CodeAction(
        issue.suggested_fix.title,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = curl_diagnostics.filter((d) => String(d.code) === issue.code);

      const edit = new vscode.WorkspaceEdit();
      const full_range = new vscode.Range(
        document.positionAt(0),
        document.positionAt(doc_text.length),
      );
      edit.replace(document.uri, full_range, issue.suggested_fix.replacement_curl);
      action.edit = edit;
      actions.push(action);
    }

    return actions;
  }
}

