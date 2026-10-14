// Auk Title materials: every texture is generated here from code (noise, cells, stripes),
// no image assets. Colours are [r, g, b] arrays in 0-255.
// SPDX-License-Identifier: GPL-3.0-or-later

export function hash(x, y, seed = 0) {
	let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t) {
	return t * t * (3 - 2 * t);
}
/** Value noise in 0-1, continuous over x and y. */
export function valueNoise(x, y, seed = 0) {
	let x0 = Math.floor(x), y0 = Math.floor(y);
	let fx = smooth(x - x0), fy = smooth(y - y0);
	let a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed);
	let c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
	return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
export function mix(a, b, t) {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function shade(c, f) {
	return [c[0] * f, c[1] * f, c[2] * f];
}
export function lighten(c, t) {
	return mix(c, [255, 255, 255], t);
}
export function hexToRgb(hex) {
	let m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
	if (!m) return [255, 255, 255];
	let n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function vary(c, amount) {
	return [c[0] + amount, c[1] + amount, c[2] + amount];
}
function gradient(stops, t) {
	t = Math.min(1, Math.max(0, t));
	if (stops.length == 1) return stops[0];
	let scaled = t * (stops.length - 1);
	let i = Math.min(stops.length - 2, Math.floor(scaled));
	return mix(stops[i], stops[i + 1], scaled - i);
}

// Every material is sampled in "material pixels" (mx, my: 8 per block of a glyph, independent of
// the texture resolution) and gets v: 0 at the top of the text row, 1 at its bottom.
export const AukMaterials = {
	stone: {
		name: 'Stone',
		sample(mx, my) {
			let n = hash(mx >> 1, my >> 1, 11);
			let patch = valueNoise(mx / 7, my / 5, 12);
			let g = 118 + n * 34 - (patch > 0.68 ? 22 : 0) + (patch < 0.18 ? 12 : 0);
			return [g, g, g + 3];
		}
	},
	cobble: {
		name: 'Cobble',
		sample(mx, my) {
			// jittered cells with dark mortar between them
			let size = 7;
			let cx = Math.floor(mx / size), cy = Math.floor(my / size);
			let d1 = 1e9, d2 = 1e9, best = 0;
			for (let oy = -1; oy <= 1; oy++) {
				for (let ox = -1; ox <= 1; ox++) {
					let px = (cx + ox + 0.15 + hash(cx + ox, cy + oy, 21) * 0.7) * size;
					let py = (cy + oy + 0.15 + hash(cx + ox, cy + oy, 22) * 0.7) * size;
					let d = Math.hypot(mx + 0.5 - px, my + 0.5 - py);
					if (d < d1) { d2 = d1; d1 = d; best = hash(cx + ox, cy + oy, 23); }
					else if (d < d2) { d2 = d; }
				}
			}
			if (d2 - d1 < 1.3) return [58, 58, 62];
			let g = 105 + best * 55 + (hash(mx, my, 24) - 0.5) * 18 - Math.min(d1, 4) * 3;
			return [g, g, g + 2];
		}
	},
	gold: {
		name: 'Gold',
		sample(mx, my, v) {
			let c = gradient([[255, 240, 140], [250, 200, 60], [200, 128, 24]], v);
			if (((mx + my) % 22 + 22) % 22 < 3) c = lighten(c, 0.35);
			c = vary(c, (hash(mx >> 1, my >> 1, 31) - 0.5) * 16);
			if (hash(mx, my, 32) > 0.992) c = [255, 255, 230];
			return c;
		}
	},
	wood: {
		name: 'Wood planks',
		sample(mx, my) {
			let plank_h = 6;
			let row = Math.floor(my / plank_h);
			let in_row = my - row * plank_h;
			let shift = Math.floor(hash(row, 0, 41) * 16);
			let col = Math.floor((mx + shift) / 18);
			if (in_row == plank_h - 1) return [92, 62, 34];
			if ((mx + shift) % 18 == 0) return [104, 72, 40];
			let tone = hash(row, col, 42) * 20;
			let grain = Math.sin((mx + shift) * 0.9 + valueNoise(mx / 6, my / 2, 43) * 6) * 9;
			return [158 + tone + grain, 112 + tone * 0.7 + grain * 0.8, 62 + tone * 0.4 + grain * 0.5];
		}
	},
	grass: {
		name: 'Grass and dirt',
		sample(mx, my, v, row_px) {
			// green on top (about a block and a bit), dirt below, a ragged edge between
			let edge = 10 + Math.floor(hash(mx >> 1, 0, 51) * 4);
			let ty = v * row_px * 8;
			if (ty < edge) {
				let n = hash(mx, my, 52);
				return [78 + n * 34, 150 + n * 40, 52 + n * 22];
			}
			let n = hash(mx >> 1, my >> 1, 53);
			let c = [132 + n * 26, 92 + n * 18, 60 + n * 14];
			if (hash(mx, my, 54) > 0.93) c = [96, 66, 44];
			if (hash(mx, my, 55) > 0.985) c = [160, 160, 160];
			return c;
		}
	},
	ice: {
		name: 'Ice',
		sample(mx, my, v) {
			let c = gradient([[214, 238, 255], [150, 196, 250]], v);
			let n = valueNoise(mx / 5, my / 5, 61);
			c = vary(c, (n - 0.5) * 30);
			if (((mx - my * 2) % 26 + 26) % 26 < 2) c = lighten(c, 0.55);
			return c;
		}
	},
	obsidian: {
		name: 'Obsidian',
		sample(mx, my) {
			let n = hash(mx >> 1, my >> 1, 71);
			let c = [22 + n * 14, 14 + n * 8, 36 + n * 22];
			if (valueNoise(mx / 4, my / 4, 72) > 0.74) c = [74, 46, 112];
			if (hash(mx, my, 73) > 0.985) c = [150, 110, 200];
			return c;
		}
	},
	lava: {
		name: 'Lava',
		sample(mx, my) {
			let n = valueNoise(mx / 6, my / 6, 81) * 0.7 + valueNoise(mx / 2.5, my / 2.5, 82) * 0.3;
			return gradient([[150, 24, 8], [232, 84, 16], [255, 170, 30], [255, 236, 120]], n);
		}
	},
	bricks: {
		name: 'Bricks',
		sample(mx, my) {
			let h = 5, w = 10;
			let row = Math.floor(my / h);
			let ox = row % 2 ? w / 2 : 0;
			if (my % h == h - 1 || (mx + ox) % w == 0) return [176, 168, 160];
			let col = Math.floor((mx + ox) / w);
			let tone = hash(col, row, 91) * 30;
			let n = (hash(mx, my, 92) - 0.5) * 16;
			return [150 + tone + n, 64 + tone * 0.4 + n, 52 + tone * 0.3 + n];
		}
	},
	emerald: {
		name: 'Emerald',
		sample(mx, my, v) {
			let c = gradient([[150, 255, 180], [40, 200, 100], [12, 120, 60]], v);
			let facet = ((mx + my) >> 2) % 3;
			c = vary(c, facet * 8 - 8 + (hash(mx >> 1, my >> 1, 101) - 0.5) * 14);
			if (hash(mx, my, 102) > 0.99) c = [230, 255, 240];
			return c;
		}
	},
	gradient: {
		name: 'Gradient',
		colors: true,
		sample(mx, my, v, row_px, params) {
			let stops = [params.color_1, params.color_2];
			if (params.color_3_enabled) stops.splice(1, 0, params.color_3);
			return gradient(stops.map(hexToRgb), v);
		}
	},
	solid: {
		name: 'Solid colour',
		colors: true,
		sample(mx, my, v, row_px, params) {
			return hexToRgb(params.color_1);
		}
	},
};

export const AukOverlays = {
	none: {name: 'None'},
	shine: {
		name: 'Shine',
		apply(c, mx, my, v) {
			return v < 0.45 ? lighten(c, 0.45 * (1 - v / 0.45)) : shade(c, 1 - (v - 0.45) * 0.3);
		}
	},
	noise: {
		name: 'Noise',
		apply(c, mx, my) {
			return vary(c, (hash(mx >> 1, my >> 1, 201) - 0.5) * 60);
		}
	},
	stripes: {
		name: 'Stripes',
		apply(c, mx, my) {
			return ((mx + my) % 12 + 12) % 12 < 4 ? lighten(c, 0.3) : c;
		}
	},
	sparkle: {
		name: 'Sparkle',
		apply(c, mx, my) {
			let n = hash(mx, my, 211);
			return n > 0.97 ? [255, 255, 255] : (n > 0.94 ? lighten(c, 0.5) : c);
		}
	},
};
