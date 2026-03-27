/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthenticationSession, AuthenticationSessionAccountInformation, CancellationToken, ChatErrorDetails, ChatRequest, ChatResponseStream } from 'vscode';
import type { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import type { ChatFallbackResolvedSession, IChatFallbackAccountResolverService } from '../../../../platform/authentication/common/chatFallbackAccountResolver';
import type { CopilotToken } from '../../../../platform/authentication/common/copilotToken';
import { ICopilotChatResultIn } from '../../../prompt/common/conversation';
import { retryWithFallbackAccount } from '../fallbackAccountRetry';

vi.mock('vscode', async importOriginal => {
	const actual = await importOriginal() as Record<string, unknown>;
	return {
		...actual,
		l10n: {
			t: (message: string, ...args: string[]) => message.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]),
		},
		MarkdownString: class MarkdownString {
			constructor(public value: string) { }
		},
	};
});

class TestAuthenticationService implements IAuthenticationService {
	declare readonly _serviceBrand: undefined;
	readonly isMinimalMode = false;
	readonly onDidAuthenticationChange = vi.fn();
	readonly onDidAccessTokenChange = vi.fn();
	readonly onDidAdoAuthenticationChange = vi.fn();
	readonly anyGitHubSession = undefined;
	readonly permissiveGitHubSession = undefined;
	readonly copilotToken = undefined;
	speculativeDecodingEndpointToken = undefined;
	readonly resetCopilotToken = vi.fn();
	readonly getCopilotToken = vi.fn(async () => ({ token: 'copilot-token' } as CopilotToken));
	readonly getGitHubSession = vi.fn();
	readonly getAdoAccessTokenBase64 = vi.fn();
}

class TestResolverService implements IChatFallbackAccountResolverService {
	declare readonly _serviceBrand: undefined;

	private readonly _resolvedSessions: Array<ChatFallbackResolvedSession | undefined>;
	private _activeAccount: AuthenticationSessionAccountInformation | undefined;

	constructor(
		activeAccount: AuthenticationSessionAccountInformation | undefined,
		resolvedSessions: Array<ChatFallbackResolvedSession | undefined>,
	) {
		this._activeAccount = activeAccount;
		this._resolvedSessions = [...resolvedSessions];
	}

	getActiveChatAccount(): AuthenticationSessionAccountInformation | undefined {
		return this._activeAccount;
	}

	async setActiveChatAccount(account: AuthenticationSessionAccountInformation | undefined): Promise<void> {
		this._activeAccount = account;
	}

	async getCurrentChatAccount(): Promise<AuthenticationSessionAccountInformation | undefined> {
		return this._activeAccount;
	}

	async getCurrentChatSession(): Promise<AuthenticationSession | undefined> {
		if (!this._activeAccount) {
			return undefined;
		}
		return {
			id: `session-${this._activeAccount.id}`,
			accessToken: `token-${this._activeAccount.id}`,
			account: this._activeAccount,
			scopes: ['user:email'],
		};
	}

	async resolveNextEligibleFallbackSession(): Promise<ChatFallbackResolvedSession | undefined> {
		return this._resolvedSessions.shift();
	}
}

function createAccount(id: string, label: string): AuthenticationSessionAccountInformation {
	return { id, label };
}

function createResolvedSession(id: string, label: string): ChatFallbackResolvedSession {
	return {
		account: createAccount(id, label),
		registryEntry: { id, label },
		session: {
			id: `session-${id}`,
			accessToken: `token-${id}`,
			account: createAccount(id, label),
			scopes: ['user:email'],
		},
	};
}

function createRateLimitedResult(message = 'rate limited'): ICopilotChatResultIn {
	return {
		errorDetails: { message } as ChatErrorDetails,
		metadata: { shouldAutoRetryWithFallbackAccount: true },
	};
}

function createRequest(): ChatRequest {
	return {
		prompt: 'hello world',
		acceptedConfirmationData: [],
		attempt: 1,
		command: undefined,
		enableCommandDetection: false,
		hasHooksEnabled: false,
		id: 'request-id',
		isParticipantDetected: false,
		location: 'panel',
		location2: undefined,
		model: { family: 'copilot' },
		references: [],
		sessionId: 'session-id',
		sessionResource: undefined,
		toolInvocationToken: undefined,
		toolReferences: [],
		tools: new Map(),
	} as unknown as ChatRequest;
}

function createStream(): ChatResponseStream {
	return {
		warning: vi.fn(),
		progress: vi.fn(async (_message: string, task?: () => Promise<string | void>) => {
			if (task) {
				await task();
			}
		}),
	} as unknown as ChatResponseStream;
}

function createToken(isCancelled = false): CancellationToken {
	const listeners: Array<() => void> = [];
	return {
		isCancellationRequested: isCancelled,
		onCancellationRequested: (listener: () => void) => {
			listeners.push(listener);
			return { dispose: () => { } };
		},
		_fire: () => { listeners.forEach(l => l()); },
	} as any;
}

describe('retryWithFallbackAccount', () => {
	let authenticationService: TestAuthenticationService;
	let stream: ChatResponseStream & { warning: ReturnType<typeof vi.fn>; progress: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		authenticationService = new TestAuthenticationService();
		stream = createStream() as ChatResponseStream & { warning: ReturnType<typeof vi.fn>; progress: ReturnType<typeof vi.fn> };
	});

	test('retries with the next fallback account and keeps it active after success', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [createResolvedSession('account-fallback', 'Fallback Account')]);
		const retryAsContinuation = vi.fn(async (retryRequest: ChatRequest) => ({
			request: retryRequest,
			result: { metadata: {} },
		}));

		const outcome = await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: createRateLimitedResult(),
			stream,
			token: createToken(),
			retryAsContinuation,
		});

		expect(retryAsContinuation).toHaveBeenCalledOnce();
		expect(authenticationService.getCopilotToken).toHaveBeenCalledOnce();
		expect(resolverService.getActiveChatAccount()?.id).toBe('account-fallback');
		expect((outcome.result as ICopilotChatResultIn).errorDetails).toBeUndefined();
		expect((outcome.request.acceptedConfirmationData ?? []).some(data => (data as { copilotFallbackAccountRetry?: boolean }).copilotFallbackAccountRetry)).toBe(true);
		expect(stream.warning).toHaveBeenCalledWith(expect.objectContaining({ value: expect.stringContaining('Fallback Account') }));
	});

	test('returns the final error and restores the original account when fallback accounts are exhausted', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [createResolvedSession('account-fallback', 'Fallback Account'), undefined]);
		const retryAsContinuation = vi.fn(async (retryRequest: ChatRequest) => ({
			request: retryRequest,
			result: createRateLimitedResult('still rate limited'),
		}));

		const outcome = await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: createRateLimitedResult(),
			stream,
			token: createToken(true),
			retryAsContinuation,
		});

		expect(retryAsContinuation).toHaveBeenCalledOnce();
		expect(authenticationService.getCopilotToken).toHaveBeenCalledTimes(2);
		expect(authenticationService.resetCopilotToken).toHaveBeenCalledTimes(2);
		expect(resolverService.getActiveChatAccount()?.id).toBe('account-current');
		expect(outcome.result.errorDetails?.message).toBe('still rate limited');
		expect((outcome.result as ICopilotChatResultIn).metadata?.attemptedFallbackAccountIds).toEqual(['account-fallback']);
	});

	test('is a no-op when no configured fallback account is eligible', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [undefined]);
		const retryAsContinuation = vi.fn();

		const originalResult = createRateLimitedResult();
		const outcome = await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: originalResult,
			stream,
			token: createToken(true),
			retryAsContinuation,
		});

		expect(retryAsContinuation).not.toHaveBeenCalled();
		expect(authenticationService.getCopilotToken).toHaveBeenCalledOnce();
		expect(authenticationService.resetCopilotToken).toHaveBeenCalledOnce();
		expect(resolverService.getActiveChatAccount()?.id).toBe('account-current');
		expect(outcome.result).toBe(originalResult);
	});

	test('emits cooldown warning when all fallback accounts are exhausted', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [createResolvedSession('account-fallback', 'Fallback Account'), undefined]);
		const retryAsContinuation = vi.fn(async (retryRequest: ChatRequest) => ({
			request: retryRequest,
			result: createRateLimitedResult('still rate limited'),
		}));

		await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: createRateLimitedResult(),
			stream,
			token: createToken(true),
			retryAsContinuation,
		});

		expect(stream.progress).toHaveBeenCalledWith(
			expect.stringContaining('rate-limited'),
			expect.any(Function),
		);
	});

	test('emits cooldown warning when no fallback accounts are configured', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [undefined]);
		const retryAsContinuation = vi.fn();

		await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: createRateLimitedResult(),
			stream,
			token: createToken(true),
			retryAsContinuation,
		});

		expect(stream.progress).toHaveBeenCalledWith(
			expect.stringContaining('rate-limited'),
			expect.any(Function),
		);
	});

	test('does not emit cooldown warning when fallback account succeeds', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [createResolvedSession('account-fallback', 'Fallback Account')]);
		const retryAsContinuation = vi.fn(async (retryRequest: ChatRequest) => ({
			request: retryRequest,
			result: { metadata: {} },
		}));

		await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: createRateLimitedResult(),
			stream,
			token: createToken(),
			retryAsContinuation,
		});

		// stream.progress should not be called since the fallback account succeeded
		expect(stream.progress).not.toHaveBeenCalled();
	});

	test('calls stream.progress() with task when all fallback accounts are exhausted', async () => {
		const originalAccount = createAccount('account-current', 'Current Account');
		const resolverService = new TestResolverService(originalAccount, [createResolvedSession('account-fallback', 'Fallback Account'), undefined]);
		const retryAsContinuation = vi.fn(async (retryRequest: ChatRequest) => ({
			request: retryRequest,
			result: createRateLimitedResult('still rate limited'),
		}));

		await retryWithFallbackAccount({
			authenticationService,
			resolverService,
			request: createRequest(),
			result: createRateLimitedResult(),
			stream,
			token: createToken(true),
			retryAsContinuation,
		});

		expect(stream.progress).toHaveBeenCalledWith(
			expect.stringContaining('rate-limited'),
			expect.any(Function),
		);
		const [message] = stream.progress.mock.calls[0];
		expect(message).toContain('minutes');
	});

	test('auto-retries via retryAsContinuation after countdown expires', async () => {
		vi.useFakeTimers();
		try {
			const originalAccount = createAccount('account-current', 'Current Account');
			const resolverService = new TestResolverService(originalAccount, [createResolvedSession('account-fallback', 'Fallback Account'), undefined]);
			const retryAsContinuation = vi.fn()
				.mockImplementationOnce(async (retryRequest: ChatRequest) => ({
					request: retryRequest,
					result: createRateLimitedResult('still rate limited'),
				}))
				.mockImplementationOnce(async (retryRequest: ChatRequest) => ({
					request: retryRequest,
					result: { metadata: {} } as ICopilotChatResultIn,
				}));

			const token = createToken();
			const testStream = createStream() as ChatResponseStream & { warning: ReturnType<typeof vi.fn>; progress: ReturnType<typeof vi.fn> };

			const promise = retryWithFallbackAccount({
				authenticationService,
				resolverService,
				request: createRequest(),
				result: createRateLimitedResult(),
				stream: testStream,
				token,
				retryAsContinuation,
			});

			await vi.advanceTimersByTimeAsync(1800 * 1000);

			const outcome = await promise;

			expect(retryAsContinuation).toHaveBeenCalledTimes(2);
			expect(outcome.result.errorDetails).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	test('aborts countdown without auto-retrying when token is cancelled', async () => {
		vi.useFakeTimers();
		try {
			const originalAccount = createAccount('account-current', 'Current Account');
			const resolverService = new TestResolverService(originalAccount, [undefined]);
			const retryAsContinuation = vi.fn();

			const token = createToken();
			const testStream = createStream() as ChatResponseStream & { warning: ReturnType<typeof vi.fn>; progress: ReturnType<typeof vi.fn> };

			const promise = retryWithFallbackAccount({
				authenticationService,
				resolverService,
				request: createRequest(),
				result: createRateLimitedResult(),
				stream: testStream,
				token,
				retryAsContinuation,
			});

			await vi.advanceTimersByTimeAsync(0);

			(token as any)._fire();
			await vi.advanceTimersByTimeAsync(0);

			const outcome = await promise;

			expect(retryAsContinuation).not.toHaveBeenCalled();
			expect(outcome.result.errorDetails?.message).toBe('rate limited');
		} finally {
			vi.useRealTimers();
		}
	});
});
