/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert, describe, expect, test } from 'vitest';
import { CHAT_MODEL } from '../../../../platform/configuration/common/configurationService';
import { JsonSchema } from '../../../../platform/configuration/common/jsonSchema';
import { OpenAiFunctionTool } from '../../../../platform/networking/common/fetch';
import { normalizeToolSchema } from '../../common/toolSchemaNormalizer';

describe('ToolSchemaNormalizer', () => {
	const makeTool = (properties: Record<string, JsonSchema>): OpenAiFunctionTool[] => [{
		type: 'function',
		function: {
			name: 'test',
			description: 'test',
			parameters: {
				type: 'object',
				properties,
			}
		}
	}];

	test('throws an invalid primitive types', () => {
		assert.throws(() => normalizeToolSchema(CHAT_MODEL.GPT41, makeTool({
			foo: {
				type: 'text',
				description: 'foo',
			}
		})), Error, /do not match JSON schema/);
	});

	test('fails on array without item specs', () => {
		assert.throws(() => normalizeToolSchema(CHAT_MODEL.GPT41, makeTool({
			foo: {
				type: 'array',
			}
		})), Error, /array type must have items/);
	});

	test('trims extra properties', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, makeTool({
			foo: {
				type: 'array',
				items: { type: 'string' },
				minItems: 2,
				maxItems: 2,
			}
		}));

		expect(schema![0].function.parameters).toMatchInlineSnapshot(`
			{
			  "properties": {
			    "foo": {
			      "items": {
			        "type": "string",
			      },
			      "type": "array",
			    },
			  },
			  "type": "object",
			}
		`);
	});

	test('does not fail on "in true""', () => {
		normalizeToolSchema(CHAT_MODEL.GPT41, makeTool({
			foo: {
				type: 'array',
				items: true
			}
		}));
	});

	test('removes undefined required properties', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, makeTool({
			foo1: {
				type: 'object',
			},
			foo2: {
				type: 'object',
				properties: { a: { type: 'string' } },
			},
			foo3: {
				type: 'object',
				properties: { a: { type: 'string' }, b: { type: 'string' } },
				required: ['a', 'b', 'c'],
			}
		}));


		expect(schema![0].function.parameters).toMatchInlineSnapshot(`
			{
			  "properties": {
			    "foo1": {
			      "type": "object",
			    },
			    "foo2": {
			      "properties": {
			        "a": {
			          "type": "string",
			        },
			      },
			      "type": "object",
			    },
			    "foo3": {
			      "properties": {
			        "a": {
			          "type": "string",
			        },
			        "b": {
			          "type": "string",
			        },
			      },
			      "required": [
			        "a",
			        "b",
			      ],
			      "type": "object",
			    },
			  },
			  "type": "object",
			}
		`);
	});


	test('ensures object parameters', () => {
		const n1: any = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'noParams',
				description: 'test',
			}
		}, {
			type: 'function',
			function: {
				name: 'wrongType',
				description: 'test',
				parameters: { type: 'string' },
			}
		}, {
			type: 'function',
			function: {
				name: 'missingProps',
				description: 'test',
				parameters: { type: 'object' },
			}
		}]);

		expect(n1).toMatchInlineSnapshot(`
			[
			  {
			    "function": {
			      "description": "test",
			      "name": "noParams",
			    },
			    "type": "function",
			  },
			  {
			    "function": {
			      "description": "test",
			      "name": "wrongType",
			      "parameters": {
			        "properties": {},
			        "type": "object",
			      },
			    },
			    "type": "function",
			  },
			  {
			    "function": {
			      "description": "test",
			      "name": "missingProps",
			      "parameters": {
			        "properties": {},
			        "type": "object",
			      },
			    },
			    "type": "function",
			  },
			]
		`);
	});

	test('normalizes arrays for draft 2020-12', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.CLAUDE_37_SONNET, makeTool({
			foo: {
				type: 'array',
				items: [{ type: 'string' }, { type: 'number' }],
				minItems: 2,
				maxItems: 2,
			},
			bar: {
				type: 'array',
				items: { type: 'string' },
				minItems: 2,
				maxItems: 2,
			}
		}));

		expect(schema![0]).toMatchInlineSnapshot(`
			{
			  "function": {
			    "description": "test",
			    "name": "test",
			    "parameters": {
			      "properties": {
			        "bar": {
			          "items": {
			            "type": "string",
			          },
			          "maxItems": 2,
			          "minItems": 2,
			          "type": "array",
			        },
			        "foo": {
			          "items": {
			            "anyOf": [
			              {
			                "type": "string",
			              },
			              {
			                "type": "number",
			              },
			            ],
			          },
			          "maxItems": 2,
			          "minItems": 2,
			          "type": "array",
			        },
			      },
			      "type": "object",
			    },
			  },
			  "type": "function",
			}
		`);
	});

	test('converts nullable types to OpenAPI format for Gemini models', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GEMINI_FLASH, makeTool({
			nullableString: {
				type: ['string', 'null'] as any,
				description: 'A nullable string',
			},
			nullableNumber: {
				type: ['number', 'null'] as any,
				description: 'A nullable number',
			},
			regularString: {
				type: 'string',
				description: 'A regular string',
			}
		}));

		expect(schema![0].function.parameters).toMatchInlineSnapshot(`
			{
			  "properties": {
			    "nullableNumber": {
			      "description": "A nullable number",
			      "nullable": true,
			      "type": "number",
			    },
			    "nullableString": {
			      "description": "A nullable string",
			      "nullable": true,
			      "type": "string",
			    },
			    "regularString": {
			      "description": "A regular string",
			      "type": "string",
			    },
			  },
			  "type": "object",
			}
		`);
	});

	test('converts nullable types in nested objects for Gemini models', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GEMINI_25_PRO, makeTool({
			person: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
					},
					email: {
						type: ['string', 'null'] as any,
						description: 'Optional email',
					},
					age: {
						type: ['integer', 'null'] as any,
					}
				}
			}
		}));

		const personProp = (schema![0].function.parameters as any).properties.person;
		expect(personProp.properties.email).toEqual({
			type: 'string',
			nullable: true,
			description: 'Optional email',
		});
		expect(personProp.properties.age).toEqual({
			type: 'integer',
			nullable: true,
		});
		expect(personProp.properties.name).toEqual({
			type: 'string',
		});
	});

	test('converts nullable types in array items for Gemini models', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GEMINI_20_PRO, makeTool({
			items: {
				type: 'array',
				items: {
					type: ['string', 'null'] as any,
					description: 'Nullable array items',
				}
			}
		}));

		const itemsProp = (schema![0].function.parameters as any).properties.items;
		expect(itemsProp.items).toEqual({
			type: 'string',
			nullable: true,
			description: 'Nullable array items',
		});
	});

	test('does not convert nullable types for non-Gemini models', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, makeTool({
			nullableString: {
				type: ['string', 'null'] as any,
				description: 'A nullable string',
			}
		}));

		// For non-Gemini models, the type array should remain unchanged
		expect((schema![0].function.parameters as any).properties.nullableString.type).toEqual(['string', 'null']);
		expect((schema![0].function.parameters as any).properties.nullableString.nullable).toBeUndefined();
	});

	test('handles multi-type union with null for Gemini models', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GEMINI_FLASH, makeTool({
			multiType: {
				type: ['string', 'number', 'null'] as any,
				description: 'Multi-type with null',
			}
		}));

		// When there are multiple non-null types, we can't use nullable keyword
		// so we just remove null from the union
		expect((schema![0].function.parameters as any).properties.multiType.type).toEqual(['string', 'number']);
		expect((schema![0].function.parameters as any).properties.multiType.nullable).toBeUndefined();
	});

	test('merges anyOf properties into top-level schema', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'test',
				description: 'test',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string', description: 'The command' },
					},
					required: ['command'],
					anyOf: [
						{
							properties: {
								mode: { type: 'string', enum: ['sync'], description: 'Sync mode' },
								timeout: { type: 'number', description: 'Timeout in ms' },
							},
						},
						{
							properties: {
								mode: { type: 'string', enum: ['async'], description: 'Async mode' },
							},
						},
					],
				} as any,
			},
		}]);

		const params = schema![0].function.parameters as any;
		expect(params.anyOf).toBeUndefined();
		expect(params.properties.command).toEqual({ type: 'string', description: 'The command' });
		expect(params.properties.mode).toEqual({ type: 'string', enum: ['sync'], description: 'Sync mode' });
		expect(params.properties.timeout).toEqual({ type: 'number', description: 'Timeout in ms' });
	});

	test('merges allOf properties into top-level schema', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'test',
				description: 'test',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string' },
					},
					allOf: [
						{
							properties: {
								extra: { type: 'string' },
							},
						},
					],
				} as any,
			},
		}]);

		const params = schema![0].function.parameters as any;
		expect(params.allOf).toBeUndefined();
		expect(params.properties.command).toEqual({ type: 'string' });
		expect(params.properties.extra).toEqual({ type: 'string' });
	});

	test('does not overwrite existing parent properties when merging anyOf', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'test',
				description: 'test',
				parameters: {
					type: 'object',
					properties: {
						shared: { type: 'string', description: 'parent version' },
					},
					anyOf: [
						{
							properties: {
								shared: { type: 'number', description: 'branch version' },
								extra: { type: 'boolean' },
							},
						},
					],
				} as any,
			},
		}]);

		const params = schema![0].function.parameters as any;
		expect(params.properties.shared).toEqual({ type: 'string', description: 'parent version' });
		expect(params.properties.extra).toEqual({ type: 'boolean' });
	});

	test('merges oneOf inside a nested property schema', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'click_element',
				description: 'click an element',
				parameters: {
					type: 'object',
					properties: {
						selector: {
							oneOf: [
								{ type: 'string', description: 'CSS selector' },
								{ type: 'object', properties: { xpath: { type: 'string' } } },
							],
						},
					},
				} as any,
			},
		}]);

		const params = schema![0].function.parameters as any;
		expect(params.properties.selector.oneOf).toBeUndefined();
	});

	test('merges allOf inside a nested property schema', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'drag_element',
				description: 'drag an element',
				parameters: {
					type: 'object',
					properties: {
						target: {
							allOf: [
								{ type: 'object', properties: { x: { type: 'number' } } },
								{ type: 'object', properties: { y: { type: 'number' } } },
							],
						},
					},
				} as any,
			},
		}]);

		const params = schema![0].function.parameters as any;
		expect(params.properties.target.allOf).toBeUndefined();
		expect(params.properties.target.properties.x).toEqual({ type: 'number' });
		expect(params.properties.target.properties.y).toEqual({ type: 'number' });
	});

	test('merges anyOf inside a nested property schema', () => {
		const schema = normalizeToolSchema(CHAT_MODEL.GPT41, [{
			type: 'function',
			function: {
				name: 'run_in_terminal',
				description: 'run a command',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string' },
						mode: {
							anyOf: [
								{ type: 'string', enum: ['sync'] },
								{ type: 'string', enum: ['async'] },
							],
						},
					},
				} as any,
			},
		}]);

		const params = schema![0].function.parameters as any;
		expect(params.properties.mode.anyOf).toBeUndefined();
	});
});
