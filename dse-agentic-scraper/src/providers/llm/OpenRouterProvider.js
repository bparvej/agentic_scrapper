'use strict';

const OpenAIProvider = require('./OpenAIProvider');

/**
 * OpenRouter LLM provider.
 *
 * OpenRouter exposes an OpenAI-compatible API, so we simply extend
 * OpenAIProvider and override the base URL.
 *
 * Set in .env:
 *   LLM_PROVIDER=openrouter
 *   LLM_MODEL=openai/gpt-4o-mini
 *   LLM_API_KEY=your_openrouter_key
 */
class OpenRouterProvider extends OpenAIProvider {
  constructor(opts) {
    super({
      ...opts,
      baseURL: opts.baseURL || 'https://openrouter.ai/api/v1',
    });
  }

  get name() {
    return `openrouter:${this._model}`;
  }
}

module.exports = OpenRouterProvider;
