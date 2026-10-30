/**
 * Model-backed side of the evals. A backend is any object with
 * `complete({ system, user, schema?, effort?, maxTokens? }) => Promise<string>`;
 * the built-in one calls the Anthropic Messages API through the official SDK,
 * loaded only when a model-backed eval actually runs.
 */

import { isText } from "./values.mjs";

/** @typedef {"low" | "medium" | "high" | "xhigh" | "max"} Effort */

/**
 * A skill as the requests show it: its name and description to a trigger
 * request, its body to an answers request.
 * @typedef {object} RequestSkill
 * @property {string} name
 * @property {string} description
 * @property {string} content
 */

/**
 * One call to a model: a system text, the user text and, optionally, a JSON
 * schema the reply must follow, a reasoning effort and a token cap.
 * @typedef {object} ModelRequest
 * @property {string} system
 * @property {string} user
 * @property {Record<string, unknown>} [schema]
 * @property {Effort} [effort]
 * @property {number} [maxTokens]
 */

/**
 * The schema of a trigger reply: `{ "skills": [...] }` over the corpus skill names.
 * @typedef {object} TriggerSchema
 * @property {"object"} type
 * @property {{ skills: { type: "array", items: { type: "string", enum: string[] } } }} properties
 * @property {string[]} required
 * @property {false} additionalProperties
 */

/** @typedef {ModelRequest & { schema: TriggerSchema }} TriggerRequest */

/**
 * A model backend: answers a request with the reply text.
 * @typedef {object} ModelBackend
 * @property {string} [name]
 * @property {(request: ModelRequest) => Promise<string>} complete
 */

/**
 * Picks the skills a model would load for a prompt.
 * @typedef {(prompt: string) => Promise<string[]>} SkillPicker
 */

/**
 * The body of a `beta.messages.create` call.
 * @typedef {object} AnthropicParams
 * @property {string} model
 * @property {number} max_tokens
 * @property {string} system
 * @property {{ role: "user", content: string }[]} messages
 * @property {AnthropicOutputConfig} [output_config]
 * @property {string[]} [betas]
 * @property {"default"} [fallbacks]
 */

/**
 * @typedef {object} AnthropicOutputConfig
 * @property {{ type: "json_schema", schema: Record<string, unknown> }} [format]
 * @property {Effort} [effort]
 */

/**
 * The part of a Messages API reply the backend reads.
 * @typedef {object} AnthropicReply
 * @property {string | null} [stop_reason]
 * @property {{ category?: string | null } | null} [stop_details]
 * @property {{ type: string, text?: string }[]} content
 */

/**
 * The part of the Anthropic SDK client the backend calls.
 * @typedef {object} AnthropicClient
 * @property {{ messages: { create: (params: AnthropicParams) => Promise<AnthropicReply> } }} beta
 */

export const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_MAX_TOKENS = 16000;
const TRIGGER_MAX_TOKENS = 4096;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const DEFAULT_FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const EFFORT_MODELS = new Set([
  ...DEFAULT_FALLBACK_MODELS,
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-5-5",
]);

const TRIGGER_SYSTEM = `You are a coding agent working in a user's AntelopeJS project. Skills are
packaged instructions you can load before acting; only their names and descriptions
are in your context until you load one. Decide which skills you would load before
handling the user's next request: every skill whose description covers the request,
and no other. Reply with the list of skill names (an empty list when none applies).

Available skills:
`;

const ANSWER_SYSTEM = `You are a coding agent working in a user's AntelopeJS project. The skills
below are loaded; follow them. Handle the user's request as you would in the project:
explain briefly and write the code it needs, with its imports.
`;

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function modelFromEnv(env = process.env) {
  return env.EVAL_MODEL || DEFAULT_MODEL;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function hasCredentials(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * @param {RequestSkill[]} skills
 * @param {string} prompt
 * @returns {TriggerRequest}
 */
export function triggerRequest(skills, prompt) {
  const listing = skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");
  /** @type {TriggerSchema} */
  const schema = {
    type: "object",
    properties: {
      skills: {
        type: "array",
        items: { type: "string", enum: skills.map((skill) => skill.name) },
      },
    },
    required: ["skills"],
    additionalProperties: false,
  };
  return {
    system: `${TRIGGER_SYSTEM}${listing}\n`,
    user: prompt,
    schema,
    effort: "low",
    maxTokens: TRIGGER_MAX_TOKENS,
  };
}

/**
 * @param {RequestSkill[]} skills
 * @param {string} prompt
 * @returns {ModelRequest}
 */
export function answerRequest(skills, prompt) {
  const loaded = skills
    .map(
      (skill) =>
        `<skill name="${skill.name}">\n${skill.content.trim()}\n</skill>`,
    )
    .join("\n\n");
  return {
    system: `${ANSWER_SYSTEM}\n${loaded}\n`,
    user: prompt,
    effort: "medium",
  };
}

/**
 * `(prompt) => Promise<skillNames>` backed by a model.
 * @param {ModelBackend} backend
 * @param {RequestSkill[]} skills
 * @returns {SkillPicker}
 */
export function createModelPicker(backend, skills) {
  return async (prompt) => {
    const text = await backend.complete(triggerRequest(skills, prompt));
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.skills) ? parsed.skills.filter(isText) : [];
  };
}

/** @returns {Promise<AnthropicClient>} */
async function defaultClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

/**
 * @param {string} model
 * @param {ModelRequest} request
 * @returns {AnthropicParams}
 */
function requestParams(
  model,
  { system, user, schema, effort, maxTokens = DEFAULT_MAX_TOKENS },
) {
  /** @type {AnthropicOutputConfig} */
  const outputConfig = {};
  if (schema) outputConfig.format = { type: "json_schema", schema };
  if (effort && EFFORT_MODELS.has(model)) outputConfig.effort = effort;
  /** @type {AnthropicParams} */
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;
  if (DEFAULT_FALLBACK_MODELS.has(model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }
  return params;
}

/**
 * @param {{ model?: string, client?: AnthropicClient }} [options]
 * @returns {ModelBackend}
 */
export function createAnthropicBackend({
  model = modelFromEnv(),
  client,
} = {}) {
  /** @type {Promise<AnthropicClient> | null} */
  let ready = client ? Promise.resolve(client) : null;
  return {
    name: `anthropic (${model})`,
    async complete(request) {
      ready ??= defaultClient();
      const response = await (
        await ready
      ).beta.messages.create(requestParams(model, request));
      if (response.stop_reason === "refusal")
        throw new Error(
          `the model refused (${response.stop_details?.category ?? "no category"})`,
        );
      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    },
  };
}
