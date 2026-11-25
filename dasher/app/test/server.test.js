import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("standard dashboard and assets remain available after removing legacy routes and settings", { timeout: 20_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dasher-server-"));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const optionsFile = path.join(dir, "options.json");
  await fs.writeFile(optionsFile, JSON.stringify({
    read_only: true, legacy_photos: true, legacy_cameras: true, legacy_faces: ["home"],
  }));
  const env = {
    ...process.env, HA_URL: "http://127.0.0.1:1", HA_TOKEN: "test", PORT: "0", LOG_LEVEL: "info",
    OPTIONS_FILE: optionsFile, CONFIG_DIR: path.join(dir, "config"), DATA_DIR: path.join(dir, "data"),
    MA_URL: "", MA_TOKEN: "", NO_OFFERS: "1",
  };
  delete env.SUPERVISOR_TOKEN;
  child = spawn(process.execPath, ["src/index.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error(`Server startup timed out: ${output}`)), 10_000);
    const finish = (error, port) => {
      clearTimeout(timer);
      child.off("error", failed);
      child.off("exit", exited);
      child.stdout.off("data", collect);
      child.stderr.off("data", collect);
      if (error) reject(error);
      else resolve(`http://127.0.0.1:${port}`);
    };
    const failed = (error) => finish(error);
    const exited = (code) => finish(new Error(`Server exited (${code}): ${output}`));
    const collect = (chunk) => {
      output += chunk;
      const match = output.match(/listening on :(\d+)/);
      if (match) finish(null, match[1]);
    };
    child.on("error", failed);
    child.on("exit", exited);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  });

  const home = await fetch(url + "/", { redirect: "manual" });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /src="js\/app.js"/);
  for (const route of ["/js/app.js", "/css/base.css", "/icons/lightbulb.svg"]) {
    assert.equal((await fetch(url + route)).status, 200, route);
  }
  const config = await (await fetch(url + "/api/config")).json();
  assert.ok(config.config.pages.length);
  assert.equal(Object.hasOwn(config, "legacy"), false);

  for (const method of ["GET", "HEAD"]) {
    for (const route of [
      "/legacy", "/legacy/", "/legacy/index.html", "/legacy/legacy.js", "/legacy/legacy.css",
      "/api/legacy/photos", "/api/legacy/photo?album=all&name=test.jpg",
      "/api/legacy/cameras", "/api/legacy/camera?entity=camera.front_door",
    ]) {
      assert.equal((await fetch(url + route, { method, redirect: "manual" })).status, 404, `${method} ${route}`);
    }
  }
  await fs.writeFile(path.join(dir, "config", "assets", "kept.txt"), "Existing asset");
  assert.equal(await (await fetch(url + "/assets/kept.txt")).text(), "Existing asset");
  assert.equal((await fetch(url + "/api/proxy?path=invalid")).status, 400);
  const command = await fetch(url + "/api/service", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: "light", service: "toggle", entity_id: "light.living_room_lamp", data: {} }),
  });
  assert.equal(command.status, 403);
});
