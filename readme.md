# Curl Analyzer (VS Code Extension)

Curl Analyzer helps you debug failing cURL commands.

It can:
- analyze a pasted cURL for common mistakes
- run the cURL and classify where it failed (DNS, connect, TLS, HTTP, etc.)
- generate an RCA with a confidence score and a suggested fix
- write a markdown report into your workspace
- optionally use OpenAI for a better RCA (with redaction applied)

## How it works

- **Input**: you paste a cURL command.
- **Static checks**: parses method, URL, headers, body and flags common breakages.
- **Execution**: runs `curl` with `-v -s -S` and a timeout and captures stdout/stderr.
- **RCA**:
  - **Heuristic**: uses exit codes + verbose output patterns, or
  - **OpenAI (optional)**: sends redacted evidence to OpenAI and merges the model RCA.
- **Output**: saves a report file like `curl_analyzer_report_YYYYMMDD_HHMMSS.md`.

## Run locally (Extension Development Host)

```bash
npm i
npm run build
```

Then open this repo in VS Code and press `F5`.

## Use

Run the command:
- `Curl Analyzer: Analyze cURL`

Paste a cURL command (or select it in the editor before running the command).

## Output

The extension writes a report to your workspace root:
- `curl_analyzer_report_YYYYMMDD_HHMMSS.md`

It also prints a summary to the `Curl Analyzer` output channel.

## Supported file types

Quick fixes are registered for:
- Python
- JavaScript
- TypeScript

## OpenAI RCA (optional)

If an API key is available, Curl Analyzer can ask OpenAI to produce a richer RCA.

### Configuration

- **Preferred**: set `OPENAI_API_KEY` in the Extension Development Host environment
- **Alternative**: VS Code setting `curlAnalyzer.openaiApiKey`
- **Model**: `curlAnalyzer.openaiModel` (default `gpt-4.1-mini`)
- **Toggle**: `curlAnalyzer.useOpenAiRca` (default `true`)

### Sensitive data

Before sending anything to OpenAI, Curl Analyzer redacts common secrets from:
- the cURL text
- stderr/stdout
- static analysis strings

Redaction includes (heuristic):
- `Authorization`, `Cookie`, `X-API-Key` / `Api-Key` header values
- `Bearer ...` tokens
- `-u/--user` and `--proxy-user` credentials
- common secret query params (`token`, `access_token`, `api_key`, `password`, etc.)
- common JSON keys (`password`, `token`, `secret`, `private_key`, etc.)

If you also want the local markdown report to be redacted, tell me and I’ll apply the
same redaction before writing the `.md` file.

## Notes / limitations

- The extension currently treats the pasted input as a single cURL command.
- The report includes truncated stdout/stderr to avoid huge files.

## Contributing

If you’d like to contribute:

- **Fork** this repo on GitHub
- **Create a branch** in your fork (e.g. `feature/better-rca` or `fix/redaction-edge-case`)
- **Make changes** and add/update docs as needed
- **Open a Pull Request** back to this repository with:
  - what you changed and why
  - how you tested it (example cURL + expected outcome)

## Issues

If you find a bug or want a feature:

- **Open an issue** on GitHub describing:
  - what you ran (redact secrets first)
  - what happened vs what you expected
  - your OS and VS Code version
  - the generated report file (`curl_analyzer_report_*.md`) if it helps (redact if needed)

