/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const ESLint = require('eslint').ESLint;

const removeIgnoredFiles = async (files) => {
	try {
		const eslint = new ESLint();
		const isIgnored = await Promise.all(
			files.map((file) => {
				return eslint.isPathIgnored(file);
			})
		);
		const filteredFiles = files.filter((_, i) => !isIgnored[i]);
		return filteredFiles.join(' ');
	} catch (error) {
		if (error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
			return files.join(' ');
		}

		throw error;
	}
};

module.exports = {
	'!({.esbuild.ts,test/simulation/fixtures/**,test/scenarios/**,.vscode/extensions/**,**/vscode.proposed.*})*{.ts,.js,.tsx}': async (files) => {
		const filesToLint = await removeIgnoredFiles(files);
		if (!filesToLint) {
			return [];
		}
		return [
			`npm run tsfmt -- ${filesToLint}`,
			`node --experimental-strip-types ./node_modules/eslint/bin/eslint.js --no-warn-ignored --max-warnings=0 ${filesToLint}`
		];
	},
};
