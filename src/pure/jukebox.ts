// src/pure/jukebox.ts

export type JukeboxSource = "youtube" | "soundcloud";

export interface JukeboxQueueItem {
	source: JukeboxSource;
	mediaId: string;
	title: string | null;
	durationSec: number;
	mine: boolean;
}

export interface JukeboxNowPlaying extends JukeboxQueueItem {
	startedAtMs: number;
	isReplay: boolean;
}

export interface JukeboxState {
	nowPlaying: JukeboxNowPlaying | null;
	serverNowMs: number;
	queue: JukeboxQueueItem[];
	listeners: number;
	mySkipVoted: boolean;
	enqueueCooldownRemainingSec: number;
}

export interface ParsedJukeboxMedia {
	source: JukeboxSource;
	mediaId: string;
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseYouTube(url: URL): ParsedJukeboxMedia | null {
	const host = url.hostname.replace(/^www\./, "");
	if (host !== "youtube.com") return null;
	if (url.pathname !== "/watch") return null;
	const v = url.searchParams.get("v");
	if (!v || !YT_ID_RE.test(v)) return null;
	return { source: "youtube", mediaId: v };
}

function parseYouTubeShort(url: URL): ParsedJukeboxMedia | null {
	const host = url.hostname.replace(/^www\./, "");

	// youtu.be/<ID>
	if (host === "youtu.be") {
		const id = url.pathname.slice(1); // remove leading /
		if (!YT_ID_RE.test(id)) return null;
		return { source: "youtube", mediaId: id };
	}

	// youtube.com/shorts/<ID>
	if (host === "youtube.com") {
		const match = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})$/);
		if (!match) return null;
		return { source: "youtube", mediaId: match[1] };
	}

	return null;
}

function parseSoundCloud(url: URL): ParsedJukeboxMedia | null {
	const host = url.hostname.replace(/^www\./, "");
	if (host !== "soundcloud.com") return null;
	// pathname must be exactly /<user>/<track> — two segments, no trailing slash
	const match = url.pathname.match(/^\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	return { source: "soundcloud", mediaId: `${match[1]}/${match[2]}` };
}

export function parseJukeboxUrl(rawUrl: string): ParsedJukeboxMedia | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	return parseYouTube(url) ?? parseYouTubeShort(url) ?? parseSoundCloud(url);
}

export function playbackOffsetSec(startedAtMs: number, serverNowMs: number): number {
	return Math.max(0, (serverNowMs - startedAtMs) / 1000);
}
