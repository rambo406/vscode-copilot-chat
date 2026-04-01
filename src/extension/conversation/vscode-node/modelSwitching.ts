/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { ChatRequest } from '../../../vscodeTypes';

export interface IReasoningEffortFallbackModelConfiguration {
	readonly model: string;
	readonly reasoningEffort?: string;
}

export type ReasoningEffortFallbackModelSetting = string | IReasoningEffortFallbackModelConfiguration | undefined;

export interface IResolvedReasoningEffortFallbackModelSetting {
	readonly modelSelector: string;
	readonly reasoningEffort?: string;
}

export function resolveReasoningEffortFallbackModelSetting(setting: ReasoningEffortFallbackModelSetting): IResolvedReasoningEffortFallbackModelSetting | undefined {
	if (typeof setting === 'string') {
		const modelSelector = setting.trim();
		return modelSelector ? { modelSelector } : undefined;
	}

	if (!setting) {
		return undefined;
	}

	const modelSelector = setting.model.trim();
	if (!modelSelector) {
		return undefined;
	}

	const reasoningEffort = setting.reasoningEffort?.trim();
	return {
		modelSelector,
		reasoningEffort: reasoningEffort ? reasoningEffort : undefined,
	};
}

export function findConfiguredFallbackModel(models: readonly vscode.LanguageModelChat[], selector: string, currentModelId: string | undefined): vscode.LanguageModelChat | undefined {
	const normalizedSelector = selector.trim().toLowerCase();
	if (!normalizedSelector) {
		return undefined;
	}

	const candidates = models
		.filter(model => model.id !== currentModelId)
		.map(model => ({ model, score: getFallbackModelMatchScore(model, normalizedSelector) }))
		.filter((candidate): candidate is { model: vscode.LanguageModelChat; score: number } => candidate.score !== undefined)
		.sort((a, b) => a.score - b.score);

	return candidates[0]?.model;
}

export function applyFallbackModelRequest(request: ChatRequest, fallbackModel: vscode.LanguageModelChat, reasoningEffort?: string): ChatRequest {
	if (!reasoningEffort) {
		return {
			...request,
			model: fallbackModel,
		};
	}

	return {
		...request,
		model: fallbackModel,
		modelConfiguration: {
			...request.modelConfiguration,
			reasoningEffort,
			_skipReasoningEffortOverride: true,
		},
	};
}

function getFallbackModelMatchScore(model: vscode.LanguageModelChat, normalizedSelector: string): number | undefined {
	const values = [model.family, model.id, model.name]
		.filter((value): value is string => typeof value === 'string' && value.length > 0)
		.map(value => value.toLowerCase());

	let bestScore: number | undefined;
	for (const value of values) {
		let score: number | undefined;
		if (value === normalizedSelector) {
			score = 0;
		} else if (value.startsWith(normalizedSelector)) {
			score = 1;
		} else if (normalizedSelector.startsWith(value)) {
			score = 2;
		} else if (value.includes(normalizedSelector)) {
			score = 3;
		} else if (normalizedSelector.includes(value)) {
			score = 4;
		}

		if (score !== undefined && (bestScore === undefined || score < bestScore)) {
			bestScore = score;
		}
	}

	return bestScore;
}

/**
 * Switches the active model to a fallback (Claude Opus 4) when the current model fails.
 * If a suitable fallback is found and differs from the current model, the UI model selector
 * is updated, a warning is streamed, and a new request object with the fallback model is returned.
 * Otherwise, the original request is returned unchanged.
 */
export async function switchToFallbackModel(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<ChatRequest> {
	const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
	const claudeOpus = findConfiguredFallbackModel(fallbackModels, 'claude-opus-4-6', request.model?.id);
	if (!claudeOpus || claudeOpus.id === request.model?.id) {
		return request;
	}
	await vscode.commands.executeCommand('workbench.action.chat.changeModel', { vendor: claudeOpus.vendor, id: claudeOpus.id, family: claudeOpus.family });
	request = applyFallbackModelRequest(request, claudeOpus);
	stream.warning(new vscode.MarkdownString(vscode.l10n.t('The request failed. Automatically retrying with {0}.', claudeOpus.name ?? 'Claude Opus 4.6')));
	return request;
}
