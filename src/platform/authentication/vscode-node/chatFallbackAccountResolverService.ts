/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { authentication, AuthenticationSession, AuthenticationSessionAccountInformation } from 'vscode';
import { IConfigurationService } from '../../configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../extContext/common/extensionContext';
import { ILogService } from '../../log/common/logService';
import { authProviderId } from '../common/authentication';
import { ChatFallbackResolvedSession, IChatFallbackAccountResolverService } from '../common/chatFallbackAccountResolver';
import { IChatFallbackAccountRegistryService } from '../common/fallbackAccountRegistry';
import { getAnyAuthSession } from './session';

export class ChatFallbackAccountResolverService implements IChatFallbackAccountResolverService {
	declare readonly _serviceBrand: undefined;

	private static readonly ACTIVE_ACCOUNT_STORAGE_KEY = 'github.copilot.chat.activeAccount';

	private _activeChatAccount: AuthenticationSessionAccountInformation | undefined;
	private _didLoadActiveAccount = false;

	constructor(
		@IChatFallbackAccountRegistryService private readonly _fallbackAccountRegistryService: IChatFallbackAccountRegistryService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@ILogService private readonly _logService: ILogService,
	) {
	}

	getActiveChatAccount(): AuthenticationSessionAccountInformation | undefined {
		this.ensureActiveAccountLoaded();
		return this._activeChatAccount;
	}

	async setActiveChatAccount(account: AuthenticationSessionAccountInformation | undefined): Promise<void> {
		this.ensureActiveAccountLoaded();
		this._activeChatAccount = account ? this.toAccount(account) : undefined;
		await this.persistActiveChatAccount(this._activeChatAccount);
	}

	async getCurrentChatAccount(): Promise<AuthenticationSessionAccountInformation | undefined> {
		const currentSession = await this.getCurrentChatSession();
		return currentSession?.account;
	}

	async getCurrentChatSession(): Promise<AuthenticationSession | undefined> {
		this.ensureActiveAccountLoaded();

		const activeAccount = this._activeChatAccount;
		if (activeAccount) {
			const session = await getAnyAuthSession(this._configurationService, { silent: true, account: activeAccount });
			if (session) {
				if (session.account.id !== activeAccount.id || session.account.label !== activeAccount.label) {
					this._activeChatAccount = this.toAccount(session.account);
					await this.persistActiveChatAccount(this._activeChatAccount);
				}
				return session;
			}

			this._logService.debug(`ChatFallbackAccountResolverService: clearing stale active chat account ${activeAccount.id}.`);
			this._activeChatAccount = undefined;
			await this.persistActiveChatAccount(undefined);
		}

		return await getAnyAuthSession(this._configurationService, { silent: true });
	}

	async resolveNextEligibleFallbackSession(attemptedAccountIds: readonly string[]): Promise<ChatFallbackResolvedSession | undefined> {
		const configuredAccounts = await this._fallbackAccountRegistryService.getConfiguredAccounts();
		const currentAccount = await this.getCurrentChatAccount();
		const attemptedAccountIdSet = new Set(attemptedAccountIds);
		const availableAccounts = new Map((await authentication.getAccounts(authProviderId(this._configurationService))).map(account => [account.id, account]));

		for (const registryEntry of configuredAccounts) {
			if (attemptedAccountIdSet.has(registryEntry.id) || currentAccount?.id === registryEntry.id) {
				continue;
			}

			const availableAccount = availableAccounts.get(registryEntry.id);
			if (!availableAccount) {
				continue;
			}

			const session = await getAnyAuthSession(this._configurationService, { silent: true, account: availableAccount });
			if (!session) {
				continue;
			}

			return {
				account: this.toAccount(session.account),
				registryEntry,
				session,
			};
		}

		return undefined;
	}

	private ensureActiveAccountLoaded(): void {
		if (this._didLoadActiveAccount) {
			return;
		}

		this._didLoadActiveAccount = true;
		const storedAccount = this._extensionContext.globalState.get<unknown>(ChatFallbackAccountResolverService.ACTIVE_ACCOUNT_STORAGE_KEY);
		this._activeChatAccount = this.sanitizeStoredAccount(storedAccount);
		if (storedAccount !== undefined && !this._activeChatAccount) {
			void this.persistActiveChatAccount(undefined);
		}
	}

	private sanitizeStoredAccount(value: unknown): AuthenticationSessionAccountInformation | undefined {
		if (!value || typeof value !== 'object') {
			return undefined;
		}

		const candidate = value as Record<string, unknown>;
		const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
		const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
		if (!id || !label) {
			return undefined;
		}

		return { id, label };
	}

	private async persistActiveChatAccount(account: AuthenticationSessionAccountInformation | undefined): Promise<void> {
		await this._extensionContext.globalState.update(
			ChatFallbackAccountResolverService.ACTIVE_ACCOUNT_STORAGE_KEY,
			account ? this.toAccount(account) : undefined,
		);
	}

	private toAccount(account: AuthenticationSessionAccountInformation): AuthenticationSessionAccountInformation {
		return {
			id: account.id,
			label: account.label,
		};
	}
}
