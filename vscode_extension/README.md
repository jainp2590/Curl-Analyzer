# Curl Analyzer (VS Code Extension)

Paste a cURL command and get:
- problems/diagnostics for common breakages (URL, headers, JSON body, method/body mismatch)
- quick fixes that rewrite the cURL
- an RCA markdown report (heuristic, or OpenAI-powered when configured)

## Run locally

```bash
npm i
npm run build
```

Then open this folder in VS Code and press `F5` to launch an Extension Development Host.

## Use

Run command `Curl Analyzer: Analyze cURL` and paste a cURL.

## OpenAI RCA (optional)

- **Preferred**: set env var `OPENAI_API_KEY` for the Extension Development Host.
- **Alternative**: VS Code setting `curlAnalyzer.openaiApiKey`
- **Model**: `curlAnalyzer.openaiModel` (default `gpt-4.1-mini`)
- **Toggle**: `curlAnalyzer.useOpenAiRca`

