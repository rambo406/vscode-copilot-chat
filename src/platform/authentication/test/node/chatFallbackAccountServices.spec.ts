/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest';
import type { AuthenticationGetSessionOptions, AuthenticationSession, AuthenticationSessionAccountInformation } from 'vscode';
import { IConfigurationService } from '../../../configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../configuration/common/defaultsOnlyConfigurationService';
import { IVSCodeExtensionContext } from '../../../extContext/common/extensionContext';
import { ILogService, LogServiceImpl } from '../../../log/common/logService';
import { MockExtensionContext } from '../../../test/node/extensionContext';
import { ChatFallbackAccountResolverService } from '../../vscode-node/chatFallbackAccountResolverService';
import { ChatFallbackAccountRegistryService } from '../../vscode-node/fallbackAccountRegistryService';

const mockGetAccounts = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock('vscode', async importOriginal => {
	const actual = await importOriginal() as Record<string, unknown>;
	return {
		...actual,
		authentication: {
			...(actual.authentication as object | undefined),
			getAccounts: mockGetAccounts,
			getSession: mockGetSession,
		},
	};
});

suite('chat fallback account services', () => {
	const createExtensionContext = (): IVSCodeExtensionContext => new MockExtensionContext() as unknown as IVSCodeExtensionContext;
	const createAccount = (id: string, label: string): AuthenticationSessionAccountInformation => ({ id, label });
	const createSession = (id: string, label: string): AuthenticationSession => ({
		id: `session-${id}`,
		accessToken: `token-${id}`,
		account: createAccount(id, label),
		scopes: ['user:email'],
	});

	let configurationService: IConfigurationService;
	let logService: ILogService;
	let extensionContext: IVSCodeExtensionContext;

	beforeEach(() => {
		configurationService = new DefaultsOnlyConfigurationService();
		logService = new LogServiceImpl([]);
		extensionContext = createExtensionContext();
		mockGetAccounts.mockReset();
		mockGetSession.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('registry prunes invalid entries, deduplicates ids, and refreshes labels on load', async () => {
		mockGetAccounts.mockResolvedValue([
			createAccount('account-a', 'Account A'),
			createAccount('account-b', 'Account B'),
		]);
		await extensionContext.globalState.update('github.copilot.chat.fallbackAccountRegistry', [
			{ id: 'account-a', label: 'Old Label' },
			{ id: '', label: 'Missing Id' },
			{ id: 'account-a', label: 'Duplicate' },
			{ id: 'missing', label: 'Missing Account' },
			{ id: 'account-b', label: 'Account B' },
		]);

		const service = new ChatFallbackAccountRegistryService(extensionContext, configurationService, logService);
		const configuredAccounts = await service.getConfiguredAccounts();

		expect(configuredAccounts).toEqual([
			{ id: 'account-a', label: 'Account A' },
			{ id: 'account-b', label: 'Account B' },
		]);
		expect(extensionContext.globalState.get('github.copilot.chat.fallbackAccountRegistry')).toEqual(configuredAccounts);
	});

	test('registry preserves ordering changes and removals in storage', async () => {
		mockGetAccounts.mockResolvedValue([
			createAccount('account-a', 'Account A'),
			createAccount('account-b', 'Account B'),
		]);

		const service = new ChatFallbackAccountRegistryService(extensionContext, configurationService, logService);
		await service.addConfiguredAccount(createAccount('account-a', 'Account A'));
		await service.addConfiguredAccount(createAccount('account-b', 'Account B'));
		await service.moveConfiguredAccount('account-b', 0);
		await service.removeConfiguredAccount('account-a');

		expect(await service.getConfiguredAccounts()).toEqual([
			{ id: 'account-b', label: 'Account B' },
		]);
	});

	test('resolver skips the current and attempted accounts and uses the next eligible configured session', async () => {
		mockGetAccounts.mockResolvedValue([
			createAccount('account-a', 'Account A'),
			createAccount('account-b', 'Account B'),
			createAccount('account-c', 'Account C'),
		]);
		mockGetSession.mockImplementation(async (_providerId: string, _scopes: string[], options?: AuthenticationGetSessionOptions) => {
			const requestedAccount = options?.account;
			if (!requestedAccount) {
				return createSession('account-c', 'Account C');
			}
			if (requestedAccount.id === 'account-b') {
				return createSession('account-b', 'Account B');
			}
			if (requestedAccount.id === 'account-a') {
				return createSession('account-a', 'Account A');
			}
			return undefined;
		});

		const registry = new ChatFallbackAccountRegistryService(extensionContext, configurationService, logService);
		await registry.setConfiguredAccounts([
			{ id: 'account-c', label: 'Account C' },
			{ id: 'account-b', label: 'Account B' },
			{ id: 'account-a', label: 'Account A' },
		]);
		const resolver = new ChatFallbackAccountResolverService(registry, configurationService, extensionContext, logService);

		const resolved = await resolver.resolveNextEligibleFallbackSession(['account-b']);

		expect((await resolver.getCurrentChatAccount())?.id).toBe('account-c');
		expect(resolved?.account.id).toBe('account-a');
		expect(resolved?.registryEntry.id).toBe('account-a');
	});

	test('resolver clears a stale active account and falls back to the default chat session', async () => {
		mockGetAccounts.mockResolvedValue([
			createAccount('account-a', 'Account A'),
			createAccount('account-c', 'Account C'),
		]);
		mockGetSession.mockImplementation(async (_providerId: string, _scopes: string[], options?: AuthenticationGetSessionOptions) => {
			if (options?.account?.id === 'stale-account') {
				return undefined;
			}
			return createSession('account-c', 'Account C');
		});

		const registry = new ChatFallbackAccountRegistryService(extensionContext, configurationService, logService);
		const resolver = new ChatFallbackAccountResolverService(registry, configurationService, extensionContext, logService);
		await resolver.setActiveChatAccount(createAccount('stale-account', 'Stale Account'));

		const currentSession = await resolver.getCurrentChatSession();

		expect(currentSession?.account.id).toBe('account-c');
		expect(resolver.getActiveChatAccount()).toBeUndefined();
	});
});
