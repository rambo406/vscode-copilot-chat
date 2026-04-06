/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ChatRequest } from '../../../vscodeTypes';

const BOOTSTRAP_DEFAULT_MODEL = 'gpt-5-mini';
const BOOTSTRAP_DEFAULT_REASONING_EFFORT = 'xhigh';

export interface BootstrapConfig {
	readonly model: string;
	readonly reasoningEffort: string;
}

/**
 * Parses the bootstrap trigger setting into a resolved config or `undefined` if disabled.
 */
export function parseBootstrapTriggerSetting(configurationService: IConfigurationService): BootstrapConfig | undefined {
	const raw = configurationService.getConfig(ConfigKey.ReasoningEffortBootstrapTrigger);
	if (raw === false || raw === undefined || raw === null) {
		return undefined;
	}
	if (typeof raw === 'object') {
		return {
			model: typeof raw.model === 'string' && raw.model.length > 0 ? raw.model : BOOTSTRAP_DEFAULT_MODEL,
			reasoningEffort: typeof raw.reasoningEffort === 'string' && raw.reasoningEffort.length > 0 ? raw.reasoningEffort : BOOTSTRAP_DEFAULT_REASONING_EFFORT,
		};
	}
	return undefined;
}

/**
 * Determines whether bootstrap should be applied to this request.
 * Bootstrap applies only to the first attempt of the first top-level panel request in a conversation.
 */
export function shouldApplyBootstrap(
	request: ChatRequest,
	historyLength: number,
	bootstrapConfig: BootstrapConfig | undefined,
): boolean {
	if (!bootstrapConfig) {
		return false;
	}
	// Skip if this is not the first turn
	if (historyLength > 0) {
		return false;
	}
	// Skip retries (attempt > 0)
	if (request.attempt > 0) {
		return false;
	}
	// Skip subagent invocations
	if (request.subAgentInvocationId) {
		return false;
	}
	return true;
}

/**
 * Resolves the bootstrap model from available models. Returns `undefined` if the model is unavailable.
 */
export async function resolveBootstrapModel(bootstrapConfig: BootstrapConfig): Promise<vscode.LanguageModelChat | undefined> {
	const models = await vscode.lm.selectChatModels({ family: bootstrapConfig.model, vendor: 'copilot' });
	return models[0];
}

/**
 * Applies the bootstrap override to a request, returning a new request with the bootstrap model
 * and reasoning effort. The original model picker is not changed.
 */
export function applyBootstrapToRequest(
	request: ChatRequest,
	bootstrapModel: vscode.LanguageModelChat,
	bootstrapConfig: BootstrapConfig,
): ChatRequest {
	return {
		...request,
		model: bootstrapModel,
		modelConfiguration: {
			...request.modelConfiguration,
			reasoningEffort: bootstrapConfig.reasoningEffort,
		},
	};
}

/**
 * Attempts to apply the first-turn bootstrap trigger. Returns the (possibly overridden) request
 * and a flag indicating whether bootstrap was applied.
 */
export async function tryApplyBootstrap(
	request: ChatRequest,
	historyLength: number,
	configurationService: IConfigurationService,
	logService: ILogService,
	telemetryService: ITelemetryService,
): Promise<{ request: ChatRequest; bootstrapApplied: boolean }> {
	const bootstrapConfig = parseBootstrapTriggerSetting(configurationService);

	if (!shouldApplyBootstrap(request, historyLength, bootstrapConfig)) {
		if (bootstrapConfig) {
			logService.info('[bootstrap] Skipped: not first top-level panel attempt');
			/* __GDPR__
				"chatBootstrapTrigger" : {
					"owner": "copilot-chat",
					"comment": "Tracks bootstrap trigger application",
					"outcome": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether bootstrap was applied, skipped, or the model was unavailable." }
				}
			*/
			telemetryService.sendMSFTTelemetryEvent('chatBootstrapTrigger', { outcome: 'skipped' });
		}
		return { request, bootstrapApplied: false };
	}

	const bootstrapModel = await resolveBootstrapModel(bootstrapConfig!);
	if (!bootstrapModel) {
		logService.info(`[bootstrap] Skipped: bootstrap model '${bootstrapConfig!.model}' is unavailable`);
		telemetryService.sendMSFTTelemetryEvent('chatBootstrapTrigger', { outcome: 'model_unavailable' });
		return { request, bootstrapApplied: false };
	}

	logService.info(`[bootstrap] Applied: model=${bootstrapConfig!.model}, reasoningEffort=${bootstrapConfig!.reasoningEffort}`);
	telemetryService.sendMSFTTelemetryEvent('chatBootstrapTrigger', {
		outcome: 'applied',
		bootstrapModel: bootstrapConfig!.model,
		bootstrapReasoningEffort: bootstrapConfig!.reasoningEffort,
	});

	const overriddenRequest = applyBootstrapToRequest(request, bootstrapModel, bootstrapConfig!);
	return { request: overriddenRequest, bootstrapApplied: true };
}
