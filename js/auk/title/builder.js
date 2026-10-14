// Auk Title builder: turns one text row's settings into block geometry (rectangles of glyph
// pixels) and a texture atlas. Pure functions, no Blockbench state, so they can be tested alone.
// SPDX-License-Identifier: GPL-3.0-or-later

import { AukFonts, glyphFor } from './fonts.js';
import { AukMaterials, AukOverlays, hexToRgb, lighten, mix, shade } from './materials.js';

export const TEXT_TYPES = {
	title: {
		name: 'Title',
		defaults: {font: 'block', size: 1, depth: 4, material: 'stone', bevel: true, outline: true, fade: false, overlay: 'none'}
	},
	subtitle: {
		name: 'Subtitle',
		defaults: {font: 'pixel', size: 0.6, depth: 2, material: 'gold', bevel: false, outline: true, fade: true, overlay: 'shine'}
	},
	small: {
		name: 'Small text',
		defaults: {font: 'pixel', size: 0.4, depth: 0.5, material: 'solid', bevel: false, outline: false, fade: false, overlay: 'none', color_1: '#ffffff'}
	},
};

export function defaultRow(type = 'title', text = 'AUK') {
	return Object.assign({
		text,
		type,
		font: 'block',
		size: 1,
		depth: 4,
		spacing: null, // null: the font's own spacing
		space: null,
		offset_x: 0,
		offset_y: 0,
		material: 'stone',
		color_1: '#ffd84a',
		color_2: '#e0662a',
		color_3: '#ffffff',
		color_3_enabled: false,
		tint: '#ffffff',
		tint_opacity: 0,
		overlay: 'none',
		overlay_opacity: 0.6,
		bevel: true,
		bevel_strength: 0.35,
		outline: true,
		outline_size: 1,
		border_color: '#1c1822',
		fade: false,
		side_shade: 0.62,
		resolution: 8,
	}, TEXT_TYPES[type]?.defaults || {});
}

/** Glyph-pixel mask of a row of text, with `margin` empty cells around it. */
export function layoutText(text, font, spacing, space, margin) {
	let glyphs = [];
	let width = 0;
	let chars = Array.from(text || '');
	chars.forEach((char, i) => {
		if (char == ' ') {
			width += space;
			return;
		}
		let glyph = glyphFor(font, char);
		if (glyphs.length && chars[i - 1] != ' ') width += spacing;
		glyphs.push({x: width, rows: glyph});
		width += glyph[0].length;
	});
	let w = Math.max(1, width) + margin * 2;
	let h = font.height + margin * 2;
	let cells = new Uint8Array(w * h);
	for (let glyph of glyphs) {
		glyph.rows.forEach((row, y) => {
			for (let x = 0; x < row.length; x++) {
				if (row[x] == '#') cells[(y + margin) * w + glyph.x + x + margin] = 1;
			}
		});
	}
	return {w, h, cells, empty: glyphs.length == 0};
}

/** Grow a mask by `size` cells in every direction (square brush). */
export function dilate(mask, size) {
	let {w, h, cells} = mask;
	let out = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!cells[y * w + x]) continue;
			for (let dy = -size; dy <= size; dy++) {
				for (let dx = -size; dx <= size; dx++) {
					let nx = x + dx, ny = y + dy;
					if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
				}
			}
		}
	}
	return {w, h, cells: out};
}

/** Cover the filled cells with as few rectangles as a greedy scan finds. */
export function mergeRects(mask) {
	let {w, h, cells} = mask;
	let done = new Uint8Array(w * h);
	let free = (x, y) => x < w && y < h && cells[y * w + x] && !done[y * w + x];
	let rects = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!free(x, y)) continue;
			let x2 = x;
			while (free(x2 + 1, y)) x2++;
			let y2 = y;
			grow: while (y2 + 1 < h) {
				for (let cx = x; cx <= x2; cx++) if (!free(cx, y2 + 1)) break grow;
				y2++;
			}
			for (let cy = y; cy <= y2; cy++) for (let cx = x; cx <= x2; cx++) done[cy * w + cx] = 1;
			rects.push({x, y, w: x2 - x + 1, h: y2 - y + 1});
		}
	}
	return rects;
}

const MAX_ATLAS = 4096;
export const MAX_TEXT_LENGTH = 80;

/** A finite number within [min, max], or the fallback (inputs can hand over '' or NaN). */
export function num(value, fallback, min = -Infinity, max = Infinity) {
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Build one row: geometry in glyph-pixel cells plus a texture atlas (RGBA pixels).
 * Atlas layout, R texels per cell, D texels for the depth:
 *   front    (0, 0)            the text's front faces, one R×R block per cell
 *   h bands  (0, h*R)          per cell row, a D tall strip: top/bottom faces, depth runs down
 *   v bands  (0, h*R + h*D)    per cell column, a D wide strip: left/right faces, depth runs right
 *   border   (w*R, 0)          a small solid patch for the outline blocks
 */
export function buildRow(cfg) {
	let font = AukFonts[cfg.font] || AukFonts.block;
	let margin = cfg.outline ? Math.round(num(cfg.outline_size, 1, 1, 3)) : 0;
	let spacing = Math.round(num(cfg.spacing, font.spacing, 0, 16));
	let space = Math.round(num(cfg.space, font.space, 0, 32));
	let text = Array.from(String(cfg.text ?? '')).slice(0, MAX_TEXT_LENGTH).join('');
	let mask = layoutText(text, font, spacing, space, margin);
	let {w, h} = mask;

	let R = [4, 8, 16, 32].includes(cfg.resolution) ? cfg.resolution : 8;
	while (R > 2 && (w * R + 8 > MAX_ATLAS)) R /= 2;
	let depth = num(cfg.depth, 1, 0.1, 64);
	let D = Math.max(2, Math.min(64, Math.round(depth * R)));
	let per_line = Math.max(1, Math.floor((w * R) / D));
	let lines = Math.ceil(w / per_line);
	while (R > 2 && (h * R + h * D + lines * h * R > MAX_ATLAS)) {
		R /= 2;
		D = Math.max(2, Math.min(64, Math.round(depth * R)));
		per_line = Math.max(1, Math.floor((w * R) / D));
		lines = Math.ceil(w / per_line);
	}
	let width = w * R + 4;
	let height = h * R + h * D + lines * h * R;
	let hband_y = h * R;
	let vband_y = h * R + h * D;
	let border_px = [w * R, 0];

	let material = AukMaterials[cfg.material] || AukMaterials.stone;
	let overlay = AukOverlays[cfg.overlay];
	let tint = hexToRgb(cfg.tint);
	let border = hexToRgb(cfg.border_color);
	let side_shade = num(cfg.side_shade, 0.62, 0, 1);
	let overlay_opacity = num(cfg.overlay_opacity, 0, 0, 1);
	let tint_opacity = num(cfg.tint_opacity, 0, 0, 1);
	let scale = 8 / R;
	let filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask.cells[y * w + x] == 1;

	// colour of the text's surface at a front texel (before bevel)
	function surface(tx, ty) {
		let mx = Math.floor(tx * scale), my = Math.floor(ty * scale);
		let v = Math.min(1, Math.max(0, (ty / R - margin) / font.height));
		let c = material.sample(mx, my, v, font.height, cfg);
		if (overlay && overlay.apply && overlay_opacity > 0) {
			c = mix(c, overlay.apply(c, mx, my, v), overlay_opacity);
		}
		if (tint_opacity > 0) c = mix(c, tint, tint_opacity);
		return c;
	}
	let pixels = new Uint8ClampedArray(width * height * 4);
	function put(x, y, c) {
		let i = (y * width + x) * 4;
		pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = 255;
	}

	// front faces, with a bevel: light on top/left edges, dark on bottom/right edges
	let bevel = cfg.bevel ? Math.max(1, Math.round(R / 4)) : 0;
	let strength = num(cfg.bevel_strength, 0.35, 0, 1);
	for (let ty = 0; ty < h * R; ty++) {
		for (let tx = 0; tx < w * R; tx++) {
			let c = surface(tx, ty);
			if (bevel) {
				let cx = Math.floor(tx / R), cy = Math.floor(ty / R);
				let lx = tx - cx * R, ly = ty - cy * R;
				let light = (ly < bevel && !filled(cx, cy - 1)) || (lx < bevel && !filled(cx - 1, cy));
				let dark = (ly >= R - bevel && !filled(cx, cy + 1)) || (lx >= R - bevel && !filled(cx + 1, cy));
				if (light && !dark) c = lighten(c, strength * 0.7);
				else if (dark && !light) c = shade(c, 1 - strength * 0.6);
			}
			put(tx, ty, c);
		}
	}
	// side strips: the surface colour darkened, fading towards the border colour with depth
	let side = (c, d) => {
		c = shade(c, side_shade);
		return cfg.fade ? mix(c, border, D > 1 ? d / (D - 1) : 1) : c;
	};
	for (let cy = 0; cy < h; cy++) {
		let sy = Math.min(h * R - 1, cy * R + (R >> 1));
		for (let tx = 0; tx < w * R; tx++) {
			let c = surface(tx, sy);
			for (let d = 0; d < D; d++) put(tx, hband_y + cy * D + d, side(c, d));
		}
	}
	for (let cx = 0; cx < w; cx++) {
		let line = Math.floor(cx / per_line);
		let bx = (cx % per_line) * D;
		let by = vband_y + line * h * R;
		let sx = cx * R + (R >> 1);
		for (let ty = 0; ty < h * R; ty++) {
			let c = surface(sx, ty);
			for (let d = 0; d < D; d++) put(bx + d, by + ty, side(c, d));
		}
	}
	for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) put(border_px[0] + x, border_px[1] + y, border);

	function vband(cx) {
		let line = Math.floor(cx / per_line);
		return [(cx % per_line) * D, vband_y + line * h * R];
	}
	// face UVs (in atlas pixels) for a rectangle of text cells
	function textFaces(r) {
		let x1 = r.x * R, x2 = (r.x + r.w) * R;
		let top = hband_y + r.y * D;
		let bottom = hband_y + (r.y + r.h - 1) * D;
		let [ex, ey] = vband(r.x + r.w - 1);
		let [wx, wy] = vband(r.x);
		return {
			south: [x1, r.y * R, x2, (r.y + r.h) * R],
			north: [x2, r.y * R, x1, (r.y + r.h) * R],
			// depth 0 (the front edge) sits at the start of each strip
			up: [x1, top + D, x2, top],
			down: [x1, bottom, x2, bottom + D],
			east: [ex, ey + r.y * R, ex + D, ey + (r.y + r.h) * R],
			west: [wx + D, wy + r.y * R, wx, wy + (r.y + r.h) * R],
		};
	}
	let border_uv = [border_px[0] + 1, border_px[1] + 1, border_px[0] + 3, border_px[1] + 3];
	let outline_faces = {south: border_uv, north: border_uv, up: border_uv, down: border_uv, east: border_uv, west: border_uv};

	let text_rects = mergeRects(mask);
	let outline_rects = cfg.outline ? mergeRects(dilate(mask, margin)) : [];
	return {
		w, h, margin, font, R, D,
		atlas: {width, height, pixels},
		text: text_rects.map(r => ({rect: r, faces: textFaces(r)})),
		outline: outline_rects.map(r => ({rect: r, faces: outline_faces})),
		empty: mask.empty,
	};
}
