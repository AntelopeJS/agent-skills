import { isRecord, isText } from "./values.mjs";

/** @typedef {import("./model.mjs").ModelRequest} ModelRequest */
/** @typedef {import("./model.mjs").ModelBackend} ModelBackend */
/** @typedef {import("./model.mjs").Effort} Effort */

/**
 * The body of a Responses API call.
 * @typedef {object} OpenAIParams
 * @property {string} model
 * @property {string} instructions
 * @property {string} input
 * @property {number} max_output_tokens
 * @property {{ effort: Effort }} [reasoning]
 * @property {{ format: { type: "json_schema", name: "answer", schema: Record<string, unknown>, strict: true } }} [text]
 */

/**
 * The part of the `Response` of `fetch` the backend reads.
 * @typedef {object} OpenAIHttpResponse
 * @property {boolean} ok
 * @property {number} status
 * @property {() => Promise<unknown>} json
 */

/**
 * The `fetch` the backend calls.
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<OpenAIHttpResponse>} OpenAIFetch
 */

export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 16000;

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function openaiModelFromEnv(env = process.env) {
  return env.EVAL_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function hasOpenAICredentials(env = process.env) {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * @param {string} model
 * @param {ModelRequest} request
 * @returns {OpenAIParams}
 */
export function openaiParams(
  model,
  { system, user, schema, effort, maxTokens = DEFAULT_MAX_TOKENS },
) {
  /** @type {OpenAIParams} */
  const params = {
    model,
    instructions: system,
    input: user,
    max_output_tokens: maxTokens,
  };
  if (effort) params.reasoning = { effort };
  if (schema)
    params.text = {
      format: { type: "json_schema", name: "answer", schema, strict: true },
    };
  return params;
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} response
 * @returns {string}
 */
function outputText(response) {
  if (!isRecord(response)) return "";
  if (isText(response.output_text) && response.output_text)
    return response.output_text;
  return listOf(response.output)
    .flatMap((item) => (isRecord(item) ? listOf(item.content) : []))
    .flatMap((part) =>
      isRecord(part) && part.type === "output_text" ? [part.text] : [],
    )
    .join("");
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function errorMessage(body) {
  const error = isRecord(body) ? body.error : undefined;
  return isRecord(error) && isText(error.message)
    ? error.message
    : "request failed";
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function incompleteReason(body) {
  const details = isRecord(body) ? body.incomplete_details : undefined;
  return isRecord(details) && isText(details.reason)
    ? details.reason
    : "unknown";
}

/**
 * A backend over the OpenAI Responses API, called with `fetch` so the plugin
 * adds no dependency. It reads `OPENAI_API_KEY` unless `apiKey` is given.
 */
/**
 * @param {{ model?: string, apiKey?: string, baseUrl?: string, fetchImpl?: OpenAIFetch }} [options]
 * @returns {ModelBackend}
 */
export function createOpenAIBackend({
  model = openaiModelFromEnv(),
  apiKey = process.env.OPENAI_API_KEY,
  baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch,
} = {}) {
  return {
    name: `openai (${model})`,
    async complete(request) {
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      const response = await fetchImpl(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(openaiParams(model, request)),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(`OpenAI ${response.status}: ${errorMessage(body)}`);
      if (isRecord(body) && body.status === "incomplete")
        throw new Error(`OpenAI stopped early (${incompleteReason(body)})`);
      return outputText(body);
    },
  };
}
