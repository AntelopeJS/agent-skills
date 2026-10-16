import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createAnthropicBackend,
  createModelPicker,
  triggerRequest,
  answerRequest,
  DEFAULT_MODEL,
  modelFromEnv,
} from "../scripts/lib/model.mjs";

const SKILLS = [
  { name: "dms-pages", description: "Declares admin pages.", content: "SECRET BODY OF DMS-PAGES" },
  { name: "dms-mailing", description: "Sends e-mail templates.", content: "SECRET BODY OF DMS-MAILING" },
];

function stubClient(reply) {
  const calls = [];
  const create = async (params) => {
    calls.push(params);
    return typeof reply === "function" ? reply(params) : reply;
  };
  return { calls, client: { beta: { messages: { create } } } };
}

const textReply = (text) => ({ stop_reason: "end_turn", model: DEFAULT_MODEL, content: [{ type: "text", text }] });

test("the trigger request shows only skill names and descriptions, like the harness", () => {
  const { system, user, schema } = triggerRequest(SKILLS, "add an orders table");

  assert.match(system, /dms-pages: Declares admin pages\./);
  assert.doesNotMatch(system, /SECRET BODY/);
  assert.equal(user, "add an orders table");
  assert.deepEqual(schema.properties.skills.items.enum, ["dms-pages", "dms-mailing"]);
});

test("the answer request loads the full skill bodies", () => {
  const { system } = answerRequest([SKILLS[0]], "add an orders table");

  assert.match(system, /SECRET BODY OF DMS-PAGES/);
  assert.doesNotMatch(system, /DMS-MAILING/);
});

test("the model picker returns the skills the backend chose", async () => {
  const backend = { complete: async () => '{"skills":["dms-mailing"]}' };

  const pick = createModelPicker(backend, SKILLS);

  assert.deepEqual(await pick("send the welcome mail"), ["dms-mailing"]);
});

test("the Anthropic backend sends structured output, low effort and the default fallback", async () => {
  const { calls, client } = stubClient(textReply('{"skills":[]}'));
  const backend = createAnthropicBackend({ model: DEFAULT_MODEL, client });

  const text = await backend.complete({ ...triggerRequest(SKILLS, "hi"), effort: "low", maxTokens: 1024 });

  assert.equal(text, '{"skills":[]}');
  const [params] = calls;
  assert.equal(params.model, DEFAULT_MODEL);
  assert.equal(params.output_config.format.type, "json_schema");
  assert.equal(params.output_config.effort, "low");
  assert.equal(params.fallbacks, "default");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(params.messages, [{ role: "user", content: "hi" }]);
});

test("models without effort or server-side fallback get neither", async () => {
  const { calls, client } = stubClient(textReply("ok"));
  const backend = createAnthropicBackend({ model: "claude-haiku-4-5", client });

  await backend.complete({ system: "s", user: "u", effort: "low", maxTokens: 10 });

  assert.equal(calls[0].fallbacks, undefined);
  assert.equal(calls[0].output_config, undefined);
  assert.equal(calls[0].betas, undefined);
});

test("a refusal surfaces as an error", async () => {
  const { client } = stubClient({ stop_reason: "refusal", content: [] });
  const backend = createAnthropicBackend({ model: DEFAULT_MODEL, client });

  await assert.rejects(backend.complete({ system: "s", user: "u" }), /refus/);
});

test("the model comes from EVAL_MODEL, else the default", () => {
  assert.equal(modelFromEnv({}), DEFAULT_MODEL);
  assert.equal(modelFromEnv({ EVAL_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5");
});
