// Save to Auk: when this app runs inside an Auk page (an iframe opened with ?auk_origin=...),
// render a PNG and hand it to the parent page with postMessage. Never posts to "*".
// SPDX-License-Identifier: GPL-3.0-or-later

// Origins of Auk pages that may embed the editor.
const ALLOWED_ORIGINS = [
	'https://auk-hosting.com',
	'http://localhost:5173',
];
const ICON_SIZE = 64; // Minecraft's server-icon.png

function isLocalHost(hostname) {
	return hostname == 'localhost' || hostname == '127.0.0.1' || hostname == '[::1]';
}

/** The parent's origin if it is allowed, else null. */
export function resolveAukOrigin(search = location.search, own = location) {
	let raw;
	try {
		raw = new URLSearchParams(search).get('auk_origin');
	} catch (err) {
		return null;
	}
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw);
	} catch (err) {
		return null;
	}
	// an origin only: no path, query, credentials or fragment
	if (url.origin == 'null' || raw.replace(/\/$/, '') != url.origin) return null;
	if (ALLOWED_ORIGINS.includes(url.origin)) return url.origin;
	// development: an app served from localhost may talk to any local http page
	if (isLocalHost(own.hostname) && url.protocol == 'http:' && isLocalHost(url.hostname)) return url.origin;
	return null;
}

export const AukLink = {
	origin: null,
	embedded: false,
	get available() {
		return !!(this.embedded && this.origin);
	},
	/** Send a PNG (data URL) to the Auk page. */
	sendImage(kind, data_url, width, height) {
		if (!this.available) throw new Error('Not running inside an Auk page');
		if (kind != 'title' && kind != 'icon') throw new Error('Unknown image kind: ' + kind);
		let prefix = 'data:image/png;base64,';
		if (typeof data_url != 'string' || !data_url.startsWith(prefix)) throw new Error('Expected a PNG data URL');
		window.parent.postMessage({
			type: 'auk:image',
			kind,
			png: data_url.substring(prefix.length),
			width,
			height,
		}, this.origin);
	},
};

/** Render the current view of a non-title project to a PNG data URL. */
function renderView(width, height) {
	return new Promise(resolve => {
		Screencam.advancedScreenshot(Preview.selected, {
			angle_preset: 'view',
			resolution: [width, height],
			anti_aliasing: 'ssaa',
			show_errors: false,
		}, resolve);
	});
}
/** Scale an image into a square canvas (keeping its aspect ratio, centred). */
export async function toSquarePNG(data_url, size) {
	let img = new Image();
	img.src = data_url;
	await img.decode();
	let canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	let ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	let scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
	let w = img.naturalWidth * scale, h = img.naturalHeight * scale;
	ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
	return canvas.toDataURL('image/png');
}

// The title generator registers itself here so "Save to Auk" uses its renderer for titles.
export const AukRenderers = {
	title: null, // async ({kind, width, height}) => data URL, or null when it does not apply
};

async function renderFor(kind, width, height) {
	if (AukRenderers.title) {
		let result = await AukRenderers.title({kind, width, height});
		if (result) return result;
	}
	if (kind == 'icon') {
		let big = await renderView(512, 512);
		return toSquarePNG(big, ICON_SIZE);
	}
	return renderView(width, height);
}

export async function saveToAuk(kind, width, height) {
	if (kind == 'icon') width = height = ICON_SIZE;
	let data_url = await renderFor(kind, width, height);
	AukLink.sendImage(kind, data_url, width, height);
	Blockbench.showQuickMessage(kind == 'icon' ? 'Server icon sent to Auk' : 'Title sent to Auk', 2000);
}

function openSaveDialog() {
	new Dialog({
		id: 'save_to_auk',
		title: 'Save to Auk',
		width: 420,
		form: {
			kind: {label: 'Save as', type: 'select', value: 'title', options: {
				title: 'Title / logo image',
				icon: 'Server icon (64×64)',
			}},
			size: {label: 'Size', type: 'vector', dimensions: 2, linked_ratio: false, value: [1600, 600], min: 16, max: 4096,
				condition: form => form.kind == 'title'},
		},
		onConfirm(form) {
			let [w, h] = (form.size || [ICON_SIZE, ICON_SIZE]).map(n => Math.round(Math.min(4096, Math.max(16, n))));
			saveToAuk(form.kind, w, h).catch(err => {
				console.error(err);
				Blockbench.showMessageBox({title: 'Save to Auk', message: 'Could not send the image: ' + err.message});
			});
		}
	}).show();
}

export function setupSaveToAuk() {
	AukLink.embedded = window.parent && window.parent !== window;
	AukLink.origin = resolveAukOrigin();

	let action = new Action('save_to_auk', {
		name: 'Save to Auk',
		description: 'Send a PNG of this model to your Auk server (title image or server icon)',
		icon: 'cloud_upload',
		category: 'file',
		condition: () => AukLink.available && !!Project,
		click: openSaveDialog,
	});
	MenuBar.addAction(action, 'file.0');

	if (AukLink.available) {
		window.parent.postMessage({type: 'auk:ready'}, AukLink.origin);
	} else if (AukLink.embedded && new URLSearchParams(location.search).has('auk_origin')) {
		console.warn('[auk] auk_origin is not an allowed Auk origin; Save to Auk is off');
	}
}
