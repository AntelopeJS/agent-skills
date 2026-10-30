import { test } from "node:test";
import assert from "node:assert/strict";

import { createOpenAIBackend, openaiParams } from "../scripts/lib/openai.mjs";

/** @typedef {import("../scripts/lib/openai.mjs").OpenAIFetch} OpenAIFetch */

/**
 * @param {unknown} reply
 * @param {{ ok?: boolean, status?: number }} [outcome]
 */
function fakeFetch(reply, { ok = true, status = 200 } = {}) {
  /** @type {{ url: string, init: Parameters<OpenAIFetch>[1], body: unknown }[]} */
  const calls = [];
  /** @type {OpenAIFetch} */
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status, json: async () => reply };
  };
  return { impl, calls };
}

void test("the request carries the system text as instructions, the effort and a strict JSON schema", () => {
  const schema = { type: "object" };

  const params = openaiParams("gpt-6.1-sol", {
    system: "S",
    user: "U",
    schema,
    effort: "low",
  });

  assert.deepEqual(params, {
    model: "gpt-6.1-sol",
    instructions: "S",
    input: "U",
    max_output_tokens: 16000,
    reasoning: { effort: "low" },
    text: {
      format: { type: "json_schema", name: "answer", schema, strict: true },
    },
  });
});

void test("the backend posts to the Responses API with the bearer key and joins the output text parts", async () => {
  const { impl, calls } = fakeFetch({
    output: [
      { content: [{ type: "output_text", text: "Hel" }] },
      { content: [{ type: "output_text", text: "lo" }, { type: "refusal" }] },
    ],
  });
  const backend = createOpenAIBackend({
    model: "m",
    apiKey: "k",
    baseUrl: "https://example.test/v1",
    fetchImpl: impl,
  });

  const text = await backend.complete({ system: "s", user: "u" });

  assert.equal(text, "Hello");
  assert.equal(calls[0].url, "https://example.test/v1/responses");
  assert.equal(calls[0].init.headers.authorization, "Bearer k");
});

void test("an API error, an incomplete response and a missing key are all refused", async () => {
  const request = { system: "s", user: "u" };
  const failing = fakeFetch(
    { error: { message: "quota" } },
    { ok: false, status: 429 },
  );
  const cut = fakeFetch({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  });

  await assert.rejects(
    createOpenAIBackend({ apiKey: "k", fetchImpl: failing.impl }).complete(
      request,
    ),
    /OpenAI 429: quota/,
  );
  await assert.rejects(
    createOpenAIBackend({ apiKey: "k", fetchImpl: cut.impl }).complete(request),
    /max_output_tokens/,
  );
  await assert.rejects(
    createOpenAIBackend({ apiKey: "", fetchImpl: cut.impl }).complete(request),
    /OPENAI_API_KEY is not set/,
  );
});
