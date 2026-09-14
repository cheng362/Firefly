import {
	createHash,
	randomBytes,
	scrypt as scryptCallback,
	timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { AdminError } from "./storage.mjs";

const scrypt = promisify(scryptCallback);
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
export async function passwordHash(password) {
	const salt = randomBytes(24).toString("hex");
	const hash = await scrypt(password, salt, 64);
	return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
	if (
		typeof password !== "string" ||
		password.length > 512 ||
		!/^scrypt:[a-f0-9]{48}:[a-f0-9]{128}$/.test(stored)
	)
		return false;
	const [, salt, expected] = stored.split(":");
	return timingSafeEqual(
		await scrypt(password, salt, 64),
		Buffer.from(expected, "hex"),
	);
}

export class Auth {
	constructor({ origin, username, hash }) {
		this.origin = new URL(origin).origin;
		const url = new URL(origin);
		if (
			url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
			)
		)
			throw new Error("ADMIN_ORIGIN 在公网环境必须使用 HTTPS");
		if (!username || !/^scrypt:[a-f0-9]{48}:[a-f0-9]{128}$/.test(hash || ""))
			throw new Error("请先运行 pnpm admin:setup 初始化管理员账号");
		this.username = username;
		this.hash = hash;
		this.secure = url.protocol === "https:";
		this.sessions = new Map();
		this.attempts = new Map();
		this.pendingLogins = 0;
	}
	checkOrigin(request) {
		if (request.headers.origin !== this.origin)
			throw new AdminError(403, "请求来源不匹配，请使用配置的后台网址访问");
	}
	cookie(value, age = 28800) {
		return `firefly_admin=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${this.secure ? "; Secure" : ""}`;
	}
	session(request) {
		const cookie = request.headers.cookie
			?.split(";")
			.map((part) => part.trim())
			.find((part) => part.startsWith("firefly_admin="))
			?.slice(14);
		if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
		const id = tokenHash(cookie);
		const session = this.sessions.get(id);
		if (!session || session.expires <= Date.now()) {
			this.sessions.delete(id);
			return null;
		}
		return { ...session, id };
	}
	require(request, write = false) {
		const session = this.session(request);
		if (!session)
			throw new AdminError(
				401,
				"登录已过期，请重新登录；未保存的内容仍保留在本页",
			);
		if (write) {
			this.checkOrigin(request);
			if (request.headers["x-csrf-token"] !== session.csrf)
				throw new AdminError(403, "安全令牌无效，请重新登录");
		}
		const stored = this.sessions.get(session.id);
		if (!stored.window || stored.window < Date.now() - 60000) {
			stored.window = Date.now();
			stored.requests = 0;
		}
		stored.requests = (stored.requests || 0) + 1;
		if (stored.requests > 600)
			throw new AdminError(429, "操作过于频繁，请稍后再试");
		return session;
	}
	async login(request, username, password) {
		this.checkOrigin(request);
		const now = Date.now();
		for (const [key, entry] of this.attempts)
			if (entry.until < now) this.attempts.delete(key);
		for (const [key, session] of this.sessions)
			if (session.expires < now) this.sessions.delete(key);
		// Use the socket address. Do not trust client-supplied X-Forwarded-For headers.
		const key = request.socket.remoteAddress || "unknown";
		const entry = this.attempts.get(key) || {
			count: 0,
			until: now + 15 * 60 * 1000,
		};
		if (
			entry.count >= 10 ||
			this.attempts.size > 2000 ||
			this.pendingLogins >= 4
		)
			throw new AdminError(
				429,
				"登录尝试过多，请稍后再试（失败次数将在 15 分钟后重置）",
			);
		entry.count++;
		this.attempts.set(key, entry);
		this.pendingLogins++;
		let valid;
		try {
			valid = await verifyPassword(password, this.hash);
		} finally {
			this.pendingLogins--;
		}
		if (username !== this.username || !valid)
			throw new AdminError(401, "用户名或密码不正确");
		this.attempts.delete(key);
		const previous = this.session(request);
		if (previous) this.sessions.delete(previous.id);
		if (this.sessions.size >= 100)
			this.sessions.delete(this.sessions.keys().next().value);
		const token = randomBytes(32).toString("hex");
		const session = {
			username: this.username,
			csrf: randomBytes(32).toString("hex"),
			expires: now + 8 * 60 * 60 * 1000,
		};
		this.sessions.set(tokenHash(token), session);
		return { token, session };
	}
}
