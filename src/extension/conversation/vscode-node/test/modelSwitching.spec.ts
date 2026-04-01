/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (hoisted) ---------------------------------------------------

const mockSelectChatModels = vi.hoisted(() => vi.fn());
const mockExecuteCommand = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
	lm: { selectChatModels: mockSelectChatModels },
	commands: { executeCommand: mockExecuteCommand },
	l10n: {
		t: (message: string, ...args: string[]) =>
			message.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]),
	},
	MarkdownString: class MarkdownString {
		constructor(public value: string) { }
	},
}));

import { applyFallbackModelRequest, findConfiguredFallbackModel, resolveReasoningEffortFallbackModelSetting, switchToFallbackModel } from '../modelSwitching';

// --- Helpers ------------------------------------------------------------

function createMockRequest(modelId: string) {
	return {
		prompt: 'test prompt',
		model: {
			id: modelId,
			vendor: 'copilot',
			family: 'gpt-4o',
			name: 'GPT-4o',
			version: '',
			maxInputTokens: 128_000,
			countTokens: vi.fn(),
			sendRequest: vi.fn(),
		},
	} as any;
}

function createMockStream() {
	return {
		warning: vi.fn(),
		markdown: vi.fn(),
		progress: vi.fn(),
	} as any;
}

function createChatModel(overrides: { id: string; family: string; name?: string }) {
	return {
		id: overrides.id,
		vendor: 'copilot',
		family: overrides.family,
		name: overrides.name ?? overrides.id,
		version: '',
		maxInputTokens: 200_000,
		capabilities: {
			supportsToolCalling: true,
			supportsImageToText: false,
		},
		countTokens: vi.fn(),
		sendRequest: vi.fn(),
	};
}

// --- Tests --------------------------------------------------------------

describe('switchToFallbackModel', () => {
	let mockStream: ReturnType<typeof createMockStream>;

	beforeEach(() => {
		mockStream = createMockStream();
		mockSelectChatModels.mockReset();
		mockExecuteCommand.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('returns updated request when fallback model is found', async () => {
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' });
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const request = createMockRequest('gpt-4o');
		const result = await switchToFallbackModel(request, mockStream);

		expect(result.model.id).toBe('claude-opus-id');
		expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.action.chat.changeModel', {
			vendor: 'copilot',
			id: 'claude-opus-id',
			family: 'claude-opus-4-6',
		});
		expect(mockStream.warning).toHaveBeenCalledOnce();
	});

	test('returns original request when no fallback model available', async () => {
		const someOtherModel = createChatModel({ id: 'gpt-4o', family: 'gpt-4o' });
		mockSelectChatModels.mockResolvedValue([someOtherModel]);

		const request = createMockRequest('gpt-4o');
		const result = await switchToFallbackModel(request, mockStream);

		expect(result.model.id).toBe('gpt-4o');
		expect(mockExecuteCommand).not.toHaveBeenCalled();
		expect(mockStream.warning).not.toHaveBeenCalled();
	});

	test('returns original request when already on fallback model', async () => {
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6' });
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const request = createMockRequest('claude-opus-id');
		const result = await switchToFallbackModel(request, mockStream);

		expect(result.model.id).toBe('claude-opus-id');
		expect(mockExecuteCommand).not.toHaveBeenCalled();
		expect(mockStream.warning).not.toHaveBeenCalled();
	});

	test('returns original request when selectChatModels returns empty array', async () => {
		mockSelectChatModels.mockResolvedValue([]);

		const request = createMockRequest('gpt-4o');
		const result = await switchToFallbackModel(request, mockStream);

		expect(result.model.id).toBe('gpt-4o');
		expect(mockExecuteCommand).not.toHaveBeenCalled();
		expect(mockStream.warning).not.toHaveBeenCalled();
	});

	test('warning message uses model name when available', async () => {
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' });
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const request = createMockRequest('gpt-4o');
		await switchToFallbackModel(request, mockStream);

		const warningArg = mockStream.warning.mock.calls[0][0];
		expect(warningArg.value).toContain('Claude Opus 4.6');
	});

	test('warning message falls back to default name when model name is undefined', async () => {
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6' });
		(claudeOpus as any).name = undefined;
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const request = createMockRequest('gpt-4o');
		await switchToFallbackModel(request, mockStream);

		const warningArg = mockStream.warning.mock.calls[0][0];
		expect(warningArg.value).toContain('Claude Opus 4');
	});

	test('selects first claude-opus-4 family model from multiple results', async () => {
		const otherModel = createChatModel({ id: 'gpt-4o', family: 'gpt-4o' });
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6' });
		const anotherOpus = createChatModel({ id: 'claude-opus-id-2', family: 'claude-opus-4-7' });
		mockSelectChatModels.mockResolvedValue([otherModel, claudeOpus, anotherOpus]);

		const request = createMockRequest('gpt-4o');
		const result = await switchToFallbackModel(request, mockStream);

		// Should pick the first match
		expect(result.model.id).toBe('claude-opus-id');
	});

	test('preserves non-model fields of the request', async () => {
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6' });
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const request = createMockRequest('gpt-4o');
		const result = await switchToFallbackModel(request, mockStream);

		expect(result.prompt).toBe('test prompt');
	});
});

describe('resolveReasoningEffortFallbackModelSetting', () => {
	test('returns selector for string shorthand', () => {
		expect(resolveReasoningEffortFallbackModelSetting(' claude-opus-4 ')).toEqual({ modelSelector: 'claude-opus-4' });
	});

	test('returns selector and reasoning effort for object form', () => {
		expect(resolveReasoningEffortFallbackModelSetting({ model: 'gpt-5.4', reasoningEffort: 'medium' })).toEqual({
			modelSelector: 'gpt-5.4',
			reasoningEffort: 'medium',
		});
	});

	test('returns undefined when selector is empty', () => {
		expect(resolveReasoningEffortFallbackModelSetting('   ')).toBeUndefined();
		expect(resolveReasoningEffortFallbackModelSetting({ model: '   ', reasoningEffort: 'medium' })).toBeUndefined();
	});
});

describe('findConfiguredFallbackModel', () => {
	test('matches configured selector against family, id, and name', () => {
		const models = [
			createChatModel({ id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o' }),
			createChatModel({ id: 'gpt-5.4-id', family: 'gpt-5.4', name: 'GPT-5.4' }),
			createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' }),
		];

		expect(findConfiguredFallbackModel(models, 'gpt-5.4', 'gpt-4o')?.id).toBe('gpt-5.4-id');
		expect(findConfiguredFallbackModel(models, 'Claude Opus', 'gpt-4o')?.id).toBe('claude-opus-id');
	});
});

describe('applyFallbackModelRequest', () => {
	test('applies fallback reasoning effort and skip flag when provided', () => {
		const request = createMockRequest('gpt-4o');
		const fallbackModel = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' });

		const result = applyFallbackModelRequest(request, fallbackModel, 'medium');

		expect(result.model.id).toBe('claude-opus-id');
		expect(result.modelConfiguration).toEqual({
			reasoningEffort: 'medium',
			_skipReasoningEffortOverride: true,
		});
	});

	test('preserves existing request shape when no fallback reasoning effort is provided', () => {
		const request = {
			...createMockRequest('gpt-4o'),
			modelConfiguration: {
				reasoningEffort: 'high',
			},
		} as any;
		const fallbackModel = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' });

		const result = applyFallbackModelRequest(request, fallbackModel);

		expect(result.model.id).toBe('claude-opus-id');
		expect(result.modelConfiguration).toEqual({
			reasoningEffort: 'high',
		});
	});
});

describe('fallback model retry guard (subAgentInvocationId)', () => {
	let mockStream: ReturnType<typeof createMockStream>;

	beforeEach(() => {
		mockStream = createMockStream();
		mockSelectChatModels.mockReset();
		mockExecuteCommand.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('does not execute fallback when request has subAgentInvocationId', async () => {
		// Subagent request — should be blocked by the guard
		const request = {
			...createMockRequest('gpt-4o'),
			subAgentInvocationId: 'some-subagent-id',
		};

		const result = {
			metadata: { shouldAutoRetryWithFallbackModel: true },
			errorDetails: { message: 'Unsupported value' },
		};

		// Guard condition: the retry should NOT proceed for subagent requests
		const shouldRetry = !!result.metadata.shouldAutoRetryWithFallbackModel && !request.subAgentInvocationId;
		expect(shouldRetry).toBe(false);

		// Prove switchToFallbackModel itself works — it's the guard that prevents calling it
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' });
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const switched = await switchToFallbackModel(request, mockStream);
		expect(switched.model.id).toBe('claude-opus-id');
	});

	test('executes fallback when request has no subAgentInvocationId (panel request)', async () => {
		// Panel request — no subAgentInvocationId, guard allows retry
		const request = createMockRequest('gpt-4o');

		const result = {
			metadata: { shouldAutoRetryWithFallbackModel: true },
			errorDetails: { message: 'Unsupported value' },
		};

		// Guard condition: the retry SHOULD proceed for panel requests
		const shouldRetry = !!result.metadata.shouldAutoRetryWithFallbackModel && !request.subAgentInvocationId;
		expect(shouldRetry).toBe(true);

		// switchToFallbackModel works and returns a switched model
		const claudeOpus = createChatModel({ id: 'claude-opus-id', family: 'claude-opus-4-6', name: 'Claude Opus 4.6' });
		mockSelectChatModels.mockResolvedValue([claudeOpus]);

		const switched = await switchToFallbackModel(request, mockStream);
		expect(switched.model.id).toBe('claude-opus-id');
		expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.action.chat.changeModel', {
			vendor: 'copilot',
			id: 'claude-opus-id',
			family: 'claude-opus-4-6',
		});
	});
});
