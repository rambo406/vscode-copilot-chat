/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ChatRequest } from '../../../vscodeTypes';

/**
 * Switches the active model to a fallback (Claude Opus 4) when the current model fails.
 * If a suitable fallback is found and differs from the current model, the UI model selector
 * is updated, a warning is streamed, and a new request object with the fallback model is returned.
 * Otherwise, the original request is returned unchanged.
 */
export async function switchToFallbackModel(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<ChatRequest> {
	const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
	const claudeOpus = fallbackModels.find(m => m.family.includes('claude-opus-4-6'));
	if (!claudeOpus || claudeOpus.id === request.model?.id) {
		return request;
	}
	await vscode.commands.executeCommand('workbench.action.chat.changeModel', { vendor: claudeOpus.vendor, id: claudeOpus.id, family: claudeOpus.family });
	request = { ...request, model: claudeOpus };
	stream.warning(new vscode.MarkdownString(vscode.l10n.t('The request failed. Automatically retrying with {0}.', claudeOpus.name ?? 'Claude Opus 4.6')));
	return request;
}
