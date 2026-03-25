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
exports.AnalyzeCurlCodeActionProvider = void 0;
const vscode = __importStar(require("vscode"));
const analyze_curl_1 = require("./analyze_curl");
const DIAGNOSTICS_OWNER = 'curlDoctor';
class AnalyzeCurlCodeActionProvider {
    static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
    provideCodeActions(document, _range, context, _token) {
        const curl_diagnostics = context.diagnostics.filter((d) => d.source === DIAGNOSTICS_OWNER);
        if (curl_diagnostics.length === 0) {
            return [];
        }
        const doc_text = document.getText();
        if (!doc_text.includes('curl')) {
            return [];
        }
        const analysis = (0, analyze_curl_1.analyzeCurl)(doc_text);
        const actions = [];
        for (const issue of analysis.issues) {
            if (!issue.suggested_fix)
                continue;
            const action = new vscode.CodeAction(issue.suggested_fix.title, vscode.CodeActionKind.QuickFix);
            action.diagnostics = curl_diagnostics.filter((d) => String(d.code) === issue.code);
            const edit = new vscode.WorkspaceEdit();
            const full_range = new vscode.Range(document.positionAt(0), document.positionAt(doc_text.length));
            edit.replace(document.uri, full_range, issue.suggested_fix.replacement_curl);
            action.edit = edit;
            actions.push(action);
        }
        return actions;
    }
}
exports.AnalyzeCurlCodeActionProvider = AnalyzeCurlCodeActionProvider;
