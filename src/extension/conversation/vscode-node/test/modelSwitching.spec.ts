/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { LanguageModelChat } from 'vscode';
import { type IConfigurationService, ConfigKey } from '../../../../platform/configuration/common/configurationService';
import type { ChatRequest } from '../../../../vscodeTypes';
import { applyBootstrapToRequest, parseBootstrapTriggerSetting, shouldApplyBootstrap, type BootstrapConfig } from '../modelSwitching';

function createMockConfigService(value: unknown): IConfigurationService {
	return {
		getConfig: (key: any) => {
			if (key === ConfigKey.ReasoningEffortBootstrapTrigger) {
				return value;
			}
			return undefined;
		},
	} as unknown as IConfigurationService;
}

function createMockRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
	return {
		id: 'test-id',
		attempt: 0,
		sessionId: 'test-session',
		sessionResource: {} as any,
		enableCommandDetection: false,
		isParticipantDetected: false,
		location: 1 as any,
		location2: undefined,
		hasHooksEnabled: false,
		prompt: 'test prompt',
		command: undefined,
		references: [],
		toolReferences: [],
		model: {
			id: 'original-model',
			family: 'original-family',
			vendor: 'copilot',
			name: 'Original Model',
			version: '1',
			maxInputTokens: 128000,
		} as unknown as LanguageModelChat,
		modelConfiguration: { reasoningEffort: 'medium' },
		...overrides,
	} as ChatRequest;
}

describe('parseBootstrapTriggerSetting', () => {
	it('returns undefined when set to false', () => {
		const configService = createMockConfigService(false);
		expect(parseBootstrapTriggerSetting(configService)).toBeUndefined();
	});

	it('returns undefined when set to undefined', () => {
		const configService = createMockConfigService(undefined);
		expect(parseBootstrapTriggerSetting(configService)).toBeUndefined();
	});

	it('returns undefined when set to null', () => {
		const configService = createMockConfigService(null);
		expect(parseBootstrapTriggerSetting(configService)).toBeUndefined();
	});

	it('returns defaults when set to empty object', () => {
		const configService = createMockConfigService({});
		const result = parseBootstrapTriggerSetting(configService);
		expect(result).toEqual({ model: 'gpt-5-mini', reasoningEffort: 'xhigh' });
	});

	it('uses provided model and reasoningEffort', () => {
		const configService = createMockConfigService({ model: 'custom-model', reasoningEffort: 'high' });
		const result = parseBootstrapTriggerSetting(configService);
		expect(result).toEqual({ model: 'custom-model', reasoningEffort: 'high' });
	});

	it('defaults omitted model field to gpt-5-mini', () => {
		const configService = createMockConfigService({ reasoningEffort: 'high' });
		const result = parseBootstrapTriggerSetting(configService);
		expect(result).toEqual({ model: 'gpt-5-mini', reasoningEffort: 'high' });
	});

	it('defaults omitted reasoningEffort field to xhigh', () => {
		const configService = createMockConfigService({ model: 'my-model' });
		const result = parseBootstrapTriggerSetting(configService);
		expect(result).toEqual({ model: 'my-model', reasoningEffort: 'xhigh' });
	});

	it('defaults empty string model to gpt-5-mini', () => {
		const configService = createMockConfigService({ model: '' });
		const result = parseBootstrapTriggerSetting(configService);
		expect(result).toEqual({ model: 'gpt-5-mini', reasoningEffort: 'xhigh' });
	});
});

describe('shouldApplyBootstrap', () => {
	const config: BootstrapConfig = { model: 'gpt-5-mini', reasoningEffort: 'xhigh' };

	it('returns true for first turn, first attempt, no subagent', () => {
		const request = createMockRequest();
		expect(shouldApplyBootstrap(request, 0, config)).toBe(true);
	});

	it('returns false when config is undefined', () => {
		const request = createMockRequest();
		expect(shouldApplyBootstrap(request, 0, undefined)).toBe(false);
	});

	it('returns false when history has prior turns', () => {
		const request = createMockRequest();
		expect(shouldApplyBootstrap(request, 1, config)).toBe(false);
	});

	it('returns false on retry attempts', () => {
		const request = createMockRequest({ attempt: 1 });
		expect(shouldApplyBootstrap(request, 0, config)).toBe(false);
	});

	it('returns false for subagent invocations', () => {
		const request = createMockRequest({ subAgentInvocationId: 'sub-123' });
		expect(shouldApplyBootstrap(request, 0, config)).toBe(false);
	});
});

describe('applyBootstrapToRequest', () => {
	it('overrides model and reasoningEffort', () => {
		const request = createMockRequest();
		const bootstrapModel = { id: 'gpt-5-mini', family: 'gpt-5-mini', vendor: 'copilot' } as unknown as LanguageModelChat;
		const config: BootstrapConfig = { model: 'gpt-5-mini', reasoningEffort: 'xhigh' };

		const result = applyBootstrapToRequest(request, bootstrapModel, config);

		expect(result.model).toBe(bootstrapModel);
		expect(result.modelConfiguration?.reasoningEffort).toBe('xhigh');
	});

	it('preserves other modelConfiguration properties', () => {
		const request = createMockRequest({
			modelConfiguration: { reasoningEffort: 'medium', otherSetting: 'value' } as any,
		});
		const bootstrapModel = { id: 'gpt-5-mini' } as unknown as LanguageModelChat;
		const config: BootstrapConfig = { model: 'gpt-5-mini', reasoningEffort: 'xhigh' };

		const result = applyBootstrapToRequest(request, bootstrapModel, config);

		expect((result.modelConfiguration as any)?.otherSetting).toBe('value');
		expect(result.modelConfiguration?.reasoningEffort).toBe('xhigh');
	});

	it('preserves prompt and other request properties', () => {
		const request = createMockRequest({ prompt: 'build a web app' } as any);
		const bootstrapModel = { id: 'gpt-5-mini' } as unknown as LanguageModelChat;
		const config: BootstrapConfig = { model: 'gpt-5-mini', reasoningEffort: 'xhigh' };

		const result = applyBootstrapToRequest(request, bootstrapModel, config);

		expect((result as any).prompt).toBe('build a web app');
	});
});
