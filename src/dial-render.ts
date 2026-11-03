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

// The row of cells: the focused one in the centre, its neighbours either side, and a sliver past each neighbour
// when more lie beyond it
const ROW_Y = 22;
const CELL_W = 52;
const CELL_H = 28;
const GAP = 6;
const SLIVER_W = 4;

interface WindowInfo {
	exe?: string;
	title?: string;
}

interface Container {
	windows: WindowInfo[];
	focusedWindow: number;
}

interface WorkspaceView {
	containers: Container[];
	focused: number; // -1 when the workspace has no tiled windows
	monocle: boolean;
}

/**
 * One cell of the row: a container for the focus, move and stack dials, a window for the cycle stack dial.
 */
interface Cell {
	stacked: number; // windows in the cell, drawn as a layered tile with its count when above 1
}

function readContainer(container: any): Container {
	const elements: any[] = container?.windows?.elements ?? [];
	return {
		windows: elements.map((w) => ({ exe: w?.exe ?? undefined, title: w?.title ?? undefined })),
		focusedWindow: container?.windows?.focused ?? 0,
	};
}

/**
 * The focused workspace of the focused monitor, its containers in komorebi's order.
 */
function workspaceView(state: State): WorkspaceView | undefined {
	const monitor = state.monitors?.elements?.[state.monitors.focused];
	const workspace = monitor?.workspaces?.elements?.[monitor.workspaces.focused];
	if (!monitor || !workspace) {
		return undefined;
	}

	if (workspace.monocle_container) {
		return { containers: [readContainer(workspace.monocle_container)], focused: 0, monocle: true };
	}

	const containers = (workspace.containers?.elements ?? []).map(readContainer);
	return {
		containers,
		focused: containers.length > 0 ? Math.min(workspace.containers.focused ?? 0, containers.length - 1) : -1,
		monocle: false,
	};
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

function header(mode: Mode, info: string): string {
	return text(8, 15, LABELS[mode], 11, ACCENTS[mode], "start", "bold") +
		text(WIDTH - 8, 15, truncate(info, 18), 11, TEXT_DIM, "end");
}

function message(mode: Mode, body: string): string {
	return header(mode, "") + text(WIDTH / 2, 64, body, 13, TEXT_DIM, "middle");
}

function tile(x: number, cell: Cell, fill: string, stroke: string, strokeWidth: number, dashed: boolean): string {
	let svg = "";
	if (cell.stacked > 1) {
		svg += `<rect x="${x + 3}" y="${ROW_Y - 3}" width="${CELL_W}" height="${CELL_H}" rx="4" fill="${TILE_FILL}" stroke="${stroke}" stroke-width="1" opacity="0.6"/>`;
	}
	svg += `<rect x="${x}" y="${ROW_Y}" width="${CELL_W}" height="${CELL_H}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"` +
		(dashed ? ` stroke-dasharray="4,3"` : "") + `/>`;
	if (cell.stacked > 1) {
		svg += text(x + CELL_W / 2, ROW_Y + CELL_H / 2 + 5, String(cell.stacked), 14, TEXT, "middle", "bold");
	}
	return svg;
}

/**
 * The focused cell in the dial's colour, the next cell each side outlined, and past that a sliver with the count of
 * cells further out. The side that was just turned to lights up.
 */
function row(mode: Mode, cells: Cell[], focused: number, flash?: "prev" | "next"): string {
	const accent = ACCENTS[mode];
	const centre = (WIDTH - CELL_W) / 2;
	let svg = tile(centre, cells[focused], accent, accent, 1, false);

	const sides: ["prev" | "next", number, number][] = [
		["prev", focused, centre - GAP - CELL_W],
		["next", cells.length - 1 - focused, centre + CELL_W + GAP],
	];
	for (const [side, count, x] of sides) {
		if (count === 0) {
			continue;
		}
		const neighbour = cells[side === "prev" ? focused - 1 : focused + 1];
		const lit = flash === side;
		svg += tile(x, neighbour, TILE_FILL, lit ? accent : TILE_STROKE, lit ? 2 : 1, !lit);

		const beyond = count - 1;
		if (beyond > 0) {
			const sliverX = side === "prev" ? x - GAP - SLIVER_W : x + CELL_W + GAP;
			svg += `<rect x="${sliverX}" y="${ROW_Y + 4}" width="${SLIVER_W}" height="${CELL_H - 8}" rx="2" fill="${TILE_STROKE}"/>`;
			svg += text(sliverX + SLIVER_W / 2, ROW_Y + CELL_H + 12, `+${beyond}`, 10, TEXT_DIM, "middle", "bold");
		}
	}
	return svg;
}

/**
 * The focused window's app and title, large, under the row.
 */
function caption(window?: WindowInfo): string {
	let svg = text(WIDTH / 2, 80, truncate(exeName(window) || "window", 20), 16, TEXT, "middle", "bold");
	if (window?.title) {
		svg += text(WIDTH / 2, 95, truncate(window.title, 32), 11, TEXT_DIM, "middle");
	}
	return svg;
}

export function render(mode: Mode, settings: DialRenderSettings, state: State | undefined, flash?: Direction): string {
	let body: string;
	const side = flash === "left" || flash === "up" ? "prev" : flash ? "next" : undefined;

	const view = state ? workspaceView(state) : undefined;
	if (!state) {
		body = message(mode, "komorebi not running");
	} else if (state.is_paused) {
		body = message(mode, "paused");
	} else if (!view || view.focused < 0) {
		body = message(mode, "empty workspace");
	} else {
		const container = view.containers[view.focused];
		const window = container.windows[container.focusedWindow];
		const position = `${container.focusedWindow + 1}/${container.windows.length}`;

		if (mode === "cycle") {
			const cells = container.windows.map(() => ({ stacked: 1 }));
			body = header(mode, position) + row(mode, cells, container.focusedWindow, side);
		} else {
			const cells = view.containers.map((c) => ({ stacked: c.windows.length }));
			const info = view.monocle ? "monocle"
				: mode === "stack" ? (container.windows.length > 1 ? `${position} stacked` : "not stacked")
				: `${view.focused + 1}/${view.containers.length}`;
			body = header(mode, info) + row(mode, cells, view.focused, side);
		}
		body += caption(window);
	}

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
		`<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>${body}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
