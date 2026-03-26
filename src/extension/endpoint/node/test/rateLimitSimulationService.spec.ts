/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, suite, test } from 'vitest';
import { ChatFetchResponseType } from '../../../../platform/chat/common/commonTypes';
import { RateLimitSimulationService } from '../../../../platform/endpoint/common/rateLimitSimulationService';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { shouldAutoRetryWithFallbackAccount } from '../../../prompt/node/automaticRetryClassifier';

suite('RateLimitSimulationService', () => {
	let service: RateLimitSimulationService;

	beforeEach(() => {
		service = new RateLimitSimulationService(new TestLogService());
	});

	test('starts disarmed', () => {
		expect(service.isArmed()).toBe(false);
	});

	test('arm() sets armed state to true', () => {
		service.arm();
		expect(service.isArmed()).toBe(true);
	});

	test('disarm() sets armed state to false', () => {
		service.arm();
		service.disarm();
		expect(service.isArmed()).toBe(false);
	});

	test('arm/disarm toggling works correctly', () => {
		expect(service.isArmed()).toBe(false);
		service.arm();
		expect(service.isArmed()).toBe(true);
		service.disarm();
		expect(service.isArmed()).toBe(false);
		service.arm();
		expect(service.isArmed()).toBe(true);
	});

	test('consume() returns undefined when disarmed', () => {
		expect(service.consume()).toBeUndefined();
	});

	test('consume() returns a RateLimited error when armed', () => {
		service.arm();
		const error = service.consume();
		expect(error).toBeDefined();
		expect(error!.type).toBe(ChatFetchResponseType.RateLimited);
	});

	test('consume() returns error with expected fields', () => {
		service.arm();
		const error = service.consume();
		expect(error).toBeDefined();
		expect(error!.type).toBe(ChatFetchResponseType.RateLimited);
		expect(error!.reason).toContain('Simulated');
		expect(error!.requestId).toBeTruthy();
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(error!.retryAfter).toBe(5);
			expect(error!.rateLimitKey).toBe('simulated-rate-limit');
			expect(error!.isAuto).toBe(false);
		}
	});

	test('one-shot auto-disarm: armed by default, consume once, then disarmed', () => {
		service.arm();
		expect(service.isArmed()).toBe(true);
		const error = service.consume();
		expect(error).toBeDefined();
		expect(service.isArmed()).toBe(false);
	});

	test('one-shot: second consume returns undefined after auto-disarm', () => {
		service.arm();
		service.consume();
		expect(service.consume()).toBeUndefined();
	});

	test('multi-shot countdown: arm with shots=3, all 3 consumes return errors', () => {
		service.arm({ shots: 3 });
		expect(service.isArmed()).toBe(true);

		const error1 = service.consume();
		expect(error1).toBeDefined();
		expect(service.isArmed()).toBe(true);

		const error2 = service.consume();
		expect(error2).toBeDefined();
		expect(service.isArmed()).toBe(true);

		const error3 = service.consume();
		expect(error3).toBeDefined();
		expect(service.isArmed()).toBe(false);
	});

	test('multi-shot: consume after all shots exhausted returns undefined', () => {
		service.arm({ shots: 2 });
		service.consume();
		service.consume();
		expect(service.consume()).toBeUndefined();
	});

	test('no capiError when armed without a code', () => {
		service.arm();
		const error = service.consume();
		expect(error).toBeDefined();
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(error!.capiError).toBeUndefined();
		}
	});

	test('custom capiError.code is included in consumed error', () => {
		service.arm({ code: 'user_model_rate_limited' });
		const error = service.consume();
		expect(error).toBeDefined();
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(error!.capiError).toBeDefined();
			expect(error!.capiError!.code).toBe('user_model_rate_limited');
			expect(error!.capiError!.message).toContain('user_model_rate_limited');
		}
	});

	test('onDidChangeArmedState fires true on arm()', () => {
		const events: boolean[] = [];
		service.onDidChangeArmedState(v => events.push(v));

		service.arm();
		expect(events).toEqual([true]);
	});

	test('onDidChangeArmedState fires false on disarm()', () => {
		const events: boolean[] = [];
		service.arm();
		service.onDidChangeArmedState(v => events.push(v));

		service.disarm();
		expect(events).toEqual([false]);
	});

	test('onDidChangeArmedState fires false on auto-disarm after last shot consumed', () => {
		const events: boolean[] = [];
		service.onDidChangeArmedState(v => events.push(v));

		service.arm();
		expect(events).toEqual([true]);

		service.consume(); // auto-disarms
		expect(events).toEqual([true, false]);
	});

	test('onDidChangeArmedState fires correct sequence for multi-shot', () => {
		const events: boolean[] = [];
		service.onDidChangeArmedState(v => events.push(v));

		service.arm({ shots: 2 });
		expect(events).toEqual([true]);

		service.consume(); // shot 1, still armed — no state-change event
		expect(events).toEqual([true]);

		service.consume(); // shot 2, auto-disarms
		expect(events).toEqual([true, false]);
	});

	test('re-arming after auto-disarm fires armed event again', () => {
		const events: boolean[] = [];
		service.onDidChangeArmedState(v => events.push(v));

		service.arm();
		service.consume(); // auto-disarm
		service.arm();
		expect(events).toEqual([true, false, true]);
	});
});

suite('Synthetic error integration with shouldAutoRetryWithFallbackAccount', () => {
	let service: RateLimitSimulationService;

	beforeEach(() => {
		service = new RateLimitSimulationService(new TestLogService());
	});

	test('default synthetic error (no capiError.code) passes shouldAutoRetryWithFallbackAccount', () => {
		service.arm();
		const error = service.consume();
		expect(error).toBeDefined();
		expect(error!.type).toBe(ChatFetchResponseType.RateLimited);
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(shouldAutoRetryWithFallbackAccount(error!)).toBe(true);
		}
	});

	test('synthetic error with user_model_rate_limited does NOT pass shouldAutoRetryWithFallbackAccount', () => {
		service.arm({ code: 'user_model_rate_limited' });
		const error = service.consume();
		expect(error).toBeDefined();
		expect(error!.type).toBe(ChatFetchResponseType.RateLimited);
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(shouldAutoRetryWithFallbackAccount(error!)).toBe(false);
		}
	});

	test('synthetic error with model_overloaded does NOT pass shouldAutoRetryWithFallbackAccount', () => {
		service.arm({ code: 'model_overloaded' });
		const error = service.consume();
		expect(error).toBeDefined();
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(shouldAutoRetryWithFallbackAccount(error!)).toBe(false);
		}
	});

	test('synthetic error with upstream_provider_rate_limit does NOT pass shouldAutoRetryWithFallbackAccount', () => {
		service.arm({ code: 'upstream_provider_rate_limit' });
		const error = service.consume();
		expect(error).toBeDefined();
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(shouldAutoRetryWithFallbackAccount(error!)).toBe(false);
		}
	});

	test('synthetic error with generic code passes shouldAutoRetryWithFallbackAccount', () => {
		service.arm({ code: 'some_other_rate_limit_code' });
		const error = service.consume();
		expect(error).toBeDefined();
		if (error!.type === ChatFetchResponseType.RateLimited) {
			expect(shouldAutoRetryWithFallbackAccount(error!)).toBe(true);
		}
	});
});

suite('RateLimitSimulationService endpoint interception pattern', () => {
	let service: RateLimitSimulationService;

	beforeEach(() => {
		service = new RateLimitSimulationService(new TestLogService());
	});

	test('armed service produces error on first consume, then undefined after auto-disarm', () => {
		service.arm();

		// Simulates the endpoint interception: check consume() before making real request
		const intercepted = service.consume();
		expect(intercepted).toBeDefined();
		expect(intercepted!.type).toBe(ChatFetchResponseType.RateLimited);

		// Subsequent call should pass through (undefined means no interception)
		const passThrough = service.consume();
		expect(passThrough).toBeUndefined();
	});

	test('multi-shot interception: 3 consecutive requests are intercepted, 4th passes through', () => {
		service.arm({ shots: 3 });

		expect(service.consume()).toBeDefined();
		expect(service.consume()).toBeDefined();
		expect(service.consume()).toBeDefined();
		expect(service.consume()).toBeUndefined();
	});

	test('disarming mid-way stops interception immediately', () => {
		service.arm({ shots: 5 });

		expect(service.consume()).toBeDefined();
		expect(service.consume()).toBeDefined();

		service.disarm();

		expect(service.consume()).toBeUndefined();
		expect(service.isArmed()).toBe(false);
	});

	// Task 6.4: Command/button visibility gating is verified by the `when` clause
	// in package.json: the `commandPalette` entry for
	// `github.copilot.chat.debug.simulateRateLimit` has "when": "github.copilot.chat.debug",
	// ensuring the command only appears when the debug context key is set.
	// This is a static package.json contribution and does not require a runtime test.
});
