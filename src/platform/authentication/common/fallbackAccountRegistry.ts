/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationSessionAccountInformation } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export type ChatFallbackAccountEntry = {
	readonly id: string;
	readonly label: string;
};

export const IChatFallbackAccountRegistryService = createServiceIdentifier<IChatFallbackAccountRegistryService>('IChatFallbackAccountRegistryService');

/**
 * Stores the ordered list of user-approved GitHub accounts that Copilot Chat may use for
 * fallback-account retry.
 */
export interface IChatFallbackAccountRegistryService {
	readonly _serviceBrand: undefined;

	getConfiguredAccounts(): Promise<readonly ChatFallbackAccountEntry[]>;
	addConfiguredAccount(account: AuthenticationSessionAccountInformation): Promise<readonly ChatFallbackAccountEntry[]>;
	moveConfiguredAccount(accountId: string, toIndex: number): Promise<readonly ChatFallbackAccountEntry[]>;
	removeConfiguredAccount(accountId: string): Promise<readonly ChatFallbackAccountEntry[]>;
	setConfiguredAccounts(entries: readonly ChatFallbackAccountEntry[]): Promise<readonly ChatFallbackAccountEntry[]>;
}
