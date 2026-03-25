/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { resolveReasoningEffortDefault } from '../../common/reasoningEffort';
import { buildConfigurationSchema } from '../languageModelAccess';

function createMockLogService(): ILogService {
	return {
		_serviceBrand: undefined,
		trace: () => { },
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
		show: () => { },
		subLogger: () => createMockLogService(),
	} as unknown as ILogService;
}

function createMockConfigurationService(overrides: Record<string, unknown> = {}): IConfigurationService {
	return {
		_serviceBrand: undefined,
		getConfig: (key: { fullyQualifiedId: string }) => overrides[key.fullyQualifiedId],
		inspectConfig: () => undefined,
		isConfigured: () => false,
		getNonExtensionConfig: () => undefined,
		setConfig: () => Promise.resolve(),
		getExperimentBasedConfig: () => undefined,
		onDidChangeConfiguration: { event: () => ({ dispose: () => { } }) },
	} as unknown as IConfigurationService;
}

function createMockEndpoint(family: string, effortLevels: string[]): IChatEndpoint {
	return {
		family,
		supportsReasoningEffort: effortLevels,
	} as unknown as IChatEndpoint;
}

describe('buildConfigurationSchema', () => {
	it('includes "Extra High" label and correct description for xhigh effort level', () => {
		const endpoint = createMockEndpoint('claude-sonnet-4', ['low', 'medium', 'high', 'xhigh']);
		const logService = createMockLogService();
		const configurationService = createMockConfigurationService();

		const result = buildConfigurationSchema(endpoint, logService, configurationService);

		expect(result.configurationSchema).toBeDefined();
		const reasoningEffort = result.configurationSchema?.properties?.['reasoningEffort'];
		expect(reasoningEffort).toBeDefined();
		if (!reasoningEffort) {
			throw new Error('Expected reasoningEffort schema to be defined');
		}

		// Verify the enum includes xhigh
		expect(reasoningEffort.enum).toContain('xhigh');

		// Find the index of xhigh in the enum to check its label and description
		const xhighIndex = reasoningEffort.enum!.indexOf('xhigh');
		expect(xhighIndex).toBeGreaterThanOrEqual(0);

		// Verify the label for xhigh is "Extra High"
		expect(reasoningEffort.enumItemLabels![xhighIndex]).toBe('Extra High');

		// Verify the description for xhigh
		expect(reasoningEffort.enumDescriptions![xhighIndex]).toBe('Extended reasoning for the most complex tasks');
	});

	it('produces capitalized labels for standard effort levels', () => {
		const endpoint = createMockEndpoint('claude-sonnet-4', ['low', 'medium', 'high', 'xhigh']);
		const logService = createMockLogService();
		const configurationService = createMockConfigurationService();

		const result = buildConfigurationSchema(endpoint, logService, configurationService);
		const reasoningEffort = result.configurationSchema?.properties?.['reasoningEffort'];
		if (!reasoningEffort) {
			throw new Error('Expected reasoningEffort schema to be defined');
		}

		expect(reasoningEffort.enumItemLabels![0]).toBe('Low');
		expect(reasoningEffort.enumItemLabels![1]).toBe('Medium');
		expect(reasoningEffort.enumItemLabels![2]).toBe('High');
		expect(reasoningEffort.enumItemLabels![3]).toBe('Extra High');
	});

	it('returns empty schema when supportsReasoningEffort is empty', () => {
		const endpoint = createMockEndpoint('claude-sonnet-4', []);
		const logService = createMockLogService();
		const configurationService = createMockConfigurationService();

		const result = buildConfigurationSchema(endpoint, logService, configurationService);
		expect(result.configurationSchema).toBeUndefined();
	});
});

describe('resolveReasoningEffortDefault', () => {
	it('returns xhigh when setting is "xhigh" and model supports xhigh', () => {
		const result = resolveReasoningEffortDefault(
			'xhigh',
			'claude-sonnet-4',
			['low', 'medium', 'high', 'xhigh'],
			'high',
		);

		expect(result.effort).toBe('xhigh');
		expect(result.source).toBe('global-default');
	});

	it('returns xhigh from per-family key when configured', () => {
		const result = resolveReasoningEffortDefault(
			{ 'claude': 'xhigh', 'default': 'medium' },
			'claude-sonnet-4',
			['low', 'medium', 'high', 'xhigh'],
			'high',
		);

		expect(result.effort).toBe('xhigh');
		expect(result.source).toBe('per-family');
	});

	it('returns xhigh from global default key in object form', () => {
		const result = resolveReasoningEffortDefault(
			{ 'default': 'xhigh' },
			'claude-sonnet-4',
			['low', 'medium', 'high', 'xhigh'],
			'high',
		);

		expect(result.effort).toBe('xhigh');
		expect(result.source).toBe('global-default');
	});

	it('returns xhigh as hardcoded default when it is the hardcoded value and model supports it', () => {
		const result = resolveReasoningEffortDefault(
			undefined,
			'claude-sonnet-4',
			['low', 'medium', 'high', 'xhigh'],
			'xhigh',
		);

		expect(result.effort).toBe('xhigh');
		expect(result.source).toBe('hardcoded');
	});

	it('still applies xhigh even when not in model effort levels (warns but applies)', () => {
		const result = resolveReasoningEffortDefault(
			'xhigh',
			'claude-sonnet-4',
			['low', 'medium', 'high'],
			'high',
		);

		// The function still applies the value even when not in supported levels
		expect(result.effort).toBe('xhigh');
		expect(result.source).toBe('global-default');
	});
});
