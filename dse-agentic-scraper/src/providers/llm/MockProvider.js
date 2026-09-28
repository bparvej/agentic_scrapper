'use strict';

const LLMProvider = require('./LLMProvider');

/**
 * Mock LLM provider for testing and development without API keys.
 *
 * Returns deterministic responses based on the input so tests
 * don't depend on a live LLM API.
 *
 * Set in .env:
 *   LLM_PROVIDER=mock
 */
class MockProvider extends LLMProvider {
  get name() {
    return 'mock';
  }

  async generateText(input) {
    return {
      text: `[MOCK] Response to: ${input.user.slice(0, 50)}...`,
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
  }

  async generateStructured(input, schema) {
    // Return a minimal valid object that satisfies the schema
    // Each agent will handle the mock response appropriately
    const mockResponses = {
      sourceDiscovery: {
        sourceType: 'browser',
        source: 'https://dse.com.bd/company/MOCK',
        confidence: 0.5,
        reason: 'Mock provider — browser fallback assumed',
        requiresBrowser: true,
      },
      pageAnalysis: {
        sections: [
          {
            name: 'instrument_information',
            fields: [
              { label: 'Trading Code', key: 'tradingCode' },
              { label: 'Company Name', key: 'companyName' },
            ],
          },
        ],
      },
      recovery: {
        strategy: 'playwright',
        reason: 'Mock: defaulting to Playwright',
        actions: ['wait_for_network_idle', 'extract_tables'],
      },
    };

    // Try to infer which mock response to use from the user prompt
    const user = input.user || '';
    if (user.includes('source') || user.includes('discover')) {
      return schema.parse(mockResponses.sourceDiscovery);
    }
    if (user.includes('section') || user.includes('analyz')) {
      return schema.parse(mockResponses.pageAnalysis);
    }
    if (user.includes('recover') || user.includes('failed')) {
      return schema.parse(mockResponses.recovery);
    }

    // Return empty-ish valid data
    try {
      return schema.parse({});
    } catch {
      // If schema requires fields, return the first mock
      return schema.parse(mockResponses.sourceDiscovery);
    }
  }
}

module.exports = MockProvider;
