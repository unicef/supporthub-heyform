import { BadRequestException, Injectable } from '@nestjs/common'
import { OpenAI } from 'openai'

import {
  OPENAI_API_KEY,
  OPENAI_API_VERSION,
  OPENAI_BASE_URL,
  OPENAI_GPT_MODEL,
  OPENAI_MAX_COMPLETION_TOKENS,
  OPENAI_REASONING_EFFORT,
  OPENAI_REQUEST_TIMEOUT_MS
} from '@environments'
import { helper } from '@heyform-inc/utils'

type ChatCompletionRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'model'
> & {
  model?: string
}

/**
 * Azure AI Model Inference and APIM gateways expect an `api-key` header and a
 * required `api-version` query param; the SDK sends a bearer token and no
 * version. Exported so `translate-form.queue.ts` builds its client the same way.
 */
export function openAIClientOptions() {
  const base = { apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL }
  if (helper.isEmpty(OPENAI_API_VERSION)) {
    return base
  }
  return {
    ...base,
    defaultHeaders: { 'api-key': OPENAI_API_KEY },
    defaultQuery: { 'api-version': OPENAI_API_VERSION }
  }
}

@Injectable()
export class OpenAIService {
  private client?: OpenAI

  private getClient(): OpenAI {
    if (helper.isEmpty(OPENAI_API_KEY)) {
      throw new BadRequestException('OpenAI API key is not configured')
    }

    if (!this.client) {
      this.client = new OpenAI(openAIClientOptions())
    }

    return this.client
  }

  async chatCompletion(request: ChatCompletionRequest) {
    // Sampling params are omitted on a gateway deployment: the gpt-5 family
    // rejects non-default temperature / top_p / penalties outright, and the
    // deployment owns its own defaults. SupportHub's own client sends none of
    // them for the same reason.
    const sampling = helper.isEmpty(OPENAI_API_VERSION)
      ? { temperature: 0, top_p: 1, frequency_penalty: 1, presence_penalty: 1 }
      : {}

    // `reasoning_effort` and `max_completion_tokens` both postdate openai@4.38.2
    // and so are absent from ChatCompletionCreateParams; the SDK forwards
    // unknown body keys verbatim, hence the single cast below rather than a
    // dependency bump. Both are latency controls — see @environments for why.
    const latency: Record<string, unknown> = {}
    if (OPENAI_REASONING_EFFORT !== 'none') {
      latency.reasoning_effort = OPENAI_REASONING_EFFORT
    }
    if (OPENAI_MAX_COMPLETION_TOKENS > 0) {
      latency.max_completion_tokens = OPENAI_MAX_COMPLETION_TOKENS
    }

    const body = {
      model: OPENAI_GPT_MODEL,
      ...sampling,
      ...latency,
      stream: false,
      ...request
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

    // Per-request rather than on the client, because `openAIClientOptions()` is
    // shared with `translate-form.queue.ts` — a background job that wants the
    // SDK's generous defaults (10 minutes, 2 retries). On a user-facing mutation
    // those defaults mean the browser has long given up while the completion
    // carries on being paid for, so this path gets one shot inside the window
    // the layers in front of it allow.
    return this.getClient().chat.completions.create(body, {
      timeout: OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    })
  }
}
