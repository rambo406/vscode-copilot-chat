/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { ISearchSubagentToolCallingLoopOptions } from '../searchSubagentToolCallingLoop';

describe('SearchSubagentToolCallingLoop options', () => {
	it('accepts modelOverride as optional string', () => {
		const options: Partial<ISearchSubagentToolCallingLoopOptions> = {
			modelOverride: 'GPT-4o (copilot)',
		};
		expect(options.modelOverride).toBe('GPT-4o (copilot)');
	});

	it('defaults modelOverride to undefined when not provided', () => {
		const options: Partial<ISearchSubagentToolCallingLoopOptions> = {};
		expect(options.modelOverride).toBeUndefined();
	});
});
