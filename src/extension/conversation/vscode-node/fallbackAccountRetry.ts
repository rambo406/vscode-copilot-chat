/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatRequest } from 'vscode';
import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IChatFallbackAccountResolverService } from '../../../platform/authentication/common/chatFallbackAccountResolver';
import { ILogService } from '../../../platform/log/common/logService';
import { ICopilotChatResultIn } from '../../prompt/common/conversation';
import { IFallbackAccountRetryContext, getFallbackAccountRetryContext } from '../../prompt/common/specialRequestTypes';

export interface IFallbackAccountRetryOptions {
	readonly authenticationService: IAuthenticationService;
	readonly resolverService: IChatFallbackAccountResolverService;
	readonly logService?: ILogService;
	readonly request: ChatRequest;
	readonly result: vscode.ChatResult;
	readonly stream: vscode.ChatResponseStream;
	readonly token: vscode.CancellationToken;
	retryAsContinuation(retryRequest: ChatRequest): Promise<{ request: ChatRequest; result: vscode.ChatResult }>;
}

export async function retryWithFallbackAccount(options: IFallbackAccountRetryOptions): Promise<{ request: ChatRequest; result: vscode.ChatResult }> {
	const log = options.logService;
	log?.info('[FallbackAccountRetry] retryWithFallbackAccount called');

	let request = options.request;
	let result = options.result;
	const metadata = (result as ICopilotChatResultIn).metadata;
	if (!metadata?.shouldAutoRetryWithFallbackAccount || !result.errorDetails || result.errorDetails.responseIsFiltered) {
		log?.info(
			'[FallbackAccountRetry] Guard check failed \u2014 not retrying.'
			+ ` shouldAutoRetryWithFallbackAccount=${!!metadata?.shouldAutoRetryWithFallbackAccount}`
			+ ` hasErrorDetails=${!!result.errorDetails}`
			+ ` responseIsFiltered=${!!result.errorDetails?.responseIsFiltered}`,
		);
		return { request, result };
	}

	const originalActiveChatAccount = options.resolverService.getActiveChatAccount() ?? await options.resolverService.getCurrentChatAccount();
	const retryContext = getFallbackAccountRetryContext(request);
	let attemptedAccountIds = [...(retryContext?.attemptedAccountIds ?? [])];
	let didSucceedWithFallbackAccount = false;

	const restoreActiveChatAccount = async () => {
		await options.resolverService.setActiveChatAccount(originalActiveChatAccount);
		options.authenticationService.resetCopilotToken();
		try {
			await options.authenticationService.getCopilotToken(true);
		} catch {
			// Ignore restoration failures and preserve the final chat error.
		}
	};

	let iteration = 0;
	while ((result as ICopilotChatResultIn).metadata?.shouldAutoRetryWithFallbackAccount
		&& result.errorDetails
		&& !result.errorDetails.responseIsFiltered) {
		iteration++;
		log?.info(`[FallbackAccountRetry] Retry loop iteration ${iteration}, attemptedAccountIds=[${attemptedAccountIds.join(', ')}]`);

		const resolvedSession = await options.resolverService.resolveNextEligibleFallbackSession(attemptedAccountIds);
		if (!resolvedSession) {
			log?.info('[FallbackAccountRetry] No eligible fallback session found — exiting retry loop');
			break;
		}

		attemptedAccountIds = [...attemptedAccountIds, resolvedSession.account.id];
		request = withFallbackAccountRetryContext(request, attemptedAccountIds, retryContext?.originalActiveAccount ?? originalActiveChatAccount);
		await options.resolverService.setActiveChatAccount(resolvedSession.account);
		options.authenticationService.resetCopilotToken();

		try {
			await options.authenticationService.getCopilotToken(true);
		} catch {
			options.stream.warning(new vscode.MarkdownString(vscode.l10n.t('Configured fallback GitHub account {0} could not be used for Copilot Chat. Trying the next configured fallback account.', resolvedSession.registryEntry.label)));
			continue;
		}

		options.stream.warning(new vscode.MarkdownString(vscode.l10n.t('Your current Copilot Chat account was rate-limited. Retrying with fallback GitHub account {0}.', resolvedSession.registryEntry.label)));
		({ request, result } = await options.retryAsContinuation(request));
		(result as ICopilotChatResultIn).metadata ??= {};
		(result as ICopilotChatResultIn).metadata!.attemptedFallbackAccountIds = attemptedAccountIds;

		if (!result.errorDetails) {
			didSucceedWithFallbackAccount = true;
			break;
		}
	}

	if (!didSucceedWithFallbackAccount) {
		log?.info(`[FallbackAccountRetry] No fallback account succeeded after ${iteration} iteration(s) — restoring original account`);
		await restoreActiveChatAccount();

		const retryAfterSeconds = (result as ICopilotChatResultIn).metadata?.retryAfterSeconds;
		const waitMs = ((typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) ? retryAfterSeconds : 1800) * 1000;
		const waitMinutes = Math.ceil(waitMs / 60_000);

		log?.info(`[FallbackAccountRetry] Starting countdown auto-retry — waiting ${waitMs}ms (~${waitMinutes} min)`);

		await new Promise<void>(resolve => {
			options.stream.progress(
				vscode.l10n.t('All fallback accounts were rate-limited. Auto-retrying in ~{0} minutes...', String(waitMinutes)),
				async () => {
					try {
						await new Promise<void>((resolveTimer, rejectTimer) => {
							const timer = setTimeout(resolveTimer, waitMs);
							options.token.onCancellationRequested(() => {
								clearTimeout(timer);
								rejectTimer(new Error('cancelled'));
							});
							if (options.token.isCancellationRequested) {
								clearTimeout(timer);
								rejectTimer(new Error('cancelled'));
							}
						});

						log?.info('[FallbackAccountRetry] Countdown expired — auto-retrying');
						({ request, result } = await options.retryAsContinuation(request));
						return vscode.l10n.t('Rate limit expired — retried automatically.');
					} catch {
						log?.info('[FallbackAccountRetry] Countdown aborted (cancelled or error)');
						return undefined;
					} finally {
						resolve();
					}
				},
			);
		});
	} else {
		log?.info('[FallbackAccountRetry] Successfully retried with a fallback account');
	}

	return { request, result };
}

function withFallbackAccountRetryContext(request: ChatRequest, attemptedAccountIds: readonly string[], originalActiveAccount: vscode.AuthenticationSessionAccountInformation | undefined): ChatRequest {
	const retryContext: IFallbackAccountRetryContext = {
		copilotFallbackAccountRetry: true,
		attemptedAccountIds,
		originalActiveAccount,
	};

	return {
		...request,
		acceptedConfirmationData: [
			...(request.acceptedConfirmationData ?? []).filter(data => !(data && (data as IFallbackAccountRetryContext).copilotFallbackAccountRetry === true)),
			retryContext,
		],
	};
}
