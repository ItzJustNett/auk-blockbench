// SPDX-License-Identifier: GPL-3.0-or-later

import { AukFonts, fontCharacters } from './fonts.js';
import { AukMaterials, AukOverlays } from './materials.js';
import { buildRow, defaultRow, num, MAX_TEXT_LENGTH, TEXT_TYPES } from './builder.js';
import { AukLink, AukRenderers, saveToAuk, toSquarePNG } from '../save_to_auk.js';

export const FORMAT_ID = 'auk_title';
const UNIT = 2;
const ROW_GAP = 1.5;

const isTitle = () => !!(Project && Format && Format.id == FORMAT_ID);
const clone = obj => JSON.parse(JSON.stringify(obj));

function isRow(node) {
	return node instanceof Group && node.auk_text && typeof node.auk_text.text == 'string';
}

export function titleRows() {
	let rows = [];
	let walk = nodes => nodes.forEach(node => {
		if (isRow(node)) rows.push(node);
		else if (node instanceof Group) walk(node.children);
	});
	walk(Outliner.root);
	return rows;
}
function rowTexture(group) {
	let id = group.auk_text.texture;
	return id ? Texture.all.find(t => t.uuid == id) : null;
}
function rowOf(node) {
	while (node) {
		if (isRow(node)) return node;
		node = node.parent instanceof Group ? node.parent : null;
	}
	return null;
}
function selectedRow() {
	let group = Group.first_selected || (Outliner.selected[0] && Outliner.selected[0].parent);
	return group instanceof Group ? rowOf(group) : null;
}
function rowName(cfg) {
	let type = TEXT_TYPES[cfg.type]?.name || 'Text';
	return `${type}: ${cfg.text || '(empty)'}`.substring(0, 48);
}
function atlasToDataURL(atlas) {
	let canvas = document.createElement('canvas');
	canvas.width = atlas.width;
	canvas.height = atlas.height;
	canvas.getContext('2d').putImageData(new ImageData(atlas.pixels, atlas.width, atlas.height), 0, 0);
	return canvas.toDataURL('image/png');
}

function regenerate() {
	let rows = titleRows();
	let built = rows.map(group => ({group, cfg: group.auk_text, model: buildRow(group.auk_text)}));
	let scales = built.map(b => UNIT * num(b.cfg.size, 1, 0.05, 20));
	let total = built.reduce((sum, b, i) => sum + b.model.h * scales[i], 0) + ROW_GAP * Math.max(0, built.length - 1);
	let top = total;
	let cubes = [], textures = [];

	built.forEach(({group, cfg, model}, i) => {
		let s = scales[i];
		group.children.filter(c => c instanceof Cube).forEach(cube => cube.remove());

		let texture = rowTexture(group);
		let url = atlasToDataURL(model.atlas);
		if (texture) {
			texture.updateSource(url);
		} else {
			texture = new Texture({name: `title_row_${i + 1}.png`}).fromDataURL(url).add(false);
			cfg.texture = texture.uuid;
		}
		texture.uv_width = model.atlas.width;
		texture.uv_height = model.atlas.height;
		textures.push(texture);

		let x0 = -model.w * s / 2 + num(cfg.offset_x, 0, -500, 500) * s;
		let y0 = top + num(cfg.offset_y, 0, -500, 500) * s;
		let depth = num(cfg.depth, 1, 0.1, 64) * s;
		let place = (rect, z1, z2) => ({
			from: [x0 + rect.x * s, y0 - (rect.y + rect.h) * s, z1],
			to: [x0 + (rect.x + rect.w) * s, y0 - rect.y * s, z2],
		});
		let make = (name, part, z1, z2) => {
			let faces = {};
			for (let key in part.faces) faces[key] = {uv: part.faces[key], texture};
			let cube = new Cube(Object.assign({name, autouv: 0, box_uv: false, origin: [0, 0, 0], faces}, place(part.rect, z1, z2))).init();
			cube.addTo(group);
			cubes.push(cube);
		};
		if (!model.empty) {
			model.text.forEach(part => make('letters', part, -depth, 0));
			let back = -depth - num(cfg.depth, 1, 0.5, 1) * s;
			model.outline.forEach(part => make('outline', part, back, -depth * 0.5));
		}
		group.name = rowName(cfg);
		top -= model.h * s + ROW_GAP;
	});

	let used = new Set(rows.map(g => g.auk_text.texture));
	Texture.all.filter(t => t.name.startsWith('title_row_') && !used.has(t.uuid)).forEach(t => t.remove(true));

	Canvas.updateAllFaces();
	return {cubes, textures, groups: rows};
}

export function editTitle(message, change) {
	let rows = titleRows();
	Undo.initEdit({
		elements: rows.flatMap(g => g.children.filter(c => c instanceof Cube)),
		outliner: true,
		groups: rows,
		textures: rows.map(rowTexture).filter(Boolean),
	});
	if (change) change();
	let result = regenerate();
	Undo.finishEdit(message, {elements: result.cubes, outliner: true, groups: result.groups, textures: result.textures});
	updateSelection();
	TitlePanel.load();
	return result;
}

export function addRow(type = 'title', text = 'AUK', extra = {}) {
	let group;
	editTitle('Add title text', () => {
		let cfg = Object.assign(defaultRow(type, text), extra);
		group = new Group({name: rowName(cfg), origin: [0, 0, 0]}).init();
		group.auk_text = cfg;
		group.addTo();
	});
	group.select();
	TitlePanel.load();
	return group;
}

function removeRow(group) {
	editTitle('Remove title text', () => {
		group.children.slice().forEach(child => child.remove());
		let texture = rowTexture(group);
		group.remove(false);
		if (texture) texture.remove(true);
	});
}

function moveRow(group, direction) {
	let siblings = group.parent instanceof Group ? group.parent.children : Outliner.root;
	let index = siblings.indexOf(group);
	let target = index + direction;
	if (target < 0 || target >= siblings.length) return;
	editTitle('Move title text', () => {
		siblings.splice(index, 1);
		siblings.splice(target, 0, group);
	});
}

function titleBox() {
	let box = new THREE.Box3();
	titleRows().forEach(group => group.children.forEach(cube => {
		if (!(cube instanceof Cube)) return;
		box.expandByPoint(new THREE.Vector3(...cube.from));
		box.expandByPoint(new THREE.Vector3(...cube.to));
	}));
	return box;
}

export const CameraSettings = {
	elevation: -10,
	yaw: 0,
	fov: 30,
	margin: 0.06,
};

export function titleCamera(aspect, options = CameraSettings) {
	let box = titleBox();
	if (box.isEmpty()) return null;
	let center = box.getCenter(new THREE.Vector3());
	let e = Math.degToRad(options.elevation), yaw = Math.degToRad(options.yaw);
	let dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e)).normalize();
	let cam = new THREE.PerspectiveCamera(options.fov, aspect, 0.1, 100000);
	let corners = [];
	for (let i = 0; i < 8; i++) {
		corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
	}
	let target = center.clone();
	let limit = 1 - options.margin * 2;
	let extent = (dist) => {
		cam.position.copy(target).addScaledVector(dir, dist);
		cam.lookAt(target);
		cam.updateMatrixWorld();
		let min = new THREE.Vector2(Infinity, Infinity), max = new THREE.Vector2(-Infinity, -Infinity);
		for (let c of corners) {
			let p = c.clone().project(cam);
			min.min(p); max.max(p);
		}
		return {min, max};
	};
	let size = box.getSize(new THREE.Vector3()).length();
	let dist = size;
	for (let pass = 0; pass < 4; pass++) {

		let lo = size * 0.05, hi = size * 50;
		for (let i = 0; i < 40; i++) {
			let mid = (lo + hi) / 2;
			let {min, max} = extent(mid);
			let fits = min.x >= -limit && max.x <= limit && min.y >= -limit && max.y <= limit;
			if (fits) hi = mid; else lo = mid;
		}
		dist = hi;

		let {min, max} = extent(dist);
		let half_h = Math.tan(Math.degToRad(options.fov) / 2) * dist;
		let half_w = half_h * aspect;
		let right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
		let up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
		target.addScaledVector(right, (min.x + max.x) / 2 * half_w);
		target.addScaledVector(up, (min.y + max.y) / 2 * half_h);
	}
	extent(dist);
	return {position: cam.position.clone(), target, fov: options.fov};
}

function applyCamera(preview, aspect) {
	let view = titleCamera(aspect);
	if (!view) return false;
	if (preview.isOrtho) preview.setProjectionMode(false);
	preview.setFOV(view.fov);
	preview.controls.target.copy(view.target);
	preview.camera.position.copy(view.position);
	preview.camera.lookAt(view.target);
	if (preview.controls.update) preview.controls.update();
	return true;
}

export function positionCamera(preview = Preview.selected) {
	if (!isTitle()) return;
	let aspect = RenderSettings.lock_aspect ? RenderSettings.width / RenderSettings.height : preview.width / preview.height;
	if (!applyCamera(preview, aspect)) Blockbench.showQuickMessage('Add some text first');
}

export const RenderSettings = {
	width: 1600,
	height: 600,
	background: 'transparent',
	background_color: '#1e1b26',
	supersample: 2,
	shading: true,
	fit: true,
	lock_aspect: false,
};

function texturesReady() {
	let pending = titleRows().map(rowTexture).filter(t => t && t.img && !(t.img.complete && t.img.naturalWidth));
	return Promise.all(pending.map(t => new Promise(resolve => {
		t.img.addEventListener('load', resolve, {once: true});
		t.img.addEventListener('error', resolve, {once: true});
		setTimeout(resolve, 3000);
	}))).then(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

export async function renderTitle(options = {}) {
	await texturesReady();
	let o = Object.assign({}, RenderSettings, options);
	let width = Math.round(Math.max(8, Math.min(8192, o.width)));
	let height = Math.round(Math.max(8, Math.min(8192, o.height)));
	let f = Math.max(1, Math.min(o.supersample, Math.floor(8192 / Math.max(width, height))));
	let vp = MediaPreview;
	let shading_before = settings.shading.value;
	if (o.shading != shading_before) settings.shading.set(o.shading);
	try {
		vp.copyView(Preview.selected);
		vp.resize(width * f, height * f);
		if (o.fit) applyCamera(vp, width / height);
		Canvas.withoutGizmos(() => vp.render());
		let canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		let ctx = canvas.getContext('2d');
		if (o.background == 'color') {
			ctx.fillStyle = o.background_color;
			ctx.fillRect(0, 0, width, height);
		}
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(vp.canvas, 0, 0, width * f, height * f, 0, 0, width, height);
		return canvas.toDataURL('image/png');
	} finally {
		if (settings.shading.value != shading_before) settings.shading.set(shading_before);
	}
}

function downloadPNG(data_url) {
	Blockbench.export({
		resource_id: 'screenshot',
		extensions: ['png'],
		type: 'PNG image',
		savetype: 'image',
		name: (Project && Project.name) || 'title',
		content: data_url,
	});
}

async function showRender() {
	let url = await renderTitle();
	let img = new Image();
	img.src = url;
	img.className = 'checkerboard auk_title_render_result';
	await img.decode();
	let buttons = ['Download PNG'];
	if (AukLink.available) buttons.push('Save to Auk');
	buttons.push('dialog.close');
	new Dialog({
		id: 'auk_title_render',
		title: `Render · ${img.naturalWidth}×${img.naturalHeight}`,
		width: Math.min(1100, window.innerWidth - 60),
		lines: [img],
		buttons,
		cancelIndex: buttons.length - 1,
		onButton(index) {
			if (buttons[index] == 'Download PNG') downloadPNG(url);
			if (buttons[index] == 'Save to Auk') AukLink.sendImage('title', url, img.naturalWidth, img.naturalHeight);
		}
	}).show();
}

AukRenderers.title = async ({kind, width, height}) => {
	if (!isTitle()) return null;
	if (kind == 'icon') {
		let big = await renderTitle({width: 512, height: 512, supersample: 2, background: 'transparent', fit: true});
		return toSquarePNG(big, 64);
	}
	return renderTitle({width, height});
};

const CSS = `
#panel_auk_title_text .auk_rows { list-style: none; margin: 0 0 6px; padding: 0; }
#panel_auk_title_text .auk_rows li { display: flex; align-items: center; gap: 4px; padding: 2px 6px; cursor: pointer; border-radius: 4px; }
#panel_auk_title_text .auk_rows li.selected { background: var(--color-selected); color: var(--color-light); }
#panel_auk_title_text .auk_rows li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.auk_form { padding: 2px 8px 10px; }
.auk_form .auk_field { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.auk_form .auk_field > label { flex: 0 0 96px; color: var(--color-subtle_text); }
.auk_form .auk_field > input:not([type=checkbox]):not([type=color]), .auk_form .auk_field > select { flex: 1; min-width: 0; height: 26px; }
.auk_form .auk_field > input[type=color] { width: 40px; height: 24px; padding: 0; border: none; background: none; }
.auk_form .auk_field > input[type=range] { flex: 1; }
.auk_form .auk_field > .auk_value { flex: 0 0 34px; text-align: right; font-size: 0.9em; }
.auk_form h4 { margin: 10px 0 2px; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-subtle_text); }
.auk_form .auk_buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.auk_form .auk_buttons button { flex: 1 1 auto; }
.auk_form .auk_hint { color: var(--color-subtle_text); font-size: 0.9em; margin: 6px 0; }
.auk_chars { font-family: var(--font-code, monospace); font-size: 18px; line-height: 1.6; word-break: break-all; }
img.auk_title_render_result { max-width: 100%; max-height: 70vh; display: block; margin: 0 auto; }
.auk_based_on { font-size: 0.9em; color: var(--color-subtle_text); }
`;

const TitlePanel = {
	panel: null,
	load() {
		let vue = this.panel && this.panel.inside_vue;
		if (!vue) return;
		let group = isTitle() ? selectedRow() : null;
		vue.rows = isTitle() ? titleRows().map(g => ({uuid: g.uuid, name: g.name})) : [];
		vue.uuid = group ? group.uuid : '';
		vue.row = group ? Object.assign(defaultRow(group.auk_text.type), clone(group.auk_text)) : null;
	},
};

let commit_timer = null;
function scheduleCommit(vue) {
	clearTimeout(commit_timer);
	commit_timer = setTimeout(() => {
		let group = Group.all.find(g => g.uuid == vue.uuid);
		if (!group || !vue.row || !isTitle()) return;
		let next = clone(vue.row);
		next.texture = group.auk_text.texture;
		if (JSON.stringify(next) == JSON.stringify(group.auk_text)) return;
		editTitle('Edit title text', () => {
			group.auk_text = next;
		});
	}, 200);
}

function field(label, input) {
	return `<div class="auk_field"><label>${label}</label>${input}</div>`;
}
function range(key, min, max, step) {
	return `<input type="range" min="${min}" max="${max}" step="${step}" v-model.number="row.${key}"><span class="auk_value">{{ row.${key} }}</span>`;
}

const panel_component = {
	data() {
		return {
			rows: [],
			uuid: '',
			row: null,
			types: Object.fromEntries(Object.entries(TEXT_TYPES).map(([id, t]) => [id, t.name])),
			fonts: Object.fromEntries(Object.entries(AukFonts).map(([id, f]) => [id, f.name])),
			materials: Object.fromEntries(Object.entries(AukMaterials).map(([id, m]) => [id, m.name])),
			overlays: Object.fromEntries(Object.entries(AukOverlays).map(([id, m]) => [id, m.name])),
		};
	},
	computed: {
		uses_colors() {
			return this.row && AukMaterials[this.row.material]?.colors;
		},
		font_info() {
			return this.row && AukFonts[this.row.font]?.description;
		},
	},
	watch: {
		row: {
			deep: true,
			handler() {
				if (this.row) scheduleCommit(this);
			}
		}
	},
	methods: {
		select(uuid) {
			let group = Group.all.find(g => g.uuid == uuid);
			if (group) group.select();
			TitlePanel.load();
		},
		setType(type) {
			Object.assign(this.row, TEXT_TYPES[type].defaults, {type});
		},
		addRow() {
			BarItems.auk_title_add_text.click();
		},
		move(direction) {
			let group = Group.all.find(g => g.uuid == this.uuid);
			if (group) moveRow(group, direction);
		},
		remove() {
			let group = Group.all.find(g => g.uuid == this.uuid);
			if (group) removeRow(group);
		},
		showCharacters() {
			showCharacters(this.row.font);
		},
		canSaveToAuk() {
			return !!(BarItems.save_to_auk && BarItems.save_to_auk.condition && Condition(BarItems.save_to_auk.condition));
		},
		saveToAuk() {
			BarItems.save_to_auk.click();
		},
		positionCamera() {
			positionCamera();
		},
	},
	template: `
		<div class="auk_form">
			<ul class="auk_rows">
				<li v-for="r in rows" :key="r.uuid" :class="{selected: r.uuid == uuid}" @click="select(r.uuid)">
					<i class="material-icons icon">text_fields</i><span>{{ r.name }}</span>
				</li>
			</ul>
			<div class="auk_buttons">
				<button @click="addRow()"><i class="material-icons icon">add</i> Add text</button>
				<button @click="positionCamera()"><i class="material-icons icon">auto_mode</i> Position camera</button>
				<button v-if="canSaveToAuk()" class="auk_save" @click="saveToAuk()"><i class="material-icons icon">cloud_upload</i> Save to Auk</button>
			</div>
			<p class="auk_hint" v-if="!row">Select a text row to edit it.</p>
			<template v-if="row">
				<h4>Text</h4>
				${field('Text', `<input type="text" class="dark_bordered" v-model="row.text" maxlength="${MAX_TEXT_LENGTH}" spellcheck="false">`)}
				<div class="auk_field"><label>Type</label>
					<select class="dark_bordered" :value="row.type" @change="setType($event.target.value)">
						<option v-for="(name, id) in types" :value="id">{{ name }}</option>
					</select>
				</div>
				<div class="auk_field"><label>Font</label>
					<select class="dark_bordered" v-model="row.font"><option v-for="(name, id) in fonts" :value="id">{{ name }}</option></select>
					<div class="tool" title="Characters in this font" @click="showCharacters()"><i class="material-icons icon">info</i></div>
				</div>
				<p class="auk_hint">{{ font_info }}</p>
				${field('Size', range('size', 0.2, 3, 0.05))}
				${field('Depth', range('depth', 0.2, 12, 0.1))}
				${field('Spacing', '<input type="number" class="dark_bordered" min="0" max="8" step="1" :placeholder="\'font default\'" v-model.number="row.spacing">')}
				${field('Space width', '<input type="number" class="dark_bordered" min="1" max="12" step="1" :placeholder="\'font default\'" v-model.number="row.space">')}
				${field('Offset X', range('offset_x', -40, 40, 0.5))}
				${field('Offset Y', range('offset_y', -20, 20, 0.5))}

				<h4>Material</h4>
				<div class="auk_field"><label>Material</label>
					<select class="dark_bordered" v-model="row.material"><option v-for="(name, id) in materials" :value="id">{{ name }}</option></select>
				</div>
				<template v-if="uses_colors">
					${field('Colour 1', '<input type="color" v-model="row.color_1">')}
					<template v-if="row.material == 'gradient'">
						${field('Middle', '<input type="checkbox" v-model="row.color_3_enabled"><input type="color" v-model="row.color_3" v-if="row.color_3_enabled">')}
						${field('Colour 2', '<input type="color" v-model="row.color_2">')}
					</template>
				</template>
				${field('Tint', '<input type="color" v-model="row.tint">' + range('tint_opacity', 0, 1, 0.05))}
				<div class="auk_field"><label>Overlay</label>
					<select class="dark_bordered" v-model="row.overlay"><option v-for="(name, id) in overlays" :value="id">{{ name }}</option></select>
				</div>
				<div class="auk_field" v-if="row.overlay != 'none'"><label>Overlay opacity</label>${range('overlay_opacity', 0, 1, 0.05)}</div>
				<div class="auk_field"><label>Resolution</label>
					<select class="dark_bordered" v-model.number="row.resolution">
						<option :value="4">Low (4 px per block)</option><option :value="8">Normal (8)</option><option :value="16">High (16)</option><option :value="32">Ultra (32)</option>
					</select>
				</div>

				<h4>Style</h4>
				${field('Bevel', '<input type="checkbox" v-model="row.bevel">' + range('bevel_strength', 0, 1, 0.05))}
				${field('Outline', '<input type="checkbox" v-model="row.outline"><input type="number" class="dark_bordered" min="1" max="3" step="1" v-model.number="row.outline_size" v-if="row.outline">')}
				${field('Border colour', '<input type="color" v-model="row.border_color">')}
				${field('Fade sides', '<input type="checkbox" v-model="row.fade"><span class="auk_hint">sides fade to the border colour</span>')}
				${field('Side shade', range('side_shade', 0.2, 1, 0.02))}

				<div class="auk_buttons">
					<button @click="move(-1)" title="Move up"><i class="material-icons icon">arrow_upward</i></button>
					<button @click="move(1)" title="Move down"><i class="material-icons icon">arrow_downward</i></button>
					<button @click="remove()"><i class="material-icons icon">delete</i> Remove</button>
				</div>
			</template>
		</div>
	`
};

const render_component = {
	data() {
		return {s: RenderSettings, cam: CameraSettings, embedded: AukLink.available};
	},
	methods: {
		preset(w, h) {
			this.s.width = w;
			this.s.height = h;
		},
		positionCamera() {
			positionCamera();
		},
		render() {
			showRender();
		},
		async download() {
			downloadPNG(await renderTitle());
		},
		saveTitle() {
			saveToAuk('title', this.s.width, this.s.height);
		},
		saveIcon() {
			saveToAuk('icon', 64, 64);
		},
	},
	watch: {
		cam: {deep: true, handler() { positionCamera(); }},
	},
	template: `
		<div class="auk_form">
			<h4>Camera</h4>
			<div class="auk_buttons">
				<button @click="positionCamera()" title="Frame the whole title"><i class="material-icons icon">auto_mode</i> Position camera</button>
			</div>
			<div class="auk_field"><label>Angle</label><input type="range" min="-40" max="40" step="1" v-model.number="cam.elevation"><span class="auk_value">{{ cam.elevation }}°</span></div>
			<div class="auk_field"><label>Turn</label><input type="range" min="-45" max="45" step="1" v-model.number="cam.yaw"><span class="auk_value">{{ cam.yaw }}°</span></div>
			<div class="auk_field"><label>Field of view</label><input type="range" min="5" max="90" step="1" v-model.number="cam.fov"><span class="auk_value">{{ cam.fov }}°</span></div>

			<h4>Output</h4>
			<div class="auk_field"><label>Width</label><input type="number" class="dark_bordered" min="8" max="8192" v-model.number="s.width"></div>
			<div class="auk_field"><label>Height</label><input type="number" class="dark_bordered" min="8" max="8192" v-model.number="s.height"></div>
			<div class="auk_buttons">
				<button @click="preset(1600, 600)">1600×600</button>
				<button @click="preset(1920, 1080)">1920×1080</button>
				<button @click="preset(1024, 1024)">1024²</button>
				<button @click="preset(3840, 1440)">4K wide</button>
			</div>
			<div class="auk_field"><label>Frame title</label><input type="checkbox" v-model="s.fit"><span class="auk_hint">off: render the current view</span></div>
			<div class="auk_field"><label>Preview ratio</label><input type="checkbox" v-model="s.lock_aspect"><span class="auk_hint">frame the viewport like the output</span></div>
			<div class="auk_field"><label>Background</label>
				<select class="dark_bordered" v-model="s.background"><option value="transparent">Transparent</option><option value="color">Colour</option></select>
				<input type="color" v-model="s.background_color" v-if="s.background == 'color'">
			</div>
			<div class="auk_field"><label>Anti-aliasing</label>
				<select class="dark_bordered" v-model.number="s.supersample"><option :value="1">Normal</option><option :value="2">Smooth (2×)</option><option :value="3">Smoother (3×)</option></select>
			</div>
			<div class="auk_field"><label>Shading</label><input type="checkbox" v-model="s.shading"></div>
			<div class="auk_buttons">
				<button @click="render()"><i class="material-icons icon">photo_camera</i> Render</button>
				<button @click="download()"><i class="material-icons icon">download</i> Export PNG</button>
			</div>
			<div class="auk_buttons" v-if="embedded">
				<button @click="saveTitle()"><i class="material-icons icon">cloud_upload</i> Save title to Auk</button>
				<button @click="saveIcon()"><i class="material-icons icon">cloud_upload</i> Save as server icon</button>
			</div>
		</div>
	`
};

function showCharacters(font_id) {
	let font = AukFonts[font_id] || AukFonts.block;
	let chars = fontCharacters(font);
	let content = document.createElement('div');
	let description = document.createElement('p');
	description.textContent = font.description;
	let list = document.createElement('p');
	list.className = 'auk_chars';
	list.textContent = chars.join(' ');
	content.append(description, list);
	new Dialog({
		id: 'auk_title_characters',
		title: `${font.name}: characters`,
		width: 520,
		lines: [content],
		buttons: ['Add rows with all of them', 'dialog.close'],
		cancelIndex: 1,
		onButton(index) {
			if (index != 0) return;
			editTitle('Add character rows', () => {
				for (let i = 0; i < chars.length; i += 32) {
					let cfg = Object.assign(defaultRow('title', chars.slice(i, i + 32).join('')), {font: font.id, size: 0.5});
					let group = new Group({name: rowName(cfg), origin: [0, 0, 0]}).init();
					group.auk_text = cfg;
					group.addTo();
				}
			});
			positionCamera();
		}
	}).show();
}

function newTitleDialog() {
	new Dialog({
		id: 'auk_title_new',
		title: 'New title',
		width: 460,
		form: {
			title: {label: 'Title', type: 'text', value: 'AUK HOSTING'},
			subtitle: {label: 'Subtitle', type: 'text', value: 'Minecraft servers'},
			material: {label: 'Material', type: 'select', value: 'stone',
				options: Object.fromEntries(Object.entries(AukMaterials).filter(([, m]) => !m.colors).map(([id, m]) => [id, m.name]))},
			subtitle_material: {label: 'Subtitle material', type: 'select', value: 'gold',
				options: Object.fromEntries(Object.entries(AukMaterials).filter(([, m]) => !m.colors).map(([id, m]) => [id, m.name]))},
		},
		onConfirm(form) {
			editTitle('Create title', () => {
				let rows = [];
				if (form.title.trim()) rows.push(Object.assign(defaultRow('title', form.title.trim()), {material: form.material}));
				if (form.subtitle.trim()) rows.push(Object.assign(defaultRow('subtitle', form.subtitle.trim()), {material: form.subtitle_material}));
				for (let cfg of rows) {
					let group = new Group({name: rowName(cfg), origin: [0, 0, 0]}).init();
					group.auk_text = cfg;
					group.addTo();
				}
			});
			let first = titleRows()[0];
			if (first) first.select();
			TitlePanel.load();
			positionCamera();
		}
	}).show();
}

export function setupTitleGenerator() {
	Blockbench.addCSS(CSS);

	new Property(Group, 'object', 'auk_text', {condition: {formats: [FORMAT_ID]}});

	new ModelFormat(FORMAT_ID, {
		name: 'Auk Title',
		description: 'Minecraft-style 3D titles and logos made from text, rendered to PNG.',
		icon: 'text_fields',
		category: 'minecraft',
		target: ['Auk Hosting', 'PNG renders'],
		format_page: {
			content: [
				{type: 'h3', text: 'Auk Title'},
				{text: '* Type your text, pick a type (title, subtitle, small) and a material.\n'
					+ '* Add more rows with **Add text**; edit the selected row in the **Title text** panel.\n'
					+ '* Switch to **Render** (top right) to frame the title and export a PNG with a transparent background.'},
				{type: 'h3', text: 'Made for Auk'},
				{text: 'Our own block fonts (Latin, Ukrainian, digits, punctuation) and generated textures.'},
			],
			button_text: 'Create title',
		},
		centered_grid: true,
		per_texture_uv_size: true,
		rotate_cubes: false,
		edit_mode: true,
		paint_mode: true,
		display_mode: false,
		animation_mode: false,
		new() {
			if (newProject(this)) {
				newTitleDialog();
				return true;
			}
			return false;
		},
	});

	DefaultCameraPresets.push({
		name: 'Title',
		id: 'auk_title',
		projection: 'perspective',
		condition: {formats: [FORMAT_ID]},
		get position() {
			let view = isTitle() && titleCamera(Preview.selected ? Preview.selected.width / Preview.selected.height : 16 / 9);
			return view ? view.position.toArray() : [0, 16, 96];
		},
		get target() {
			let view = isTitle() && titleCamera(Preview.selected ? Preview.selected.width / Preview.selected.height : 16 / 9);
			return view ? view.target.toArray() : [0, 8, 0];
		},
		get fov() {
			return CameraSettings.fov;
		},
	});

	new Action('auk_title_add_text', {
		name: 'Add Text',
		description: 'Add a row of text to the title',
		icon: 'text_fields',
		category: 'edit',
		condition: isTitle,
		click() {
			new Dialog({
				id: 'auk_title_add',
				title: 'Add text',
				form: {
					text: {label: 'Text', type: 'text', value: ''},
					type: {label: 'Type', type: 'select', value: titleRows().length ? 'subtitle' : 'title',
						options: Object.fromEntries(Object.entries(TEXT_TYPES).map(([id, t]) => [id, t.name]))},
				},
				onConfirm(form) {
					addRow(form.type, form.text || 'TEXT');
				}
			}).show();
		}
	});
	new Action('auk_title_position_camera', {
		name: 'Position Camera',
		description: 'Frame the whole title from the title angle',
		icon: 'auto_mode',
		category: 'view',
		condition: isTitle,
		click: () => positionCamera(),
	});
	new Action('auk_title_characters', {
		name: 'Show All Title Characters',
		description: 'List every character of a title font and add a row with all of them',
		icon: 'abc',
		category: 'edit',
		condition: isTitle,
		click: () => showCharacters(selectedRow()?.auk_text.font || 'block'),
	});
	new Action('auk_title_render', {
		name: 'Render Title',
		description: 'Render the title as a PNG',
		icon: 'photo_camera',
		category: 'view',
		condition: isTitle,
		click: () => showRender(),
	});
	Toolbars.outliner.add(BarItems.auk_title_add_text, 0);
	MenuBar.addAction(BarItems.auk_title_add_text, 'edit');
	MenuBar.addAction(BarItems.auk_title_characters, 'edit');
	MenuBar.addAction(BarItems.auk_title_position_camera, 'view');
	MenuBar.addAction(BarItems.auk_title_render, 'view');

	TitlePanel.panel = new Panel('auk_title_text', {
		name: 'Title Text',
		icon: 'text_fields',
		condition: () => isTitle() && Modes.edit,
		default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 600], height: 600, sidebar_index: 0},
		component: panel_component,
	});
	new Mode('auk_title_render', {
		name: 'Render',
		icon: 'photo_camera',
		selectElements: false,
		hide_toolbars: true,
		condition: isTitle,
		onSelect() {

			setTimeout(() => positionCamera(), 50);
		},
	});
	new Panel('auk_title_render_panel', {
		name: 'Render',
		icon: 'photo_camera',
		condition: () => isTitle() && Modes.auk_title_render,
		default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 600], height: 600, sidebar_index: 0},
		component: render_component,
	});

	window.AukTitle = {addRow, editTitle, titleRows, renderTitle, positionCamera, titleCamera, CameraSettings, RenderSettings};

	Blockbench.on('update_selection', () => TitlePanel.load());
	Blockbench.on('select_project', () => TitlePanel.load());
	Blockbench.on('select_mode', () => TitlePanel.load());
	Blockbench.on('finished_edit', () => TitlePanel.load());
}
