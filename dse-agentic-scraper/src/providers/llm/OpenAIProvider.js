'use strict';

const LLMProvider = require('./LLMProvider');
const logger = require('../../logging/logger');

/**
 * OpenAI LLM provider.
 *
 * Uses the official openai npm package.
 * Compatible with OpenAI API and any OpenAI-compatible endpoint
 * (e.g. OpenRouter, Azure OpenAI, local LM Studio).
 */
class OpenAIProvider extends LLMProvider {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.model
   * @param {string} [opts.baseURL] - Override for OpenRouter or Azure
   */
  constructor(opts) {
    super();
    const { OpenAI } = require('openai');
    this._model = opts.model || 'gpt-4o-mini';
    this._client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
    this._log = logger.createChild({ provider: 'openai' });
  }

  get name() {
    return `openai:${this._model}`;
  }

  /**
   * @param {object} input
   * @param {string} input.system
   * @param {string} input.user
   * @param {number} [input.maxTokens]
   * @param {number} [input.temperature]
   */
  async generateText(input) {
    const { system, user, maxTokens = 2048, temperature = 0.1 } = input;

    this._log.debug('generateText called', { model: this._model });

    const response = await this._client.chat.completions.create({
      model: this._model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const text = response.choices[0]?.message?.content || '';
    const usage = response.usage || {};

    return { text, usage };
  }

  /**
   * Generate a structured JSON response, validated against a Zod schema.
   *
   * @param {object} input
   * @param {import('zod').ZodType} schema
   */
  async generateStructured(input, schema) {
    const { system, user, maxTokens = 2048, temperature = 0 } = input;

    const jsonSystem = `${system}\n\nYou MUST respond with valid JSON only. Do not include markdown, code blocks, or any text outside the JSON object.`;

    this._log.debug('generateStructured called', { model: this._model });

    const response = await this._client.chat.completions.create({
      model: this._model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: jsonSystem },
        { role: 'user', content: user },
      ],
    });

    const raw = response.choices[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`LLM returned invalid JSON: ${e.message}\nRaw: ${raw.slice(0, 500)}`);
    }

    // Validate against the Zod schema
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`LLM output failed schema validation: ${result.error.message}`);
    }

    return result.data;
  }
}

module.exports = OpenAIProvider;
