import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { AdminError, safePath } from "./storage.mjs";

export class Publisher {
	constructor(store, runner) {
		this.store = store;
		this.runner = runner || this.run.bind(this);
		this.status = { phase: "idle", log: "", startedAt: null, finishedAt: null };
	}
	snapshot() {
		return {
			...this.status,
			version: this.store.state.version,
			active: this.store.state.active || null,
			previous: this.store.state.previous || null,
			dirty: this.store.state.version !== this.store.state.active?.version,
		};
	}
	append(text) {
		this.status.log = (this.status.log + stripVTControlCharacters(text)).slice(
			-64000,
		);
	}
	run(command, env) {
		return new Promise((resolve, reject) => {
			const cli = process.env.npm_execpath;
			const child =
				cli?.endsWith(".cjs") || cli?.endsWith(".js")
					? spawn(process.execPath, [cli, command], {
							cwd: this.store.root,
							env,
							windowsHide: true,
						})
					: spawn("pnpm", [command], {
							cwd: this.store.root,
							env,
							windowsHide: true,
							shell: process.platform === "win32",
						});
			this.child = child;
			child.stdout.on("data", (chunk) => this.append(chunk.toString()));
			child.stderr.on("data", (chunk) => this.append(chunk.toString()));
			child.on("error", reject);
			child.on("close", (code) => {
				this.child = null;
				code === 0
					? resolve()
					: reject(new Error(`${command} 失败（退出码 ${code}）`));
			});
		});
	}
	async start() {
		if (this.store.busy) throw new AdminError(409, "已有发布任务正在运行");
		if (process.env.CF_WORKERS)
			throw new AdminError(
				400,
				"Linux 后台发布不使用 CF_WORKERS，请移除此环境变量后重启",
			);
		this.store.busy = true;
		this.status = {
			phase: "running",
			log: "",
			startedAt: new Date().toISOString(),
			finishedAt: null,
		};
		this.task = this.publish();
		return this.snapshot();
	}
	async publish() {
		try {
			const id = `${Date.now()}-${randomUUID()}`;
			const relative = `.firefly-admin/releases/${id}`;
			const directory = await safePath(this.store.root, relative);
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const env = {
				...process.env,
				FIREFLY_OUT_DIR: directory,
				NODE_ENV: "production",
			};
			// Credentials are not needed by the site compiler or its plugins.
			for (const key of Object.keys(env))
				if (key.startsWith("ADMIN_")) delete env[key];
			for (const command of ["check", "type-check", "build"]) {
				this.append(`\n▶ ${command}\n`);
				await this.runner(command, env);
			}
			await access(path.join(directory, "index.html"));
			const previousState = { ...this.store.state };
			this.store.state.previous = this.store.state.active || null;
			this.store.state.active = {
				directory: relative,
				version: this.store.state.version,
				at: new Date().toISOString(),
			};
			try {
				await this.store.saveState();
			} catch (error) {
				this.store.state = previousState;
				throw error;
			}
			this.status.phase = "success";
			this.append("\n发布成功，网站已切换至新版本。\n");
		} catch (error) {
			this.status.phase = "failed";
			this.append(`\n发布未完成：${error.message}。线上版本保持不变。\n`);
		} finally {
			this.status.finishedAt = new Date().toISOString();
			this.store.busy = false;
		}
	}
	async rollback() {
		if (this.store.busy) throw new AdminError(409, "发布中不能回退");
		const previous = this.store.state.previous;
		if (!previous) throw new AdminError(400, "暂无可以回退的发布版本");
		await access(
			path.join(
				await safePath(this.store.root, previous.directory),
				"index.html",
			),
		);
		const old = { ...this.store.state };
		this.store.state.previous = this.store.state.active;
		this.store.state.active = previous;
		try {
			await this.store.saveState();
		} catch (error) {
			this.store.state = old;
			throw error;
		}
		return this.snapshot();
	}
}
