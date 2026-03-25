/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';

export type ReasoningEffortSource = 'per-family' | 'global-default' | 'hardcoded';

export interface IResolvedReasoningEffortDefault {
	readonly effort: string | undefined;
	readonly source: ReasoningEffortSource;
}

/**
 * Resolves the default reasoning effort for a model based on user settings.
 * Normalizes a string setting to `{ default: value }`, looks up the family key,
 * then falls back to the `default` key, validates against the model's effort levels,
 * and returns the validated override or the hardcoded default.
 *
 * @returns An object with the resolved effort and whether it came from a per-family key, the global default, or the hardcoded default.
 */
export function resolveReasoningEffortDefault(
	settingValue: string | Record<string, string> | undefined,
	family: string,
	effortLevels: readonly string[],
	hardcodedDefault: string | undefined,
	logService?: ILogService,
): IResolvedReasoningEffortDefault {
	if (settingValue === undefined || settingValue === null) {
		logService?.debug(`[ReasoningEffort] No override configured for family '${family}', using hardcoded default '${hardcodedDefault}'`);
		return { effort: hardcodedDefault === undefined || effortLevels.includes(hardcodedDefault) ? hardcodedDefault : undefined, source: 'hardcoded' };
	}

	// Normalize string shorthand to object form
	const normalized: Record<string, string> = typeof settingValue === 'string'
		? { default: settingValue }
		: settingValue;

	const familyLower = family.toLowerCase();

	// Look up per-family key first (case-insensitive prefix match)
	let matchedKey: string | undefined;
	let candidate: string | undefined;
	for (const key of Object.keys(normalized)) {
		if (key === 'default') {
			continue;
		}
		if (familyLower.startsWith(key.toLowerCase())) {
			matchedKey = key;
			candidate = normalized[key];
			break;
		}
	}

	if (candidate !== undefined) {
		if (!effortLevels.includes(candidate)) {
			logService?.warn(`[ReasoningEffort] Configured effort '${candidate}' is not in model's supported levels (${effortLevels.join(', ')}) for family '${family}', but applying it anyway (source: per-family key '${matchedKey}')`);
		} else {
			logService?.info(`[ReasoningEffort] Override applied for family '${family}': effort='${candidate}' (source: per-family key '${matchedKey}')`);
		}
		return { effort: candidate, source: 'per-family' };
	}

	// Fall back to global default key
	const globalDefault = normalized['default'];
	if (globalDefault !== undefined) {
		if (!effortLevels.includes(globalDefault)) {
			logService?.warn(`[ReasoningEffort] Configured effort '${globalDefault}' is not in model's supported levels (${effortLevels.join(', ')}) for family '${family}', but applying it anyway (source: global default)`);
		} else {
			logService?.info(`[ReasoningEffort] Override applied for family '${family}': effort='${globalDefault}' (source: global default)`);
		}
		return { effort: globalDefault, source: 'global-default' };
	}

	logService?.debug(`[ReasoningEffort] No matching override for family '${family}', using hardcoded default '${hardcodedDefault}'`);

	return { effort: hardcodedDefault === undefined || effortLevels.includes(hardcodedDefault) ? hardcodedDefault : undefined, source: 'hardcoded' };
}