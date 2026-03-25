/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { authentication, AuthenticationSessionAccountInformation } from 'vscode';
import { IConfigurationService } from '../../configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../extContext/common/extensionContext';
import { ILogService } from '../../log/common/logService';
import { authProviderId } from '../common/authentication';
import { ChatFallbackAccountEntry, IChatFallbackAccountRegistryService } from '../common/fallbackAccountRegistry';

export class ChatFallbackAccountRegistryService implements IChatFallbackAccountRegistryService {
	declare readonly _serviceBrand: undefined;

	private static readonly STORAGE_KEY = 'github.copilot.chat.fallbackAccountRegistry';

	constructor(
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
	}

	async getConfiguredAccounts(): Promise<readonly ChatFallbackAccountEntry[]> {
		const storedEntries = this._extensionContext.globalState.get<unknown>(ChatFallbackAccountRegistryService.STORAGE_KEY);
		const sanitizedEntries = this.sanitizeStoredEntries(storedEntries);
		const validatedEntries = await this.validateStoredEntries(sanitizedEntries);

		if (!this.areEntriesEqual(storedEntries, validatedEntries)) {
			await this.persistEntries(validatedEntries);
		}

		return validatedEntries;
	}

	async addConfiguredAccount(account: AuthenticationSessionAccountInformation): Promise<readonly ChatFallbackAccountEntry[]> {
		const configuredAccounts = await this.getConfiguredAccounts();
		if (configuredAccounts.some(entry => entry.id === account.id)) {
			return configuredAccounts;
		}

		return await this.persistAndReturn(configuredAccounts.concat(this.toEntry(account)));
	}

	async moveConfiguredAccount(accountId: string, toIndex: number): Promise<readonly ChatFallbackAccountEntry[]> {
		const configuredAccounts = await this.getConfiguredAccounts();
		const currentIndex = configuredAccounts.findIndex(entry => entry.id === accountId);
		if (currentIndex === -1) {
			return configuredAccounts;
		}

		const targetIndex = Math.max(0, Math.min(toIndex, configuredAccounts.length - 1));
		if (targetIndex === currentIndex) {
			return configuredAccounts;
		}

		const reorderedAccounts = configuredAccounts.slice();
		const [movedAccount] = reorderedAccounts.splice(currentIndex, 1);
		reorderedAccounts.splice(targetIndex, 0, movedAccount);
		return await this.persistAndReturn(reorderedAccounts);
	}

	async removeConfiguredAccount(accountId: string): Promise<readonly ChatFallbackAccountEntry[]> {
		const configuredAccounts = await this.getConfiguredAccounts();
		const filteredAccounts = configuredAccounts.filter(entry => entry.id !== accountId);
		if (filteredAccounts.length === configuredAccounts.length) {
			return configuredAccounts;
		}

		return await this.persistAndReturn(filteredAccounts);
	}

	async setConfiguredAccounts(entries: readonly ChatFallbackAccountEntry[]): Promise<readonly ChatFallbackAccountEntry[]> {
		return await this.persistAndReturn(entries);
	}

	private async persistAndReturn(entries: readonly ChatFallbackAccountEntry[]): Promise<readonly ChatFallbackAccountEntry[]> {
		const sanitizedEntries = this.sanitizeStoredEntries(entries);
		await this.persistEntries(sanitizedEntries);
		return sanitizedEntries;
	}

	private async validateStoredEntries(entries: readonly ChatFallbackAccountEntry[]): Promise<readonly ChatFallbackAccountEntry[]> {
		if (entries.length === 0) {
			return entries;
		}

		try {
			const availableAccounts = await authentication.getAccounts(authProviderId(this._configurationService));
			const availableAccountsById = new Map(availableAccounts.map(account => [account.id, account]));
			const validatedEntries: ChatFallbackAccountEntry[] = [];

			for (const entry of entries) {
				const account = availableAccountsById.get(entry.id);
				if (!account) {
					this._logService.debug(`ChatFallbackAccountRegistryService: pruning fallback account ${entry.id} because it is no longer signed in.`);
					continue;
				}

				validatedEntries.push({
					id: account.id,
					label: account.label,
				});
			}

			return validatedEntries;
		} catch (error) {
			this._logService.error(
				error instanceof Error ? error : new Error(String(error)),
				'ChatFallbackAccountRegistryService: failed to validate stored fallback accounts; preserving sanitized entries.',
			);
			return entries;
		}
	}

	private sanitizeStoredEntries(value: unknown): ChatFallbackAccountEntry[] {
		if (!Array.isArray(value)) {
			return [];
		}

		const sanitizedEntries: ChatFallbackAccountEntry[] = [];
		const seenIds = new Set<string>();

		for (const candidate of value) {
			if (!candidate || typeof candidate !== 'object') {
				continue;
			}

			const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
			const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
			if (!id || !label || seenIds.has(id)) {
				continue;
			}

			seenIds.add(id);
			sanitizedEntries.push({ id, label });
		}

		return sanitizedEntries;
	}

	private async persistEntries(entries: readonly ChatFallbackAccountEntry[]): Promise<void> {
		await this._extensionContext.globalState.update(
			ChatFallbackAccountRegistryService.STORAGE_KEY,
			entries.length > 0 ? entries : undefined,
		);
	}

	private toEntry(account: AuthenticationSessionAccountInformation): ChatFallbackAccountEntry {
		return {
			id: account.id,
			label: account.label,
		};
	}

	private areEntriesEqual(value: unknown, entries: readonly ChatFallbackAccountEntry[]): boolean {
		if (!Array.isArray(value) || value.length !== entries.length) {
			return false;
		}

		for (let i = 0; i < value.length; i++) {
			const candidate = value[i];
			const entry = entries[i];
			if (!candidate || typeof candidate !== 'object' || candidate.id !== entry.id || candidate.label !== entry.label) {
				return false;
			}
		}

		return true;
	}
}
