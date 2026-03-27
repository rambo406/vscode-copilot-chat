/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { toolCategories, ToolCategory, ToolName } from '../../common/toolNames';
import { ToolRegistry } from '../../common/toolsRegistry';
// Ensure side-effect registration + type import
import { type ISearchSubagentParams } from '../searchSubagentTool';

suite('SearchSubagentTool', () => {
	test('is registered and categorized as Core', () => {
		const isRegistered = ToolRegistry.getTools().some(t => t.toolName === ToolName.SearchSubagent);
		expect(isRegistered).toBe(true);
		expect(toolCategories[ToolName.SearchSubagent]).toBe(ToolCategory.Core);
	});

	test('ISearchSubagentParams accepts optional model field', () => {
		const params: ISearchSubagentParams = {
			query: 'find auth code',
			description: 'Search for auth',
			details: 'Look for authentication code',
			model: 'GPT-4o (copilot)',
		};
		expect(params.model).toBe('GPT-4o (copilot)');
	});

	test('ISearchSubagentParams works without model field', () => {
		const params: ISearchSubagentParams = {
			query: 'find auth code',
			description: 'Search for auth',
			details: 'Look for authentication code',
		};
		expect(params.model).toBeUndefined();
	});
});
