/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { toolCategories, ToolCategory, ToolName } from '../../common/toolNames';
import { ToolRegistry } from '../../common/toolsRegistry';
// Ensure side-effect registration + type import
import { type IExecutionSubagentParams } from '../executionSubagentTool';

suite('ExecutionSubagentTool', () => {
	test('is registered and categorized as Core', () => {
		const isRegistered = ToolRegistry.getTools().some(t => t.toolName === ToolName.ExecutionSubagent);
		expect(isRegistered).toBe(true);
		expect(toolCategories[ToolName.ExecutionSubagent]).toBe(ToolCategory.Core);
	});

	test('IExecutionSubagentParams accepts optional model field', () => {
		const params: IExecutionSubagentParams = {
			query: 'run npm test',
			description: 'Run tests',
			model: 'Claude Haiku 4.5 (copilot)',
		};
		expect(params.model).toBe('Claude Haiku 4.5 (copilot)');
	});

	test('IExecutionSubagentParams works without model field', () => {
		const params: IExecutionSubagentParams = {
			query: 'run npm test',
			description: 'Run tests',
		};
		expect(params.model).toBeUndefined();
	});
});
