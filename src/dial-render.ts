import type { State } from "./komorebi-notifications";

export type DialRenderSettings = {
	axis?: "horizontal" | "vertical";
};

// The touch strip gives each dial a 200x100 canvas
const WIDTH = 200;
const HEIGHT = 100;

export type Direction = "left" | "right" | "up" | "down";
export type Mode = "focus" | "move" | "stack" | "cycle";

const ACCENTS: Record<Mode, string> = {
	focus: "#3b82f6",
	move: "#f59e0b",
	stack: "#22c55e",
	cycle: "#a855f7",
};

const LABELS: Record<Mode, string> = {
	focus: "FOCUS",
	move: "MOVE",
	stack: "STACK",
	cycle: "CYCLE STACK",
};

const BACKGROUND = "#111318";
const TILE_FILL = "#2a2f3a";
const TILE_STROKE = "#4a5160";
const TEXT = "#f3f4f6";
const TEXT_DIM = "#9ca3af";
const FONT = "Segoe UI, Arial, sans-serif";

interface WindowInfo {
	exe?: string;
	title?: string;
}

interface Tile {
	x: number;
	y: number;
	w: number;
	h: number;
	windows: WindowInfo[];
	focusedWindow: number;
}

interface WorkspaceView {
	tiles: Tile[];
	focusedTile: number; // -1 when the workspace has no tiled windows
	monocle: boolean;
}

function readWindows(container: any): WindowInfo[] {
	const elements: any[] = container?.windows?.elements ?? [];
	return elements.map((w) => ({ exe: w?.exe ?? undefined, title: w?.title ?? undefined }));
}

/**
 * The focused workspace of the focused monitor, as tiles in screen coordinates.
 */
function workspaceView(state: State): WorkspaceView | undefined {
	const monitor = state.monitors?.elements?.[state.monitors.focused];
	const workspace = monitor?.workspaces?.elements?.[monitor.workspaces.focused];
	if (!monitor || !workspace) {
		return undefined;
	}

	const area = monitor.work_area_size ?? monitor.size ?? { left: 0, top: 0, right: 1920, bottom: 1080 };

	if (workspace.monocle_container) {
		const windows = readWindows(workspace.monocle_container);
		return {
			tiles: [{
				x: area.left ?? 0,
				y: area.top ?? 0,
				w: area.right ?? 1920,
				h: area.bottom ?? 1080,
				windows,
				focusedWindow: workspace.monocle_container.windows?.focused ?? 0,
			}],
			focusedTile: 0,
			monocle: true,
		};
	}

	const containers: any[] = workspace.containers?.elements ?? [];
	// komorebi's Rect holds the width in `right` and the height in `bottom`
	const layout: any[] = Array.isArray(workspace.latest_layout) && workspace.latest_layout.length === containers.length
		? workspace.latest_layout
		: containers.map((_, i) => ({
			left: (area.left ?? 0) + i * (area.right ?? 1920) / containers.length,
			top: area.top ?? 0,
			right: (area.right ?? 1920) / containers.length,
			bottom: area.bottom ?? 1080,
		}));

	const tiles = containers.map((container, i) => ({
		x: layout[i].left ?? 0,
		y: layout[i].top ?? 0,
		w: layout[i].right ?? 0,
		h: layout[i].bottom ?? 0,
		windows: readWindows(container),
		focusedWindow: container?.windows?.focused ?? 0,
	}));

	return {
		tiles,
		focusedTile: tiles.length > 0 ? Math.min(workspace.containers.focused ?? 0, tiles.length - 1) : -1,
		monocle: false,
	};
}

/**
 * The closest tile in a direction from the given one, or -1. This approximates komorebi's own choice.
 */
function neighbour(tiles: Tile[], from: number, direction: Direction): number {
	const f = tiles[from];
	if (!f) {
		return -1;
	}
	const tolerance = 4;
	let best = -1;
	let bestDistance = Infinity;
	let bestOverlap = -Infinity;

	tiles.forEach((t, i) => {
		if (i === from) {
			return;
		}
		let distance: number;
		let overlap: number;
		if (direction === "left" || direction === "right") {
			overlap = Math.min(f.y + f.h, t.y + t.h) - Math.max(f.y, t.y);
			distance = direction === "left" ? f.x - (t.x + t.w) : t.x - (f.x + f.w);
		} else {
			overlap = Math.min(f.x + f.w, t.x + t.w) - Math.max(f.x, t.x);
			distance = direction === "up" ? f.y - (t.y + t.h) : t.y - (f.y + f.h);
		}
		if (overlap <= 0 || distance < -tolerance) {
			return;
		}
		if (distance < bestDistance - tolerance || (Math.abs(distance - bestDistance) <= tolerance && overlap > bestOverlap)) {
			best = i;
			bestDistance = distance;
			bestOverlap = overlap;
		}
	});

	return best;
}

function escapeXml(value: string): string {
	const entities: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" };
	return value.replace(/[<>&"']/g, (c) => entities[c]);
}

function truncate(value: string, length: number): string {
	return value.length > length ? value.slice(0, length - 1) + "…" : value;
}

function exeName(window?: WindowInfo): string {
	return window?.exe?.replace(/\.exe$/i, "") ?? "";
}

function text(x: number, y: number, value: string, size: number, fill: string, anchor = "start", weight = "normal"): string {
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function chevron(direction: Direction, cx: number, cy: number, fill: string, opacity: number): string {
	const s = 6;
	const points: Record<Direction, string> = {
		left: `${cx + s / 2},${cy - s} ${cx - s / 2},${cy} ${cx + s / 2},${cy + s}`,
		right: `${cx - s / 2},${cy - s} ${cx + s / 2},${cy} ${cx - s / 2},${cy + s}`,
		up: `${cx - s},${cy + s / 2} ${cx},${cy - s / 2} ${cx + s},${cy + s / 2}`,
		down: `${cx - s},${cy - s / 2} ${cx},${cy + s / 2} ${cx + s},${cy - s / 2}`,
	};
	return `<polyline points="${points[direction]}" fill="none" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
}

function header(mode: Mode, info: string): string {
	return text(8, 15, LABELS[mode], 11, ACCENTS[mode], "start", "bold") +
		text(WIDTH - 8, 15, truncate(info, 18), 11, TEXT_DIM, "end");
}

function message(mode: Mode, info: string, body: string): string {
	return header(mode, info) + text(WIDTH / 2, 64, body, 13, TEXT_DIM, "middle");
}

/**
 * A minimap of the workspace's tiles: the focused tile in the dial's colour, the tiles a turn would reach outlined,
 * stacks drawn as layered tiles with their window count, and an arrow each way that lights up when turned.
 */
function minimap(mode: Mode, view: WorkspaceView, directions: [Direction, Direction], flash?: Direction): string {
	const accent = ACCENTS[mode];
	const minX = Math.min(...view.tiles.map((t) => t.x));
	const minY = Math.min(...view.tiles.map((t) => t.y));
	const maxX = Math.max(...view.tiles.map((t) => t.x + t.w));
	const maxY = Math.max(...view.tiles.map((t) => t.y + t.h));
	const horizontal = directions[0] === "left";

	// leave room for the arrows: either side of the map, or stacked on the right
	const box = horizontal ? { x: 24, y: 24, w: 152, h: 70 } : { x: 8, y: 24, w: 164, h: 70 };
	const scale = Math.min(box.w / Math.max(maxX - minX, 1), box.h / Math.max(maxY - minY, 1));
	const offsetX = box.x + (box.w - (maxX - minX) * scale) / 2;
	const offsetY = box.y + (box.h - (maxY - minY) * scale) / 2;

	const targets = new Set(directions.map((d) => neighbour(view.tiles, view.focusedTile, d)).filter((i) => i >= 0));
	let svg = "";

	view.tiles.forEach((t, i) => {
		const x = offsetX + (t.x - minX) * scale + 1.5;
		const y = offsetY + (t.y - minY) * scale + 1.5;
		const w = Math.max(t.w * scale - 3, 2);
		const h = Math.max(t.h * scale - 3, 2);
		const focused = i === view.focusedTile;
		const stacked = t.windows.length > 1;

		if (stacked) {
			svg += `<rect x="${x + 3}" y="${y - 2}" width="${w - 3}" height="${h - 1}" rx="3" fill="${TILE_FILL}" stroke="${focused ? accent : TILE_STROKE}" stroke-width="1" opacity="0.6"/>`;
		}
		svg += `<rect x="${x}" y="${y}" width="${w - (stacked ? 3 : 0)}" height="${h}" rx="3" ` +
			`fill="${focused ? accent : TILE_FILL}" stroke="${focused ? accent : TILE_STROKE}" stroke-width="1"/>`;
		if (targets.has(i)) {
			svg += `<rect x="${x + 2}" y="${y + 2}" width="${w - (stacked ? 3 : 0) - 4}" height="${h - 4}" rx="2" ` +
				`fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
		}
		if (stacked && w > 14 && h > 12) {
			svg += text(x + (w - 3) / 2, y + h / 2 + 4, String(t.windows.length), 11, TEXT, "middle", "bold");
		}
	});

	const arrows: Record<Direction, [number, number]> = horizontal
		? { left: [12, 59], right: [WIDTH - 12, 59], up: [0, 0], down: [0, 0] }
		: { left: [0, 0], right: [0, 0], up: [WIDTH - 14, 44], down: [WIDTH - 14, 74] };
	directions.forEach((d) => {
		const reachable = neighbour(view.tiles, view.focusedTile, d) >= 0;
		const lit = flash === d;
		svg += chevron(d, arrows[d][0], arrows[d][1], lit || reachable ? accent : TEXT_DIM, lit ? 1 : reachable ? 0.6 : 0.2);
	});

	return svg;
}

/**
 * One segment per window in the focused stack, the focused one lit, with the focused window's app and title below.
 */
function stackStrip(view: WorkspaceView, flash?: Direction): string {
	const accent = ACCENTS.cycle;
	const tile = view.tiles[view.focusedTile];
	const count = tile.windows.length;
	const gap = count > 12 ? 1 : 4;
	const width = Math.min((176 - gap * (count - 1)) / count, 40);
	const total = width * count + gap * (count - 1);
	const start = (WIDTH - total) / 2;
	let svg = "";

	for (let i = 0; i < count; i++) {
		const focused = i === tile.focusedWindow;
		svg += `<rect x="${start + i * (width + gap)}" y="30" width="${width}" height="14" rx="${Math.min(4, width / 2)}" ` +
			`fill="${focused ? accent : TILE_FILL}" stroke="${focused ? accent : TILE_STROKE}" stroke-width="1"/>`;
	}

	svg += chevron("left", 8, 37, flash === "left" ? accent : TEXT_DIM, flash === "left" ? 1 : count > 1 ? 0.6 : 0.2);
	svg += chevron("right", WIDTH - 8, 37, flash === "right" ? accent : TEXT_DIM, flash === "right" ? 1 : count > 1 ? 0.6 : 0.2);

	const window = tile.windows[tile.focusedWindow];
	svg += text(WIDTH / 2, 70, truncate(exeName(window) || "window", 20), 15, TEXT, "middle", "bold");
	if (window?.title) {
		svg += text(WIDTH / 2, 89, truncate(window.title, 32), 10, TEXT_DIM, "middle");
	}
	return svg;
}

export function render(mode: Mode, settings: DialRenderSettings, state: State | undefined, flash?: Direction): string {
	const directions: [Direction, Direction] = settings.axis === "vertical" ? ["up", "down"] : ["left", "right"];
	let body: string;

	const view = state ? workspaceView(state) : undefined;
	if (!state) {
		body = message(mode, "", "komorebi not running");
	} else if (state.is_paused) {
		body = message(mode, "", "paused");
	} else if (!view || view.focusedTile < 0) {
		body = message(mode, "", "empty workspace");
	} else {
		const tile = view.tiles[view.focusedTile];
		const position = `${tile.focusedWindow + 1}/${tile.windows.length}`;
		switch (mode) {
			case "focus":
				body = header(mode, view.monocle ? "monocle" : exeName(tile.windows[tile.focusedWindow])) + minimap(mode, view, directions, flash);
				break;
			case "move":
				body = header(mode, view.monocle ? "monocle" : `${view.focusedTile + 1}/${view.tiles.length}`) + minimap(mode, view, directions, flash);
				break;
			case "stack":
				body = header(mode, tile.windows.length > 1 ? `${position} stacked` : "not stacked") + minimap(mode, view, directions, flash);
				break;
			default:
				body = header(mode, position) + stackStrip(view, flash);
				break;
		}
	}

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
		`<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>${body}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
