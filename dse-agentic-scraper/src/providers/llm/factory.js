'use strict';

const config = require('../../config');

/**
 * Create and return the configured LLM provider instance.
 *
 * The provider is a singleton — call factory() once and pass the result
 * through dependency injection rather than calling factory() everywhere.
 *
 * Reads LLM_PROVIDER from config:
 *   openai      → OpenAIProvider
 *   openrouter  → OpenRouterProvider
 *   mock        → MockProvider (default, no API key required)
 */
function createLLMProvider() {
  const providerName = config.llm.provider;

  switch (providerName) {
    case 'openai': {
      const OpenAIProvider = require('./OpenAIProvider');
      return new OpenAIProvider({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        baseURL: config.llm.apiBaseUrl || undefined,
      });
    }

    case 'openrouter': {
      const OpenRouterProvider = require('./OpenRouterProvider');
      return new OpenRouterProvider({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        baseURL: config.llm.apiBaseUrl || 'https://openrouter.ai/api/v1',
      });
    }

    case 'mock':
    default: {
      const MockProvider = require('./MockProvider');
      return new MockProvider();
    }
  }
}

let _instance = null;

/**
 * Get (or lazily create) the LLM provider singleton.
 * @returns {import('./LLMProvider')}
 */
function getLLMProvider() {
  if (!_instance) {
    _instance = createLLMProvider();
  }
  return _instance;
}

/**
 * Override the singleton (useful in tests).
 * @param {import('./LLMProvider')} provider
 */
function setLLMProvider(provider) {
  _instance = provider;
}

module.exports = { getLLMProvider, setLLMProvider, createLLMProvider };
