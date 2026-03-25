/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { ChatFetchResponseType, ChatResponse } from '../../../../platform/chat/common/commonTypes';
import { isUnsupportedModelParameterError, shouldAutoRetryWithFallbackAccount, shouldSignalFallbackAccountRetry } from '../automaticRetryClassifier';

suite('automaticRetryClassifier', () => {
	test('detects unsupported model parameter errors', () => {
		expect(isUnsupportedModelParameterError({ reason: 'Request Failed: 400 {"error":{"message":"Unsupported value: xhigh","code":"invalid_request_body"}}' })).toBe(true);
		expect(isUnsupportedModelParameterError({ reason: 'Unsupported value for parameter reasoning.effort' })).toBe(true);
		expect(isUnsupportedModelParameterError({ reason: 'Internal server error' })).toBe(false);
	});

	const makeRateLimitedResponse = (code?: string): Extract<ChatResponse, { type: ChatFetchResponseType.RateLimited }> => ({
		type: ChatFetchResponseType.RateLimited,
		reason: 'Rate limited',
		requestId: 'test-request-id',
		serverRequestId: undefined,
		retryAfter: undefined,
		rateLimitKey: 'test-rate-limit',
		isAuto: false,
		capiError: code ? { code, message: `rate limit: ${code}` } : undefined,
	});

	test('allows generic and account-level rate limits for fallback-account retry', () => {
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse())).toBe(true);
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse('user_global_rate_limited'))).toBe(true);
	});

	test('excludes model-specific and provider-wide rate limits from fallback-account retry', () => {
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse('user_model_rate_limited'))).toBe(false);
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse('model_overloaded'))).toBe(false);
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse('upstream_provider_rate_limit'))).toBe(false);
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse('integration_rate_limited'))).toBe(false);
		expect(shouldAutoRetryWithFallbackAccount(makeRateLimitedResponse('agent_mode_limit_exceeded'))).toBe(false);
	});

	test('feature gate keeps fallback-account retry disabled as a no-op', () => {
		expect(shouldSignalFallbackAccountRetry(false, makeRateLimitedResponse())).toBe(false);
		expect(shouldSignalFallbackAccountRetry(true, makeRateLimitedResponse())).toBe(true);
	});
});
