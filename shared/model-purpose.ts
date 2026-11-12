/** Explicit metadata wins over an ambiguous ID; clear non-chat IDs are a fallback. */
export type ModelPurpose =
  | "chat"
  | "embedding"
  | "rerank"
  | "image"
  | "audio"
  | "other"
  | "unknown";
export function modelPurpose(
  id: string,
  data: Record<string, any> = {},
): ModelPurpose {
  const tasks = [
    data.task,
    data.type,
    data.model_type,
    data.pipeline_tag,
    ...(Array.isArray(data.tasks) ? data.tasks : []),
  ]
    .filter((v) => typeof v === "string")
    .map((v) => v.toLowerCase().replaceAll("_", "-"));
  const flags = data.capabilities;
  if (
    tasks.some((v) =>
      /^(chat|conversation|text-generation|text2text-generation)$/.test(v),
    ) ||
    flags?.chat === true
  )
    return "chat";
  if (
    tasks.some((v) =>
      /^(embedding|embeddings|text-embedding|feature-extraction|sentence-similarity)$/.test(
        v,
      ),
    ) ||
    flags?.embeddings === true
  )
    return "embedding";
  if (
    tasks.some((v) => /^(rerank|reranker|reranking|text-ranking)$/.test(v)) ||
    flags?.reranking === true
  )
    return "rerank";
  if (tasks.some((v) => /^(image-generation|text-to-image)$/.test(v)))
    return "image";
  if (
    tasks.some((v) =>
      /^(text-to-speech|speech-to-text|automatic-speech-recognition|transcription)$/.test(
        v,
      ),
    )
  )
    return "audio";
  const name = id.toLowerCase().split("/").at(-1)!;
  if (/(?:^|[-_.])(?:rerank(?:er|ing)?)(?:$|[-_.])/.test(name)) return "rerank";
  if (
    /(?:^|[-_.])(?:embed(?:ding|dings)?)(?:$|[-_.])/.test(name) ||
    /^(?:bge|e5|gte)(?:-|_|$)/.test(name)
  )
    return "embedding";
  if (/^(?:dall-e|stable-diffusion|flux[-.]|imagen[-.]|gpt-image)/.test(name))
    return "image";
  if (
    /^(?:whisper|tts[-.]|sora[-.]|text-moderation|omni-moderation)/.test(name)
  )
    return "other";
  return "unknown";
}
export const chatCandidate = (purpose: ModelPurpose) =>
  purpose === "chat" || purpose === "unknown";
export type ModelDescriptor = {
  id: string;
  purpose: ModelPurpose;
  contextWindow?: number;
  reasoning?: string[];
};
export function modelDescriptor(
  id: string,
  data: Record<string, any> = {},
): ModelDescriptor {
  const context = Number(
    data.context_window ?? data.context_length ?? data.max_model_len,
  );
  return {
    id,
    purpose: modelPurpose(id, data),
    ...(Number.isSafeInteger(context) && context >= 1024 && context <= 10000000
      ? { contextWindow: context }
      : {}),
    ...(Array.isArray(data.supported_reasoning_levels)
      ? {
          reasoning: data.supported_reasoning_levels
            .map((v: any) => v.effort)
            .filter((v: any) => typeof v === "string"),
        }
      : {}),
  };
}
