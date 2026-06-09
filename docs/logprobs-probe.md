# Logprobs Probe

`codex-hardflow probe-logprobs` checks whether the current hardflow path can observe token probability data from the pinned `@openai/codex-sdk` package and, when possible, from the ordinary OpenAI Chat Completions API.

The probe does not change hardflow router logic.

## Command

```bash
codex-hardflow probe-logprobs
```

The CLI prints only `.agent/reports/logprobs_probe_summary.json`. Large raw SDK/API payloads are written as sanitized report files instead.

## Reports

- `.agent/reports/logprobs_probe_static_scan.json`
  - Scans `node_modules/@openai/codex-sdk` text files, including `*.d.ts` and `*.js`, for logprob-like keywords.
  - Static matches are clues only. They do not prove runtime availability.
- `.agent/reports/logprobs_probe_codex_run.json`
  - Runs `thread.run()` with the prompt `Return exactly one word: research`.
  - Uses a minimal route output schema when supported by the SDK.
  - Saves the sanitized full result object, `finalResponse`, `items`, `usage`, top-level result keys, and recursive logprob-like field matches.
- `.agent/reports/logprobs_probe_codex_stream.json`
  - Runs `thread.runStreamed()` with the same prompt and schema.
  - Saves sanitized streamed events, event types, and recursive logprob-like field matches.
- `.agent/reports/logprobs_probe_openai_baseline.json`
  - Written only when `OPENAI_API_KEY` is set and the baseline request is attempted.
  - Calls Chat Completions with `logprobs=true` and `top_logprobs=3`.
- `.agent/reports/logprobs_probe_summary.json`
  - Final machine-readable conclusion.

## Summary Schema

```json
{
  "codexSdkLogprobsAvailable": true,
  "codexSdkRunLogprobsAvailable": true,
  "codexSdkStreamLogprobsAvailable": false,
  "openaiApiBaselineLogprobsAvailable": true,
  "recommendedRouterConfidenceStrategy": "codex_logprobs",
  "notes": []
}
```

Availability can be `true`, `false`, or `"unknown"` for Codex SDK checks. The OpenAI baseline can also be `"not_tested"` when `OPENAI_API_KEY` is absent.

## Strategy Selection

- `codex_logprobs`: selected when either Codex SDK runtime probe exposes a strong logprob-like field such as `logprobs`, `top_logprobs`, `log_prob`, `probability`, or `logits`.
- `openai_api_route_head`: selected when the Codex SDK probes do not expose logprobs but the OpenAI API baseline does.
- `stability_only`: selected when neither available runtime source exposes logprobs, or the baseline was not tested.

Generic token count fields such as `input_tokens` and `output_tokens` are recorded in `logprobLikeFieldsFound`, but they do not by themselves count as logprob availability.

## Safety

The probe sanitizes report payloads before writing them. It redacts common secret fields and any sensitive environment values such as API keys. It does not install or upgrade `@openai/codex-sdk`, the Codex CLI, or the OpenAI SDK.
