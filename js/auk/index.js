// SPDX-License-Identifier: GPL-3.0-or-later

import { setupSaveToAuk } from './save_to_auk.js';
import { setupTitleGenerator } from './title/plugin.js';

export const AUK_SOURCE_URL = 'https://github.com/ItzJustNett/auk-blockbench';

export function loadAukPlugins() {
	for (let [id, setup] of [['save_to_auk', setupSaveToAuk], ['auk_title', setupTitleGenerator]]) {
		try {
			setup();
		} catch (err) {
			console.error(`[auk] could not load ${id}`, err);
		}
	}
}
