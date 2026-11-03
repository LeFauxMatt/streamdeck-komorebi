import { action, DialAction, DialDownEvent, DialRotateEvent, DidReceiveSettingsEvent, SingletonAction, TouchTapEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { DataBroadcastManager, DataSubscriber } from "../data-subscriber";
import { Notification, State } from "../komorebi-notifications";
import { Direction, Mode, render } from "../dial-render";
import { spawn } from "child_process";
import { parse, ParseEntry } from "shell-quote";

const FLASH_DURATION = 350; // how long the turned direction's arrow stays lit, in milliseconds
const MAX_TICKS = 5; // most commands sent for one fast turn

/**
 * Settings for the window dials.
 */
type WindowDialSettings = {
	axis?: "horizontal" | "vertical";
	pressArguments?: string;
};

interface DialInstance {
	action: DialAction<WindowDialSettings>;
	settings: WindowDialSettings;
	flash?: { direction: Direction; until: number };
	flashTimer?: NodeJS.Timeout;
	lastImage?: string;
}

function runKomorebic(args: string[]): Promise<void> {
	return new Promise((resolve) => {
		const child = spawn("komorebic", args);
		child.on("close", () => resolve());
		child.on("error", () => resolve());
	});
}

/**
 * A dial that sends a komorebic command each way when turned and draws the focused workspace on the touch strip.
 */
abstract class WindowDial extends SingletonAction<WindowDialSettings> implements DataSubscriber {
	private instances = new Map<string, DialInstance>();
	private state?: State;
	private queue: Promise<void> = Promise.resolve();

	protected abstract readonly mode: Mode;
	protected readonly defaultPressArguments: string = "";

	constructor(broadcastManager: DataBroadcastManager) {
		super();
		broadcastManager.subscribe(this);
	}

	/**
	 * The komorebic arguments for one tick of a turn.
	 */
	protected abstract command(direction: Direction): string[];

	onData(data: Notification): void {
		// `komorebic state` at subscribe returns the state itself; the pipe wraps it in a notification
		this.state = (data?.state ?? data) as State;
		this.instances.forEach((instance) => this.draw(instance));
	}

	onDisconnect(): void {
		this.state = undefined;
		this.instances.forEach((instance) => this.draw(instance));
	}

	private draw(instance: DialInstance): void {
		const flash = instance.flash && instance.flash.until > Date.now() ? instance.flash.direction : undefined;
		const image = render(this.mode, instance.settings, this.state, flash);
		if (image !== instance.lastImage) {
			instance.lastImage = image;
			instance.action.setFeedback({ canvas: image });
		}
	}

	private enqueue(args: string[]): void {
		this.queue = this.queue.then(() => runKomorebic(args));
	}

	private runPress(settings: WindowDialSettings): void {
		const press = settings.pressArguments ?? this.defaultPressArguments;
		if (press.trim()) {
			this.enqueue(parse(press).map((entry: ParseEntry) => entry.toString()));
		}
	}

	override onWillAppear(ev: WillAppearEvent<WindowDialSettings>): void {
		if (!ev.action.isDial()) {
			return;
		}
		const instance: DialInstance = { action: ev.action, settings: ev.payload.settings };
		this.instances.set(ev.action.id, instance);
		this.draw(instance);
	}

	override onWillDisappear(ev: WillDisappearEvent<WindowDialSettings>): void {
		clearTimeout(this.instances.get(ev.action.id)?.flashTimer);
		this.instances.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<WindowDialSettings>): void {
		const instance = this.instances.get(ev.action.id);
		if (instance) {
			instance.settings = ev.payload.settings;
			instance.lastImage = undefined;
			this.draw(instance);
		}
	}

	override onDialRotate(ev: DialRotateEvent<WindowDialSettings>): void {
		const vertical = this.mode !== "cycle" && ev.payload.settings.axis === "vertical";
		const direction: Direction = ev.payload.ticks < 0 ? (vertical ? "up" : "left") : (vertical ? "down" : "right");
		const ticks = Math.min(Math.abs(ev.payload.ticks), MAX_TICKS);
		for (let i = 0; i < ticks; i++) {
			this.enqueue(this.command(direction));
		}

		const instance = this.instances.get(ev.action.id);
		if (instance) {
			instance.flash = { direction, until: Date.now() + FLASH_DURATION };
			this.draw(instance);
			clearTimeout(instance.flashTimer);
			instance.flashTimer = setTimeout(() => this.draw(instance), FLASH_DURATION + 10);
		}
	}

	override onDialDown(ev: DialDownEvent<WindowDialSettings>): void {
		this.runPress(ev.payload.settings);
	}

	override onTouchTap(ev: TouchTapEvent<WindowDialSettings>): void {
		this.runPress(ev.payload.settings);
	}
}

@action({ UUID: "com.kdeenanauth.komorebi.focusdial" })
export class FocusDial extends WindowDial {
	protected override readonly mode = "focus";

	protected override command(direction: Direction): string[] {
		return ["focus", direction];
	}
}

@action({ UUID: "com.kdeenanauth.komorebi.movedial" })
export class MoveDial extends WindowDial {
	protected override readonly mode = "move";

	protected override command(direction: Direction): string[] {
		return ["move", direction];
	}
}

@action({ UUID: "com.kdeenanauth.komorebi.stackdial" })
export class StackDial extends WindowDial {
	protected override readonly mode = "stack";
	protected override readonly defaultPressArguments = "unstack";

	protected override command(direction: Direction): string[] {
		return ["stack", direction];
	}
}

@action({ UUID: "com.kdeenanauth.komorebi.cyclestackdial" })
export class CycleStackDial extends WindowDial {
	protected override readonly mode = "cycle";

	protected override command(direction: Direction): string[] {
		return ["cycle-stack", direction === "left" || direction === "up" ? "previous" : "next"];
	}
}
