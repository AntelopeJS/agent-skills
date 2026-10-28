export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 16000;

export function openaiModelFromEnv(env = process.env) {
  return env.EVAL_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

export function hasOpenAICredentials(env = process.env) {
  return Boolean(env.OPENAI_API_KEY);
}

export function openaiParams(
  model,
  { system, user, schema, effort, maxTokens = DEFAULT_MAX_TOKENS },
) {
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

function outputText(response) {
  if (response.output_text) return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

/**
 * A backend over the OpenAI Responses API, called with `fetch` so the plugin
 * adds no dependency. It reads `OPENAI_API_KEY` unless `apiKey` is given.
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
        throw new Error(
          `OpenAI ${response.status}: ${body.error?.message ?? "request failed"}`,
        );
      if (body.status === "incomplete")
        throw new Error(
          `OpenAI stopped early (${body.incomplete_details?.reason ?? "unknown"})`,
        );
      return outputText(body);
    },
  };
}
