/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { commands } from 'vscode';
import { IRateLimitSimulationService } from '../../../platform/endpoint/common/rateLimitSimulationService';
import { IEnvService } from '../../../platform/env/common/envService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

export class RateLimitSimulationContribution extends Disposable {

	constructor(
		@IRateLimitSimulationService private readonly _rateLimitSimulationService: IRateLimitSimulationService,
		@IEnvService private readonly _envService: IEnvService,
	) {
		super();

		// Register toggle command (always register; when clause in package.json gates visibility)
		this._register(commands.registerCommand('github.copilot.chat.debug.simulateRateLimit', (args?: { code?: string; shots?: number }) => {
			if (this._rateLimitSimulationService.isArmed()) {
				this._rateLimitSimulationService.disarm();
			} else {
				this._rateLimitSimulationService.arm(args);
			}
		}));

		// Update context key whenever the armed state changes
		this._updateContextKey(this._rateLimitSimulationService.isArmed());
		this._register(this._rateLimitSimulationService.onDidChangeArmedState(armed => {
			this._updateContextKey(armed);
		}));

		// Status bar toggle (debug / non-production builds only)
		if (!this._envService.isProduction()) {
			const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
			statusBar.command = 'github.copilot.chat.debug.simulateRateLimit';
			this._updateStatusBar(statusBar, this._rateLimitSimulationService.isArmed());
			this._register(statusBar);
			this._register(this._rateLimitSimulationService.onDidChangeArmedState(armed => {
				this._updateStatusBar(statusBar, armed);
			}));
			statusBar.show();
		}
	}

	private _updateContextKey(armed: boolean): void {
		commands.executeCommand('setContext', 'github.copilot.chat.debug.rateLimitSimulationArmed', armed);
	}

	private _updateStatusBar(statusBar: vscode.StatusBarItem, armed: boolean): void {
		if (armed) {
			statusBar.text = '$(warning) Rate Limit Sim: Armed';
			statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			statusBar.tooltip = 'Rate-limit simulation is armed. Click to disarm.';
		} else {
			statusBar.text = '$(circle-slash) Rate Limit Sim';
			statusBar.backgroundColor = undefined;
			statusBar.tooltip = 'Rate-limit simulation is disarmed. Click to arm.';
		}
	}
}
