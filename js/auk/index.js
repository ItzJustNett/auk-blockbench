// Auk's built-in plugins. They ship with the app and are loaded at startup (see AUK.md).
// SPDX-License-Identifier: GPL-3.0-or-later

import { setupSaveToAuk } from './save_to_auk.js';

export const AUK_SOURCE_URL = 'https://github.com/ItzJustNett/auk-blockbench';

export function loadAukPlugins() {
	for (let [id, setup] of [['save_to_auk', setupSaveToAuk]]) {
		try {
			setup();
		} catch (err) {
			console.error(`[auk] could not load ${id}`, err);
		}
	}
}
