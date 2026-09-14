import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { passwordHash } from "./auth.mjs";

const password = randomBytes(24).toString("base64url");
const hash = await passwordHash(password);
try {
	await writeFile(
		".env.admin",
		`# 仅供后台服务读取，不要提交到 Git\nADMIN_USERNAME=admin\nADMIN_PASSWORD_HASH=${hash}\nADMIN_HOST=127.0.0.1\nADMIN_PORT=4322\nADMIN_ORIGIN=http://localhost:4322\n`,
		{ flag: "wx", mode: 0o600 },
	);
	console.log(
		`管理员配置已写入 .env.admin\n用户名：admin\n初始密码：${password}\n请立即保存此密码。公网部署前将 ADMIN_ORIGIN 改为实际 HTTPS 域名。\n运行 pnpm admin 后访问 http://localhost:4322/admin/`,
	);
} catch (error) {
	if (error.code === "EEXIST")
		console.error(
			".env.admin 已存在，未覆盖原账号。重置密码请备份并移走该文件后重新初始化。",
		);
	else console.error("初始化失败：", error.message);
	process.exitCode = 1;
}
