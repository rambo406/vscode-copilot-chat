/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { IExecutionSubagentToolCallingLoopOptions } from '../executionSubagentToolCallingLoop';

describe('ExecutionSubagentToolCallingLoop options', () => {
	it('accepts modelOverride as optional string', () => {
		const options: Partial<IExecutionSubagentToolCallingLoopOptions> = {
			modelOverride: 'Claude Haiku 4.5 (copilot)',
		};
		expect(options.modelOverride).toBe('Claude Haiku 4.5 (copilot)');
	});

	it('defaults modelOverride to undefined when not provided', () => {
		const options: Partial<IExecutionSubagentToolCallingLoopOptions> = {};
		expect(options.modelOverride).toBeUndefined();
	});
});
