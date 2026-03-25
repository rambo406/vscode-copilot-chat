/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { IChatMLFetcher } from '../../../../platform/chat/common/chatMLFetcher';
import { MockChatMLFetcher } from '../../../../platform/chat/test/common/mockChatMLFetcher';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionTestingServices } from '../../../test/vscode-node/services';
import { resolveReasoningEffortDefault } from '../../common/reasoningEffort';
import { CopilotLanguageModelWrapper } from '../languageModelAccess';


suite('CopilotLanguageModelWrapper', () => {
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;

	function createAccessor(vscodeExtensionContext?: IVSCodeExtensionContext) {
		const testingServiceCollection = createExtensionTestingServices();
		testingServiceCollection.define(IChatMLFetcher, new MockChatMLFetcher());

		accessor = testingServiceCollection.createTestingAccessor();
		instaService = accessor.get(IInstantiationService);
	}

	suite('validateRequest - invalid', async () => {
		let wrapper: CopilotLanguageModelWrapper;
		let endpoint: IChatEndpoint;
		setup(async () => {
			createAccessor();
			endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-base');
			wrapper = instaService.createInstance(CopilotLanguageModelWrapper);
		});

		const runTest = async (messages: vscode.LanguageModelChatMessage[], tools?: vscode.LanguageModelChatTool[], errMsg?: string) => {
			await assert.rejects(
				() => wrapper.provideLanguageModelResponse(endpoint, messages, { tools, requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto }, vscode.extensions.all[0].id, { report: () => { } }, CancellationToken.None),
				err => {
					errMsg ??= 'Invalid request';
					assert.ok(err instanceof Error, 'expected an Error');
					assert.ok(err.message.includes(errMsg), `expected error to include "${errMsg}", got ${err.message}`);
					return true;
				}
			);
		};

		test('empty', async () => {
			await runTest([]);
		});

		test('bad tool name', async () => {
			await runTest([vscode.LanguageModelChatMessage.User('hello')], [{ name: 'hello world', description: 'my tool' }], 'Invalid tool name');
		});
	});

	suite('validateRequest - valid', async () => {
		let wrapper: CopilotLanguageModelWrapper;
		let endpoint: IChatEndpoint;
		setup(async () => {
			createAccessor();
			endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-base');
			wrapper = instaService.createInstance(CopilotLanguageModelWrapper);
		});
		const runTest = async (messages: vscode.LanguageModelChatMessage[], tools?: vscode.LanguageModelChatTool[]) => {
			await wrapper.provideLanguageModelResponse(endpoint, messages, { tools, requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto }, vscode.extensions.all[0].id, { report: () => { } }, CancellationToken.None);
		};

		test('simple', async () => {
			await runTest([vscode.LanguageModelChatMessage.User('hello')]);
		});

		test('tool call and user message', async () => {
			const toolCall = vscode.LanguageModelChatMessage.Assistant('');
			toolCall.content = [new vscode.LanguageModelToolCallPart('id', 'func', { param: 123 })];
			const toolResult = vscode.LanguageModelChatMessage.User('');
			toolResult.content = [new vscode.LanguageModelToolResultPart('id', [new vscode.LanguageModelTextPart('result')])];
			await runTest([toolCall, toolResult, vscode.LanguageModelChatMessage.User('user message')]);
		});

		test('good tool name', async () => {
			await runTest([vscode.LanguageModelChatMessage.User('hello2')], [{ name: 'hello_world', description: 'my tool' }]);
		});
	});
});

suite('resolveReasoningEffortDefault', () => {
	const effortLevels = ['low', 'medium', 'high'];

	test('returns hardcoded default when setting is undefined', () => {
		assert.strictEqual(resolveReasoningEffortDefault(undefined, 'claude-3.5-sonnet', effortLevels, 'high').effort, 'high');
	});

	test('returns hardcoded default when setting is null-ish', () => {
		assert.strictEqual(resolveReasoningEffortDefault(undefined, 'gpt-4o', effortLevels, 'medium').effort, 'medium');
	});

	test('global string shorthand applied', () => {
		assert.strictEqual(resolveReasoningEffortDefault('low', 'claude-3.5-sonnet', effortLevels, 'high').effort, 'low');
	});

	test('global string shorthand applied to GPT', () => {
		assert.strictEqual(resolveReasoningEffortDefault('high', 'gpt-4o', effortLevels, 'medium').effort, 'high');
	});

	test('object with default key applied', () => {
		assert.strictEqual(resolveReasoningEffortDefault({ default: 'low' }, 'gpt-4o', effortLevels, 'medium').effort, 'low');
	});

	test('per-family key takes precedence over default', () => {
		assert.strictEqual(resolveReasoningEffortDefault({ default: 'low', claude: 'medium' }, 'claude-3.5-sonnet', effortLevels, 'high').effort, 'medium');
	});

	test('default key used when no family match', () => {
		assert.strictEqual(resolveReasoningEffortDefault({ default: 'low', claude: 'high' }, 'gpt-4o', effortLevels, 'medium').effort, 'low');
	});

	test('invalid effort is still applied', () => {
		assert.strictEqual(resolveReasoningEffortDefault('none', 'claude-3.5-sonnet', effortLevels, 'high').effort, 'none');
	});

	test('invalid per-family effort is still applied', () => {
		assert.strictEqual(resolveReasoningEffortDefault({ claude: 'none' }, 'claude-3.5-sonnet', effortLevels, 'high').effort, 'none');
	});

	test('family key matching is case-insensitive prefix', () => {
		assert.strictEqual(resolveReasoningEffortDefault({ Claude: 'low' }, 'claude-3.5-sonnet', effortLevels, 'high').effort, 'low');
	});

	test('family key matching works with gpt prefix', () => {
		assert.strictEqual(resolveReasoningEffortDefault({ 'gpt': 'high' }, 'gpt-4o', effortLevels, 'medium').effort, 'high');
	});

	test('returns undefined hardcoded default as-is when no setting', () => {
		assert.strictEqual(resolveReasoningEffortDefault(undefined, 'unknown-model', effortLevels, undefined).effort, undefined);
	});

	test('valid effort from setting overrides undefined hardcoded default', () => {
		assert.strictEqual(resolveReasoningEffortDefault('medium', 'unknown-model', effortLevels, undefined).effort, 'medium');
	});
});
