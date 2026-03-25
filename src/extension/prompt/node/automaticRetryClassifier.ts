/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatFetchResponseType, ChatResponse } from '../../../platform/chat/common/commonTypes';

export function isUnsupportedModelParameterError(fetchResult: { reason: string }): boolean {
	return fetchResult.reason.includes('"code":"invalid_request_body"')
		|| fetchResult.reason.includes('Unsupported value');
}

export function shouldAutoRetryWithFallbackAccount(fetchResult: Extract<ChatResponse, { type: ChatFetchResponseType.RateLimited }>): boolean {
	const rateLimitCode = fetchResult.capiError?.code;
	if (!rateLimitCode) {
		return true;
	}

	return !rateLimitCode.startsWith('user_model_rate_limited')
		&& !rateLimitCode.startsWith('model_overloaded')
		&& !rateLimitCode.startsWith('upstream_provider_rate_limit')
		&& !rateLimitCode.startsWith('integration_rate_limited')
		&& !rateLimitCode.startsWith('agent_mode_limit_exceeded');
}

export function shouldSignalFallbackAccountRetry(featureEnabled: boolean, fetchResult: Extract<ChatResponse, { type: ChatFetchResponseType.RateLimited }>): boolean {
	return featureEnabled && shouldAutoRetryWithFallbackAccount(fetchResult);
}
