// src/io/jukebox-api.ts
import type { JukeboxState } from "#js/pure/jukebox";

export interface JukeboxClientOptions {
	baseUrl: string;
}

export class HttpError extends Error {
	status: number;
	constructor(status: number) {
		super(`HTTP ${status}`);
		this.status = status;
	}
}

async function throwIfNotOk(res: Response): Promise<void> {
	if (!res.ok) throw new HttpError(res.status);
}

export interface JukeboxClient {
	getState(): Promise<JukeboxState>;
	postPresence(): Promise<void>;
	enqueue(url: string): Promise<void>;
	cancelMine(): Promise<void>;
	skipVote(): Promise<{ skipped: boolean }>;
}

export function createJukeboxClient({ baseUrl }: JukeboxClientOptions): JukeboxClient {
	return {
		async getState(): Promise<JukeboxState> {
			const res = await fetch(`${baseUrl}/api/state`, {
				method: "GET",
				credentials: "omit",
			});
			await throwIfNotOk(res);
			return res.json() as Promise<JukeboxState>;
		},

		async postPresence(): Promise<void> {
			const res = await fetch(`${baseUrl}/api/presence`, {
				method: "POST",
				credentials: "omit",
			});
			await throwIfNotOk(res);
		},

		async enqueue(url: string): Promise<void> {
			const res = await fetch(`${baseUrl}/api/queue`, {
				method: "POST",
				credentials: "omit",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url }),
			});
			await throwIfNotOk(res);
		},

		async cancelMine(): Promise<void> {
			const res = await fetch(`${baseUrl}/api/queue/mine`, {
				method: "DELETE",
				credentials: "omit",
			});
			await throwIfNotOk(res);
		},

		async skipVote(): Promise<{ skipped: boolean }> {
			const res = await fetch(`${baseUrl}/api/skip/vote`, {
				method: "POST",
				credentials: "omit",
			});
			await throwIfNotOk(res);
			return res.json() as Promise<{ skipped: boolean }>;
		},
	};
}
