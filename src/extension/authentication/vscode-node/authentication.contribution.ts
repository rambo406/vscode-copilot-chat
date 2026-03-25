/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { authentication, commands, l10n, window } from 'vscode';
import { authProviderId, IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IAuthenticationChatUpgradeService } from '../../../platform/authentication/common/authenticationUpgrade';
import { IChatFallbackAccountResolverService } from '../../../platform/authentication/common/chatFallbackAccountResolver';
import { IChatFallbackAccountRegistryService } from '../../../platform/authentication/common/fallbackAccountRegistry';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';

const manageFallbackAccountsCommandId = 'github.copilot.chat.fallbackAccounts.manage';
const addFallbackAccountCommandId = 'github.copilot.chat.fallbackAccounts.add';
const reorderFallbackAccountsCommandId = 'github.copilot.chat.fallbackAccounts.reorder';
const removeFallbackAccountCommandId = 'github.copilot.chat.fallbackAccounts.remove';

/**
 * The main entry point for the authentication contribution.
 */
export class AuthenticationContrib extends Disposable {
	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) {
		super();
		this._register(this.instantiationService.createInstance(ChatFallbackAccountCommands));
		this.askToUpgradeAuthPermissions();
	}
	private async askToUpgradeAuthPermissions() {
		const authUpgradeAsk = this._register(this.instantiationService.createInstance(AuthUpgradeAsk));
		await authUpgradeAsk.run();
	}
}

class ChatFallbackAccountCommands extends Disposable {
	constructor(
		@IChatFallbackAccountResolverService private readonly _fallbackAccountResolverService: IChatFallbackAccountResolverService,
		@IChatFallbackAccountRegistryService private readonly _fallbackAccountRegistryService: IChatFallbackAccountRegistryService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		this._register(commands.registerCommand(manageFallbackAccountsCommandId, async () => {
			await this.manageFallbackAccounts();
		}));
		this._register(commands.registerCommand(addFallbackAccountCommandId, async () => {
			await this.addFallbackAccount();
		}));
		this._register(commands.registerCommand(reorderFallbackAccountsCommandId, async () => {
			await this.reorderFallbackAccounts();
		}));
		this._register(commands.registerCommand(removeFallbackAccountCommandId, async () => {
			await this.removeFallbackAccount();
		}));
	}

	private async manageFallbackAccounts(): Promise<void> {
		const configuredAccounts = await this._fallbackAccountRegistryService.getConfiguredAccounts();
		const configuredSummary = configuredAccounts.length > 0
			? configuredAccounts.map((entry, index) => `${index + 1}. ${entry.label}`).join('  •  ')
			: l10n.t('None configured yet');

		const selection = await window.showQuickPick([
			{
				label: l10n.t('Add Fallback GitHub Account'),
				description: l10n.t('Enroll another signed-in GitHub account for Copilot Chat retry'),
				commandId: addFallbackAccountCommandId,
			},
			{
				label: l10n.t('Reorder Fallback GitHub Accounts'),
				description: l10n.t('Change the order used for Copilot Chat fallback-account retry'),
				commandId: reorderFallbackAccountsCommandId,
			},
			{
				label: l10n.t('Remove Fallback GitHub Account'),
				description: l10n.t('Stop using an account for Copilot Chat fallback-account retry'),
				commandId: removeFallbackAccountCommandId,
			},
		], {
			title: l10n.t('Manage fallback GitHub accounts for Copilot Chat retry'),
			placeHolder: l10n.t('Configured retry order: {0}. This manages account-level retry only and does not change the Auto model fallback setting.', configuredSummary),
		});

		if (!selection) {
			return;
		}

		await commands.executeCommand(selection.commandId);
	}

	private async addFallbackAccount(): Promise<void> {
		const configuredAccounts = await this._fallbackAccountRegistryService.getConfiguredAccounts();
		const configuredIds = new Set(configuredAccounts.map(entry => entry.id));
		const activeAccountLabel = (await this._fallbackAccountResolverService.getCurrentChatAccount())?.label;
		const providerId = authProviderId(this._configurationService);
		const availableAccounts = (await authentication.getAccounts(providerId))
			.filter(account => !configuredIds.has(account.id))
			.filter(account => account.label !== activeAccountLabel);

		if (availableAccounts.length === 0) {
			const message = activeAccountLabel
				? l10n.t('No additional signed-in GitHub accounts are available to enroll for Copilot Chat fallback-account retry. Sign in to another GitHub account in VS Code first.')
				: l10n.t('No signed-in GitHub accounts are available to enroll for Copilot Chat fallback-account retry. Sign in to GitHub in VS Code first.');
			await window.showInformationMessage(message);
			return;
		}

		const selected = await window.showQuickPick(availableAccounts.map(account => ({
			label: account.label,
			description: l10n.t('Use this account only after a generic account-level rate limit. This does not switch models.'),
			account,
		})), {
			title: l10n.t('Add a fallback GitHub account for Copilot Chat retry'),
			placeHolder: l10n.t('Select a signed-in GitHub account to preconfigure for automatic fallback-account retry in Copilot Chat.'),
		});

		if (!selected) {
			return;
		}

		await this._fallbackAccountRegistryService.addConfiguredAccount(selected.account);
		await window.showInformationMessage(l10n.t('Added {0} to the Copilot Chat fallback-account retry order.', selected.account.label));
	}

	private async reorderFallbackAccounts(): Promise<void> {
		const configuredAccounts = await this._fallbackAccountRegistryService.getConfiguredAccounts();
		if (configuredAccounts.length < 2) {
			await window.showInformationMessage(l10n.t('Add at least two fallback GitHub accounts before reordering the Copilot Chat retry order.'));
			return;
		}

		const selected = await window.showQuickPick(configuredAccounts.map((entry, index) => ({
			label: `${index + 1}. ${entry.label}`,
			description: index === 0 ? l10n.t('First fallback retry choice') : undefined,
			entry,
			index,
		})), {
			title: l10n.t('Reorder fallback GitHub accounts for Copilot Chat retry'),
			placeHolder: l10n.t('Select the fallback account to move. This affects account retry order only and does not change the Auto model fallback setting.'),
		});

		if (!selected) {
			return;
		}

		const target = await window.showQuickPick(configuredAccounts.map((entry, index) => ({
			label: l10n.t('Move to position {0}', index + 1),
			description: index === selected.index ? l10n.t('Current position') : entry.label,
			index,
		})), {
			title: l10n.t('Choose a new fallback retry position'),
			placeHolder: l10n.t('Select the new retry position for {0}.', selected.entry.label),
		});

		if (!target || target.index === selected.index) {
			return;
		}

		await this._fallbackAccountRegistryService.moveConfiguredAccount(selected.entry.id, target.index);
		const movedAccount = configuredAccounts[selected.index];
		await window.showInformationMessage(l10n.t('Moved {0} to fallback retry position {1}.', movedAccount.label, target.index + 1));
	}

	private async removeFallbackAccount(): Promise<void> {
		const configuredAccounts = await this._fallbackAccountRegistryService.getConfiguredAccounts();
		if (configuredAccounts.length === 0) {
			await window.showInformationMessage(l10n.t('No fallback GitHub accounts are currently configured for Copilot Chat retry.'));
			return;
		}

		const selected = await window.showQuickPick(configuredAccounts.map((entry, index) => ({
			label: entry.label,
			description: l10n.t('Current fallback retry position {0}', index + 1),
			entry,
		})), {
			title: l10n.t('Remove a fallback GitHub account from Copilot Chat retry'),
			placeHolder: l10n.t('Select the fallback account to remove. This changes account retry only and does not affect model fallback.'),
		});

		if (!selected) {
			return;
		}

		const confirmLabel = l10n.t('Remove');
		const confirmation = await window.showWarningMessage(
			l10n.t('Remove {0} from the Copilot Chat fallback-account retry order?', selected.entry.label),
			{ modal: true },
			confirmLabel,
		);
		if (confirmation !== confirmLabel) {
			return;
		}

		await this._fallbackAccountRegistryService.removeConfiguredAccount(selected.entry.id);
		await window.showInformationMessage(l10n.t('Removed {0} from the Copilot Chat fallback-account retry order.', selected.entry.label));
	}
}

/**
 * This contribution ensures we have a token that is good enough for making API calls for current workspace.
 */
class AuthUpgradeAsk extends Disposable {
	private static readonly AUTH_UPGRADE_ASK_KEY = 'copilot.shownPermissiveTokenModal';

	constructor(
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IAuthenticationChatUpgradeService private readonly _authenticationChatUpgradeService: IAuthenticationChatUpgradeService,
	) {
		super();
		this._register(commands.registerCommand('github.copilot.chat.triggerPermissiveSignIn', async () => {
			await this._authenticationChatUpgradeService.showPermissiveSessionModal(true);
		}));
	}

	async run() {
		await this.waitForChatEnabled();
		this.registerListeners();
		await this.showPrompt();
	}

	private async waitForChatEnabled() {
		try {
			await this._authenticationService.getCopilotToken();
		} catch (error) {
			// likely due to the user canceling the auth flow
			this._logService.error(error, 'Failed to get copilot token');
		}

		await Event.toPromise(
			Event.filter(
				this._authenticationService.onDidAuthenticationChange,
				() => this._authenticationService.copilotToken !== undefined
			)
		);
	}

	private registerListeners() {
		this._register(this._authenticationService.onDidAuthenticationChange(async () => {
			if (this._authenticationService.permissiveGitHubSession) {
				return;
			}
			if (!this._authenticationService.anyGitHubSession) {
				// We signed out, so we should show the prompt again
				this._extensionContext.globalState.update(AuthUpgradeAsk.AUTH_UPGRADE_ASK_KEY, false);
				return;
			}
			if (window.state.focused) {
				await this.showPrompt();
			} else {
				// Wait for the window to get focus before trying to show the prompt
				const disposable = window.onDidChangeWindowState(async (e) => {
					if (e.focused) {
						disposable.dispose();
						await this.showPrompt();
					}
				});
			}
		}));
	}

	private async showPrompt() {
		if (
			// Already asked in a previous session
			this._extensionContext.globalState.get(AuthUpgradeAsk.AUTH_UPGRADE_ASK_KEY, false)
			// Some other criteria for not showing the prompt
			|| !(await this._authenticationChatUpgradeService.shouldRequestPermissiveSessionUpgrade())
		) {
			return;
		}
		if (await this._authenticationChatUpgradeService.showPermissiveSessionModal()) {
			this._logService.debug('Got permissive GitHub token');
		} else {
			this._logService.debug('Did not get permissive GitHub token');
		}
		this._extensionContext.globalState.update(AuthUpgradeAsk.AUTH_UPGRADE_ASK_KEY, true);
	}
}
