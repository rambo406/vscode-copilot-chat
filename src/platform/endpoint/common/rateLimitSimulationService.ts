/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatFetchError, ChatFetchResponseType } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { generateUuid } from '../../../util/vs/base/common/uuid';

/**
 * Service that simulates rate-limit errors for debugging and testing purposes.
 * When armed, the next `consume()` call returns a synthetic `RateLimited` error
 * instead of letting the real network request proceed.
 */
export interface IRateLimitSimulationService {
	readonly _serviceBrand: undefined;

	/** Arm the simulation so that the next request(s) will receive a synthetic rate-limit error. */
	arm(options?: { code?: string; shots?: number }): void;

	/** Disarm the simulation — subsequent requests pass through normally. */
	disarm(): void;

	/** Whether the simulation is currently armed. */
	isArmed(): boolean;

	/**
	 * If the simulation is armed, returns a synthetic `RateLimited` {@link ChatFetchError}
	 * and decrements the remaining shot counter (auto-disarming when it reaches 0).
	 * Returns `undefined` when the simulation is not armed.
	 */
	consume(): ChatFetchError | undefined;

	/** Fires whenever the armed state changes. */
	readonly onDidChangeArmedState: Event<boolean>;
}

export const IRateLimitSimulationService = createServiceIdentifier<IRateLimitSimulationService>('IRateLimitSimulationService');

export class RateLimitSimulationService implements IRateLimitSimulationService {
	declare readonly _serviceBrand: undefined;

	private _armed = false;
	private _remainingShots = 0;
	private _capiErrorCode: string | undefined;

	private readonly _onDidChangeArmedState = new Emitter<boolean>();
	public readonly onDidChangeArmedState: Event<boolean> = this._onDidChangeArmedState.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) { }

	public arm(options?: { code?: string; shots?: number }): void {
		const shots = options?.shots ?? 1;
		this._armed = true;
		this._remainingShots = shots;
		this._capiErrorCode = options?.code;
		this._logService.info(`[RateLimitSimulation] Armed. shots=${shots}, capiError.code=${this._capiErrorCode ?? '(none)'}`);
		this._onDidChangeArmedState.fire(true);
	}

	public disarm(): void {
		this._armed = false;
		this._remainingShots = 0;
		this._logService.info('[RateLimitSimulation] Disarmed.');
		this._onDidChangeArmedState.fire(false);
	}

	public isArmed(): boolean {
		return this._armed;
	}

	public consume(): ChatFetchError | undefined {
		if (!this._armed) {
			return undefined;
		}

		this._remainingShots--;

		const error: ChatFetchError = {
			type: ChatFetchResponseType.RateLimited,
			reason: 'Simulated rate-limit error (debug)',
			requestId: generateUuid(),
			serverRequestId: undefined,
			retryAfter: 5,
			rateLimitKey: 'simulated-rate-limit',
			isAuto: false,
			capiError: this._capiErrorCode ? { code: this._capiErrorCode, message: `Simulated rate limit: ${this._capiErrorCode}` } : undefined,
		};

		this._logService.info(`[RateLimitSimulation] Consumed simulated rate-limit error. capiError.code=${this._capiErrorCode ?? '(none)'}, remaining shots=${this._remainingShots}`);

		if (this._remainingShots <= 0) {
			this._armed = false;
			this._logService.info('[RateLimitSimulation] Auto-disarmed (all shots consumed).');
			this._onDidChangeArmedState.fire(false);
		}

		return error;
	}
}
