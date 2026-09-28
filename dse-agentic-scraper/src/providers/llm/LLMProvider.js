'use strict';

/**
 * LLMProvider interface contract.
 *
 * All LLM provider implementations must extend this class and implement
 * generateText() and generateStructured().
 *
 * This ensures the rest of the application is decoupled from any specific
 * LLM vendor (OpenAI, OpenRouter, Anthropic, etc.).
 */
class LLMProvider {
  /**
   * Generate free-form text from a prompt.
   *
   * @param {object} input
   * @param {string} input.system  - System prompt
   * @param {string} input.user    - User / human message
   * @param {number} [input.maxTokens]
   * @param {number} [input.temperature]
   * @returns {Promise<{text: string, usage: object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async generateText(input) {
    throw new Error('LLMProvider.generateText() must be implemented');
  }

  /**
   * Generate a structured (JSON) response, validated against a Zod schema.
   *
   * The implementation should instruct the model to respond in valid JSON
   * and then parse + validate the output against the provided schema.
   *
   * @param {object} input       - Same as generateText
   * @param {import('zod').ZodType} schema - Zod schema to validate response
   * @returns {Promise<object>}  - Parsed and validated object
   */
  // eslint-disable-next-line no-unused-vars
  async generateStructured(input, schema) {
    throw new Error('LLMProvider.generateStructured() must be implemented');
  }

  /**
   * Return provider name/identifier for logging.
   * @returns {string}
   */
  get name() {
    return 'abstract-llm-provider';
  }
}

module.exports = LLMProvider;
