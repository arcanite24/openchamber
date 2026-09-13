import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSmallModel } from './index.js';

import {
  ZEN_ANONYMOUS_API_KEY,
  configureOpenCodeRuntimeProviders,
  getRuntimeProvider,
  getRuntimeProviderSnapshot,
  resetOpenCodeRuntimeProviders,
  requestOmpSmallModel,
} from './runtime-providers.js';

const providerPayload = (overrides = {}) => ({
  all: [
    {
      id: 'llmapi',
      source: 'config',
      options: { apiKey: 'plugin-key', baseURL: 'https://api.llmapi.ai/v1/' },
      models: {
        'claude-opus-4-8': { api: { id: 'claude-opus-4-8', url: '', npm: '@ai-sdk/anthropic' } },
        'gpt-5.6-luna': { api: { id: 'gpt-5.6-luna', url: 'https://api.llmapi.ai/v1', npm: '@ai-sdk/openai' } },
      },
    },
    {
      id: 'opencode',
      source: 'custom',
      options: { apiKey: ZEN_ANONYMOUS_API_KEY },
      models: { 'free-model': { api: { id: 'free-model', url: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible' } } },
    },
    {
      id: 'zai-coding-plan',
      source: 'api',
      key: 'auth-json-key',
      options: {},
      models: { 'glm-5': { api: { id: 'glm-5', url: 'https://api.z.ai/api/coding/paas/v4', npm: '@ai-sdk/openai-compatible' } } },
    },
  ],
  connected: ['llmapi', 'opencode', 'zai-coding-plan'],
  ...overrides,
});

describe('OpenCode runtime provider snapshot', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify(providerPayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    configureOpenCodeRuntimeProviders({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic test' }),
    });
  });

  afterEach(() => {
    configureOpenCodeRuntimeProviders(null);
    resetOpenCodeRuntimeProviders();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses OMP limits for numeric and computed output reserves', async () => {
    vi.stubEnv('OPENCHAMBER_AGENT_RUNTIME', 'omp');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      contextTokens: 8000, outputTokenLimit: 2000, outputTokens: 2000, inputCharBudget: 24000,
    })));
    for (const outputReserveTokens of [1000, () => 1000]) {
      expect(await describeSmallModel({ overrideModel: 'probe/test', outputReserveTokens }))
        .toMatchObject({ outputTokens: 1000, inputCharBudget: 28000 });
    }
    await expect(describeSmallModel({ overrideModel: 'probe/test', outputReserveTokens: () => 1.5 }))
      .rejects.toThrow('Invalid output token reserve');
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith('/omp/small-model'))).toBe(true);
  });

  it('routes OMP utility calls through the private runtime without credential snapshots', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ text: 'summary', providerID: 'opencode-go', modelID: 'test' }));
    expect(await requestOmpSmallModel({ action: 'generate', prompt: 'Summarize this' })).toMatchObject({ text: 'summary' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4096/omp/small-model');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Basic test' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'generate', prompt: 'Summarize this' });
  });

  it('reports the credential and endpoint a plugin registered at runtime', async () => {
    const provider = await getRuntimeProvider('llmapi');

    expect(provider).toMatchObject({ apiKey: 'plugin-key', baseURL: 'https://api.llmapi.ai/v1' });
    expect(provider.models.get('gpt-5.6-luna')).toEqual({
      api: { url: 'https://api.llmapi.ai/v1', npm: '@ai-sdk/openai' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4096/provider');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Basic test' });
  });

  it('refuses the zen sentinel as a credential', async () => {
    const provider = await getRuntimeProvider('opencode');

    expect(provider.apiKey).toBeNull();
    expect(provider.anonymousZen).toBe(true);
    // The endpoint is still reported; only the credential is withheld.
    expect(provider.baseURL).toBe('https://opencode.ai/zen/v1');
  });

  it('falls back to the model endpoint when the provider carries no baseURL', async () => {
    expect((await getRuntimeProvider('zai-coding-plan')).baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
  });

  it('serves one snapshot to concurrent callers instead of refetching', async () => {
    await Promise.all([getRuntimeProvider('llmapi'), getRuntimeProvider('opencode'), getRuntimeProvider('zai-coding-plan')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers "unknown" rather than "no providers" when OpenCode is unreachable', async () => {
    resetOpenCodeRuntimeProviders();
    fetchMock.mockRejectedValue(new Error('connection refused'));

    expect(await getRuntimeProviderSnapshot()).toBeNull();
  });

  it('keeps the previous snapshot when a later refresh fails', async () => {
    await getRuntimeProviderSnapshot();
    fetchMock.mockRejectedValue(new Error('connection refused'));

    // Past the snapshot TTL, so the next read genuinely attempts a refresh.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    const refreshed = await getRuntimeProviderSnapshot();
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.providers.has('llmapi')).toBe(true);
  });

  it('stays on file-based resolution until it is configured', async () => {
    configureOpenCodeRuntimeProviders(null);

    expect(await getRuntimeProvider('llmapi')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
