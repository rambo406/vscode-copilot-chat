/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationSession, AuthenticationSessionAccountInformation } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { ChatFallbackAccountEntry } from './fallbackAccountRegistry';

export type ChatFallbackResolvedSession = {
	readonly account: AuthenticationSessionAccountInformation;
	readonly registryEntry: ChatFallbackAccountEntry;
	readonly session: AuthenticationSession;
};

export const IChatFallbackAccountResolverService = createServiceIdentifier<IChatFallbackAccountResolverService>('IChatFallbackAccountResolverService');

/**
 * Resolves the active Copilot Chat account and silent fallback-account candidates for
 * account-level rate-limit recovery.
 */
export interface IChatFallbackAccountResolverService {
	readonly _serviceBrand: undefined;

	getActiveChatAccount(): AuthenticationSessionAccountInformation | undefined;
	setActiveChatAccount(account: AuthenticationSessionAccountInformation | undefined): Promise<void>;
	getCurrentChatAccount(): Promise<AuthenticationSessionAccountInformation | undefined>;
	getCurrentChatSession(): Promise<AuthenticationSession | undefined>;
	resolveNextEligibleFallbackSession(attemptedAccountIds: readonly string[]): Promise<ChatFallbackResolvedSession | undefined>;
}
