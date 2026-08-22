import { BadRequestException, Injectable } from '@nestjs/common'
import { OpenAI } from 'openai'

import {
  OPENAI_API_KEY,
  OPENAI_API_VERSION,
  OPENAI_BASE_URL,
  OPENAI_GPT_MODEL
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

    return this.getClient().chat.completions.create({
      model: OPENAI_GPT_MODEL,
      ...sampling,
      stream: false,
      ...request
    })
  }
}
