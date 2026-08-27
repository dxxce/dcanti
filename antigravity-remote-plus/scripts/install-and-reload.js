#!/usr/bin/env node
// Automatically install the packaged .vsix into Antigravity IDE and reload all IDE windows.

const { execSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const vsixPath = path.resolve(__dirname, "..", "antigravity-remote-plus.vsix");

if (!fs.existsSync(vsixPath)) {
  console.error(`[deploy] Error: VSIX not found at ${vsixPath}`);
  process.exit(1);
}

function findCliPath() {
  const candidates = [
    "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
    path.join(os.homedir(), "Applications", "Antigravity IDE.app", "Contents", "Resources", "app", "bin", "antigravity-ide"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd") : "",
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    const which = execSync("which antigravity-ide || which antigravity || which code", { stdio: "pipe" }).toString().trim();
    if (which) return which;
  } catch {}

  return "antigravity-ide";
}

function getSettings() {
  const possiblePaths = [
    path.join(os.homedir(), "Library", "Application Support", "Antigravity", "User", "settings.json"),
    path.join(os.homedir(), "Library", "Application Support", "Antigravity IDE", "User", "settings.json"),
    path.join(os.homedir(), ".config", "Antigravity", "User", "settings.json"),
    path.join(os.homedir(), ".config", "Antigravity IDE", "User", "settings.json"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "Antigravity", "User", "settings.json") : "",
  ].filter(Boolean);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        return {
          port: data["antigravityRemotePlus.port"] || 7377,
          password: data["antigravityRemotePlus.password"] || "",
        };
      } catch {}
    }
  }
  return { port: 7377, password: "" };
}

async function request(port, path, method = "GET", headers = {}, body = null) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers,
        timeout: 2500,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data || "{}"), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, data, headers: res.headers });
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    if (body) req.write(body);
    req.end();
  });
}

async function reloadViaHttp() {
  const { port, password } = getSettings();

  // Try direct localhost reload first
  let reloadRes = await request(port, "/api/reload-window", "POST", {
    "Content-Type": "application/json",
    "Host": `127.0.0.1:${port}`,
  }, "{}");

  if (reloadRes && reloadRes.status === 200) {
    return true;
  }

  // If unauthorized, login first with password from settings.json
  if (password) {
    const loginRes = await request(port, "/api/login", "POST", {
      "Content-Type": "application/json",
      "Host": `127.0.0.1:${port}`,
    }, JSON.stringify({ password }));

    if (loginRes && loginRes.status === 200) {
      const cookie = loginRes.headers["set-cookie"]?.[0]?.split(";")?.[0] || "";
      reloadRes = await request(port, "/api/reload-window", "POST", {
        "Content-Type": "application/json",
        "Host": `127.0.0.1:${port}`,
        "Cookie": cookie,
      }, "{}");
      if (reloadRes && reloadRes.status === 200) return true;
    }
  }

  return false;
}

function reloadViaAppleScript() {
  if (process.platform !== "darwin") return false;
  try {
    const cmd = `osascript -e "tell application \\"Antigravity IDE\\" to activate" -e "tell application \\"System Events\\" to tell process \\"Antigravity IDE\\"" -e "click menu item \\"Show All Commands\\" of menu \\"Help\\" of menu bar item \\"Help\\" of menu bar 1" -e "delay 0.3" -e "keystroke \\"Developer: Reload Window\\"" -e "delay 0.2" -e "key code 36" -e "end tell"`;
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`[deploy] Installing ${path.basename(vsixPath)} into Antigravity IDE…`);
  const cli = findCliPath();

  try {
    const cmd = `"${cli}" --install-extension "${vsixPath}" --force`;
    console.log(`[deploy] Running: ${cmd}`);
    const out = execSync(cmd, { stdio: "pipe" }).toString();
    console.log(out.trim());
    console.log("[deploy] Extension installed successfully.");
  } catch (e) {
    console.error(`[deploy] Installation error: ${e.message}`);
  }

  console.log("[deploy] Reloading Antigravity IDE window(s)…");
  const httpReload = await reloadViaHttp();
  if (httpReload) {
    console.log("[deploy] Reload triggered successfully via Remote Plus API.");
  } else {
    const asReload = reloadViaAppleScript();
    if (asReload) {
      console.log("[deploy] Reload triggered successfully via Antigravity command palette.");
    } else {
      console.log("[deploy] Please reload your Antigravity IDE window (Cmd+R or Developer: Reload Window).");
    }
  }
}

main().catch(console.error);
