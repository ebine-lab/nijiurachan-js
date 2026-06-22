import { describe, it, expect } from "vitest";
import { parseJukeboxUrl, playbackOffsetSec } from "#js/pure/jukebox";

describe("parseJukeboxUrl — YouTube watch?v=", () => {
	it("parses standard watch URL", () => {
		expect(parseJukeboxUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
			source: "youtube",
			mediaId: "dQw4w9WgXcQ",
		});
	});

	it("ignores extra query params", () => {
		expect(parseJukeboxUrl("https://youtube.com/watch?v=abcdefghijk&t=30")).toEqual({
			source: "youtube",
			mediaId: "abcdefghijk",
		});
	});

	it("returns null when v param is missing", () => {
		expect(parseJukeboxUrl("https://www.youtube.com/watch?list=PLxxx")).toBeNull();
	});

	it("returns null when mediaId is not exactly 11 chars", () => {
		expect(parseJukeboxUrl("https://www.youtube.com/watch?v=short")).toBeNull();
		expect(parseJukeboxUrl("https://www.youtube.com/watch?v=toolongidhere123")).toBeNull();
	});
});

describe("parseJukeboxUrl — YouTube youtu.be short link", () => {
	it("parses youtu.be URL", () => {
		expect(parseJukeboxUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
			source: "youtube",
			mediaId: "dQw4w9WgXcQ",
		});
	});

	it("parses youtu.be with query params", () => {
		expect(parseJukeboxUrl("https://youtu.be/abcdefghijk?t=5")).toEqual({
			source: "youtube",
			mediaId: "abcdefghijk",
		});
	});

	it("returns null when youtu.be path is not exactly 11 chars", () => {
		expect(parseJukeboxUrl("https://youtu.be/short")).toBeNull();
	});
});

describe("parseJukeboxUrl — YouTube shorts/", () => {
	it("parses shorts URL", () => {
		expect(parseJukeboxUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
			source: "youtube",
			mediaId: "dQw4w9WgXcQ",
		});
	});

	it("returns null when shorts ID is wrong length", () => {
		expect(parseJukeboxUrl("https://www.youtube.com/shorts/abc")).toBeNull();
	});
});

describe("parseJukeboxUrl — SoundCloud", () => {
	it("parses soundcloud.com/<user>/<track>", () => {
		expect(parseJukeboxUrl("https://soundcloud.com/artist-name/track-title")).toEqual({
			source: "soundcloud",
			mediaId: "artist-name/track-title",
		});
	});

	it("parses with www prefix", () => {
		expect(parseJukeboxUrl("https://www.soundcloud.com/dj/my-song")).toEqual({
			source: "soundcloud",
			mediaId: "dj/my-song",
		});
	});

	it("returns null for soundcloud root", () => {
		expect(parseJukeboxUrl("https://soundcloud.com/")).toBeNull();
	});

	it("returns null for soundcloud user page only (no track segment)", () => {
		expect(parseJukeboxUrl("https://soundcloud.com/artist")).toBeNull();
	});

	it("returns null for soundcloud deeper nesting", () => {
		expect(parseJukeboxUrl("https://soundcloud.com/artist/track/extra")).toBeNull();
	});
});

describe("parseJukeboxUrl — invalid / unsupported URLs", () => {
	it("returns null for empty string", () => {
		expect(parseJukeboxUrl("")).toBeNull();
	});

	it("returns null for plain text", () => {
		expect(parseJukeboxUrl("not a url")).toBeNull();
	});

	it("returns null for an unrelated URL", () => {
		expect(parseJukeboxUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
	});

	it("returns null for vimeo URL", () => {
		expect(parseJukeboxUrl("https://vimeo.com/123456789")).toBeNull();
	});
});

describe("playbackOffsetSec", () => {
	it("returns 0 when serverNow is before startedAt (clamp)", () => {
		expect(playbackOffsetSec(1_000_000, 999_000)).toBe(0);
	});

	it("returns correct offset in seconds", () => {
		expect(playbackOffsetSec(1_000_000, 1_005_000)).toBe(5);
	});

	it("returns fractional seconds", () => {
		expect(playbackOffsetSec(1_000_000, 1_002_500)).toBe(2.5);
	});

	it("clamps to 0 when times are equal", () => {
		expect(playbackOffsetSec(1_000_000, 1_000_000)).toBe(0);
	});
});
