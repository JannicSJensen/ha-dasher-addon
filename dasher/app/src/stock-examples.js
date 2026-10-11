import crypto from "node:crypto";

/**
 * SHA-256 of every example dashboard.yaml this app has shipped (line endings normalised).
 * A dashboard.yaml that is still byte-for-byte one of these was never edited, so it is safe to
 * replace with the current example when the app is updated. Add the hash of a new example here
 * whenever examples/dashboard.yaml changes (the test in test/config.test.js prints it).
 */
export const STOCK_EXAMPLE_HASHES = new Set([
  "a14ba9108c59990e971b1716e4f8d6546ca3e905b020958f2e35c864fa7c8024",
  "b4818ff3725271317acf1b355b4cdb3a93b4d85e04824fcc68a8f6fad92c224d",
  "f3c5bc6a594b04324ff56ee9d1685853434695eb63a5a7a9a90a4d8833d43db2",
  "58b7a751191155281da76f00c9cdc3053afb324b1168c0adf5c6216968385cc7",
  "19203d9a0252ae7163ff2e0ccbc7938180354265a8d0ba51b9d10ed1e38cf83f",
  "a0b42fa43a44fa723c4d1a4436f98dd9cd8822ca9e7ce9e01d61138c776a8a5f",
]);

export const hashDashboard = (text) => crypto.createHash("sha256").update(String(text).replace(/\r/g, "")).digest("hex");
