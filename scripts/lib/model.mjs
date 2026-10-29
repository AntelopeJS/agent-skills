/**
 * Model-backed side of the evals. A backend is any object with
 * `complete({ system, user, schema?, effort?, maxTokens? }) => Promise<string>`;
 * the built-in one calls the Anthropic Messages API through the official SDK,
 * loaded only when a model-backed eval actually runs.
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

export function modelFromEnv(env = process.env) {
  return env.EVAL_MODEL || DEFAULT_MODEL;
}

export function hasCredentials(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}

export function triggerRequest(skills, prompt) {
  const listing = skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");
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

/** `(prompt) => Promise<skillNames>` backed by a model. */
export function createModelPicker(backend, skills) {
  return async (prompt) => {
    const text = await backend.complete(triggerRequest(skills, prompt));
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.skills)
      ? parsed.skills.filter((name) => typeof name === "string")
      : [];
  };
}

async function defaultClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

function requestParams(
  model,
  { system, user, schema, effort, maxTokens = DEFAULT_MAX_TOKENS },
) {
  const outputConfig = {
    ...(schema ? { format: { type: "json_schema", schema } } : {}),
    ...(effort && EFFORT_MODELS.has(model) ? { effort } : {}),
  };
  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    ...(Object.keys(outputConfig).length
      ? { output_config: outputConfig }
      : {}),
    ...(DEFAULT_FALLBACK_MODELS.has(model)
      ? { betas: [FALLBACK_BETA], fallbacks: "default" }
      : {}),
  };
}

export function createAnthropicBackend({
  model = modelFromEnv(),
  client,
} = {}) {
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
