import { describe, expect, it } from "vitest";
import { buildLogprobsProbeSummary, findLogprobLikeFields, runOpenAiApiBaselineProbe, type CodexSdkRunProbe, type CodexSdkStreamProbe, type OpenAiApiBaselineProbe } from "../src/probes/logprobsProbe.js";

function codexRun(conclusion: CodexSdkRunProbe["conclusion"], key = "logprobs"): CodexSdkRunProbe {
  return {
    ran: true,
    logprobLikeFieldsFound:
      conclusion === "available"
        ? [{ path: "$.choices[0].logprobs", key, keyword: key, valueType: "object" }]
        : [],
    resultKeys: [],
    conclusion
  };
}

function codexStream(conclusion: CodexSdkStreamProbe["conclusion"], key = "logprobs"): CodexSdkStreamProbe {
  return {
    ran: true,
    eventTypes: [],
    logprobLikeFieldsFound:
      conclusion === "available"
        ? [{ path: "$[0].logprobs", key, keyword: key, valueType: "object" }]
        : [],
    conclusion
  };
}

function baseline(logprobsAvailable: boolean): OpenAiApiBaselineProbe {
  return {
    ran: true,
    logprobsAvailable,
    topLogprobsAvailable: logprobsAvailable,
    conclusion: logprobsAvailable ? "available" : "unsupported"
  };
}

describe("logprobs probe scanners", () => {
  it("finds nested logprobs keys", () => {
    const matches = findLogprobLikeFields({
      response: {
        choices: [
          {
            message: {
              logprobs: {
                content: [{ token: "research", log_prob: -0.1, top_logprobs: [{ token: "research", logprob: -0.1 }] }]
              }
            }
          }
        ]
      }
    });

    expect(matches.map((match) => match.key)).toEqual(expect.arrayContaining(["logprobs", "log_prob", "top_logprobs", "token"]));
    expect(matches.some((match) => match.path === "$.response.choices[0].message.logprobs")).toBe(true);
  });

  it("returns empty when no keys match", () => {
    const matches = findLogprobLikeFields({ route: "research", usage: { input: 10, output: 2 } });

    expect(matches).toEqual([]);
  });
});

describe("logprobs probe summary strategy", () => {
  it("chooses codex_logprobs when Codex fields exist", () => {
    const summary = buildLogprobsProbeSummary({
      codexSdkRun: codexRun("available"),
      codexSdkStream: codexStream("not_found"),
      openaiApiBaseline: baseline(false)
    });

    expect(summary.codexSdkLogprobsAvailable).toBe(true);
    expect(summary.recommendedRouterConfidenceStrategy).toBe("codex_logprobs");
  });

  it("chooses openai_api_route_head when only API baseline has logprobs", () => {
    const summary = buildLogprobsProbeSummary({
      codexSdkRun: codexRun("not_found"),
      codexSdkStream: codexStream("not_found"),
      openaiApiBaseline: baseline(true)
    });

    expect(summary.codexSdkLogprobsAvailable).toBe(false);
    expect(summary.openaiApiBaselineLogprobsAvailable).toBe(true);
    expect(summary.recommendedRouterConfidenceStrategy).toBe("openai_api_route_head");
  });

  it("chooses stability_only when neither source has logprobs", () => {
    const summary = buildLogprobsProbeSummary({
      codexSdkRun: codexRun("not_found"),
      codexSdkStream: codexStream("not_found"),
      openaiApiBaseline: baseline(false)
    });

    expect(summary.codexSdkLogprobsAvailable).toBe(false);
    expect(summary.openaiApiBaselineLogprobsAvailable).toBe(false);
    expect(summary.recommendedRouterConfidenceStrategy).toBe("stability_only");
  });
});

describe("OpenAI API baseline probe", () => {
  it("does not fail when OPENAI_API_KEY is not set", async () => {
    const result = await runOpenAiApiBaselineProbe(process.cwd(), {
      env: {},
      fetchImpl: (() => {
        throw new Error("fetch should not be called without OPENAI_API_KEY");
      }) as typeof fetch
    });

    expect(result).toEqual({
      ran: false,
      reason: "OPENAI_API_KEY not set",
      conclusion: "not_tested"
    });
  });
});
