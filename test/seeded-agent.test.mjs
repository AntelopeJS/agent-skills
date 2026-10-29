import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  VERDICT_SCHEMA,
  agentEnv,
  agentInvocation,
  buildPrompt,
  createAgentHome,
  parseAgentOutput,
  removeAgentHome,
  runAgent,
  withoutCredentials,
} from "../scripts/lib/seeded-agent.mjs";
import { exists } from "./helpers/read.mjs";

const SCRATCH = { dir: "/nowhere", baseSha: "abc123" };
const HOME = {
  home: "/tmp/agent/home",
  config: "/tmp/agent/claude",
  tmp: "/tmp/agent/tmp",
};
const REPLY = {
  structured_output: {
    result: "FAIL",
    failedFeatures: ["alpha"],
    notRun: ["beta/x"],
    passed: ["alpha/y"],
    doors: [],
    summary: "s",
  },
  total_cost_usd: 0.25,
  duration_ms: 1200,
  num_turns: 9,
  usage: {
    input_tokens: 5,
    output_tokens: 7,
    cache_read_input_tokens: 11,
    cache_creation_input_tokens: 13,
  },
  modelUsage: { "claude-sonnet-5-5": {} },
};

test("the agent gets neither a GitHub or SSH credential nor the caller's other variables", () => {
  const env = agentEnv({
    agentHome: HOME,
    env: {
      PATH: "/bin",
      GH_TOKEN: "x",
      GITHUB_TOKEN: "x",
      GH_PAT_ADMINISTRATION: "x",
      SSH_AUTH_SOCK: "/s",
      NPM_TOKEN: "x",
      ANTHROPIC_API_KEY: "x",
      CLAUDE_CODE_SESSION_ID: "x",
      HOME: "/home/real",
      MY_OTHER: "x",
    },
  });

  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, HOME.home);
  assert.equal(env.CLAUDE_CONFIG_DIR, HOME.config);
  assert.equal(env.TMPDIR, HOME.tmp);
  assert.equal(env.DMS_CONTROL_RUNS, "/tmp/agent/tmp/dms-control");
  assert.deepEqual(
    Object.keys(env).filter((name) =>
      /TOKEN|SSH|GH_|ANTHROPIC|SESSION|MY_OTHER/.test(name),
    ),
    [],
  );
});

test("an env var the caller lists is passed, and the XDG cache stays the caller's", () => {
  const env = agentEnv({
    agentHome: HOME,
    env: { PATH: "/bin", XDG_CACHE_HOME: "/cache", KEEP_ME: "1" },
    passEnv: ["KEEP_ME"],
  });

  assert.equal(env.KEEP_ME, "1");
  assert.equal(env.XDG_CACHE_HOME, "/cache");
});

test("a cache home replaces the caller's XDG cache", () => {
  const env = agentEnv({
    agentHome: HOME,
    env: { PATH: "/bin", XDG_CACHE_HOME: "/cache" },
    cacheHome: "/dedicated",
  });

  assert.equal(env.XDG_CACHE_HOME, "/dedicated");
});

test("withoutCredentials drops tokens and session variables but keeps HOME and PATH", () => {
  const env = withoutCredentials({
    HOME: "/h",
    PATH: "/bin",
    GH_TOKEN: "x",
    SSH_AUTH_SOCK: "/s",
    AI_AGENT: "x",
    CLAUDE_PID: "1",
    API_SECRET: "x",
  });

  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"]);
});

test("the config home links only the login and is removed whole", () => {
  const source = createAgentHome();
  const { config, dir, tmp } = source;
  assert.equal(exists(join(config, "settings.json")), false);
  assert.equal(exists(join(config, "CLAUDE.md")), false);
  removeAgentHome(source);
  assert.equal(exists(dir), false);
  assert.equal(exists(tmp), false);
});

test("the headless call is pinned, tool-limited, budget-capped and returns the verdict schema", () => {
  const { args, input } = agentInvocation({
    prompt: "go",
    model: "claude-sonnet-5-5",
    effort: "medium",
    maxBudget: 3,
  });
  const after = (flag) => args[args.indexOf(flag) + 1];

  assert.equal(input, "go");
  assert.equal(after("--model"), "claude-sonnet-5-5");
  assert.equal(after("--effort"), "medium");
  assert.equal(after("--tools"), "Bash,Read,Grep,Glob");
  assert.equal(after("--allowedTools"), "Bash,Read,Grep,Glob");
  assert.equal(after("--max-budget-usd"), "3");
  assert.equal(after("--setting-sources"), "");
  assert.deepEqual(JSON.parse(after("--json-schema")), VERDICT_SCHEMA);
  for (const flag of [
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--no-session-persistence",
  ])
    assert.ok(args.includes(flag));
});

test("the prompt names the skill and the base, forbids publishing, and does not name the feature", () => {
  const prompt = buildPrompt({ skill: "verify-demo", baseSha: "abc123" });

  assert.match(prompt, /\.agents\/skills\/verify-demo\/SKILL\.md/);
  assert.match(prompt, /abc123/);
  assert.match(prompt, /Never run the skill's publish step/);
});

test("the output gives the verdict, cost, tokens and models", () => {
  const parsed = parseAgentOutput(JSON.stringify(REPLY));

  assert.equal(parsed.verdict.result, "FAIL");
  assert.deepEqual(parsed.verdict.failedFeatures, ["alpha"]);
  assert.deepEqual(parsed.verdict.notRun, ["beta/x"]);
  assert.deepEqual(parsed.verdict.passed, ["alpha/y"]);
  assert.equal(parsed.costUsd, 0.25);
  assert.equal(parsed.turns, 9);
  assert.deepEqual(parsed.tokens, {
    input: 5,
    output: 7,
    cacheRead: 11,
    cacheWrite: 13,
  });
  assert.deepEqual(parsed.models, ["claude-sonnet-5-5"]);
});

test("an error reply, a missing structured verdict and an unknown result give no verdict", () => {
  const bad = (reply) => parseAgentOutput(JSON.stringify(reply));

  assert.equal(bad({ is_error: true, result: "budget" }).verdict, undefined);
  assert.match(bad({ is_error: true, result: "budget" }).error, /budget/);
  assert.equal(bad({ result: "text only" }).verdict, undefined);
  assert.equal(
    bad({ structured_output: { ...REPLY.structured_output, result: "MAYBE" } })
      .verdict,
    undefined,
  );
  const { notRun: _omitted, ...withoutNotRun } = REPLY.structured_output;
  assert.equal(bad({ structured_output: withoutNotRun }).verdict, undefined);
  assert.match(parseAgentOutput("not json").error, /no JSON/);
});

test("a run that times out reports it, whatever it printed", async () => {
  const run = async () => {
    throw Object.assign(new Error("killed"), {
      stdout: JSON.stringify(REPLY),
      timedOut: true,
    });
  };

  const outcome = await runAgent({
    scratch: SCRATCH,
    skill: "verify-demo",
    agentHome: HOME,
    timeoutSeconds: 7,
    run,
  });

  assert.equal(outcome.verdict, undefined);
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.error, "timed out after 7 s");
});

test("the run is a process group in the scratch checkout with the capped wall time", async () => {
  const calls = [];
  const run = async (call) => {
    calls.push(call);
    return { stdout: JSON.stringify(REPLY) };
  };

  const outcome = await runAgent({
    scratch: SCRATCH,
    skill: "verify-demo",
    agentHome: HOME,
    timeoutSeconds: 7,
    run,
  });

  assert.equal(outcome.verdict.result, "FAIL");
  assert.equal(calls[0].cwd, "/nowhere");
  assert.equal(calls[0].group, true);
  assert.equal(calls[0].timeoutMs, 7000);
  assert.equal(calls[0].env.HOME, HOME.home);
});
