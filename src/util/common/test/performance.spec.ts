/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatExtPerfMark, clearChatExtMarks, getChatExtMarks, markChatExt } from '../performance';

describe('performance', () => {

	const TEST_PREFIX = 'code/chat/ext/';
	let testCounter = 0;
	const createdSessionIds: string[] = [];

	afterEach(() => {
		for (const id of createdSessionIds) {
			clearChatExtMarks(id);
		}
		createdSessionIds.length = 0;
	});

	function uniqueSessionId(): string {
		const id = `test-session-${testCounter++}-${Date.now()}`;
		createdSessionIds.push(id);
		return id;
	}

	function getMarksForSession(sessionId: string) {
		return getChatExtMarks().filter(m => m.name.startsWith(`${TEST_PREFIX}${sessionId}/`));
	}

	describe('markChatExt', () => {
		it('emits a mark with the expected prefix', () => {
			const sessionId = uniqueSessionId();
			markChatExt(sessionId, ChatExtPerfMark.WillHandleParticipant);

			const marks = getMarksForSession(sessionId);
			expect(marks).toHaveLength(1);
			expect(marks[0].name).toBe(`${TEST_PREFIX}${sessionId}/${ChatExtPerfMark.WillHandleParticipant}`);
		});

		it('emits multiple marks for the same session', () => {
			const sessionId = uniqueSessionId();
			markChatExt(sessionId, ChatExtPerfMark.WillBuildPrompt);
			markChatExt(sessionId, ChatExtPerfMark.DidBuildPrompt);

			const marks = getMarksForSession(sessionId);
			expect(marks).toHaveLength(2);
		});

		it('no-ops when sessionId is undefined', () => {
			const before = getChatExtMarks().length;
			markChatExt(undefined, ChatExtPerfMark.WillFetch);
			expect(getChatExtMarks().length).toBe(before);
		});
	});

	describe('ChatExtPerfMark', () => {
		it('contains all expected mark names', () => {
			expect(ChatExtPerfMark.WillHandleParticipant).toBe('willHandleParticipant');
			expect(ChatExtPerfMark.DidHandleParticipant).toBe('didHandleParticipant');
			expect(ChatExtPerfMark.WillBuildPrompt).toBe('willBuildPrompt');
			expect(ChatExtPerfMark.DidBuildPrompt).toBe('didBuildPrompt');
			expect(ChatExtPerfMark.WillFetch).toBe('willFetch');
			expect(ChatExtPerfMark.DidFetch).toBe('didFetch');
		});
	});

	describe('clearChatExtMarks', () => {
		it('removes marks for the given session', () => {
			const sessionId1 = uniqueSessionId();
			const sessionId2 = uniqueSessionId();
			markChatExt(sessionId1, ChatExtPerfMark.WillFetch);
			markChatExt(sessionId2, ChatExtPerfMark.DidFetch);

			clearChatExtMarks(sessionId1);

			const marks = getChatExtMarks().filter(m => m.name.startsWith(`${TEST_PREFIX}${sessionId1}/`));
			expect(marks).toHaveLength(0);
			const remaining = getChatExtMarks().filter(m => m.name.startsWith(`${TEST_PREFIX}${sessionId2}/`));
			expect(remaining).toHaveLength(1);
		});
	});

	describe('MonacoPerformanceMarks compatibility', () => {
		it('falls back when the host does not implement clearMarks', async () => {
			const globalWithMonacoMarks = globalThis as typeof globalThis & { MonacoPerformanceMarks?: { mark(name: string, markOptions?: { startTime?: number }): void; getMarks(): { name: string; startTime: number }[] } };
			const originalMonacoPerformanceMarks = globalWithMonacoMarks.MonacoPerformanceMarks;
			const sessionId = `partial-host-${testCounter++}-${Date.now()}`;
			const markName = `${TEST_PREFIX}${sessionId}/${ChatExtPerfMark.WillHandleParticipant}`;

			try {
				vi.resetModules();
				globalWithMonacoMarks.MonacoPerformanceMarks = {
					mark: (name, markOptions) => performance.mark(name, markOptions),
					getMarks: () => performance.getEntries().filter(e => e.entryType === 'mark').map(e => ({ name: e.name, startTime: e.startTime })),
				};

				const performanceModule = await import('../performance');
				performanceModule.markChatExt(sessionId, performanceModule.ChatExtPerfMark.WillHandleParticipant);

				expect(performanceModule.getChatExtMarks().filter(m => m.name.startsWith(`${TEST_PREFIX}${sessionId}/`))).toHaveLength(1);
				expect(() => performanceModule.clearChatExtMarks(sessionId)).not.toThrow();
				expect(performanceModule.getChatExtMarks().filter(m => m.name.startsWith(`${TEST_PREFIX}${sessionId}/`))).toHaveLength(0);
			} finally {
				performance.clearMarks(markName);
				if (originalMonacoPerformanceMarks) {
					globalWithMonacoMarks.MonacoPerformanceMarks = originalMonacoPerformanceMarks;
				} else {
					delete globalWithMonacoMarks.MonacoPerformanceMarks;
				}
				vi.resetModules();
			}
		});
	});
});
