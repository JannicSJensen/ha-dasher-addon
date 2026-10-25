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
  "f6157a89f3bb1361186ee73cab6ec4c572e2013dcb5c713649e48fe8c7f3f0ee",
  "ee4cce217f53d9a4c6349b24b6b0b18525c3b6dbe48e89c74c14cf90e0e1e80c",
  "37aa2c45797f0d62d3641f3ee9f9bb1ba68639fb69a5be2d49b49ec7a477fd38",
  "7723faf6a427ef82e65fd652fd6c119851277317e8fec0f240aa69b5805de955",
  "16670955251ed9004dde6ff1ed891fee7291e1a0e74662c7fd77434a338d5abc",
  "7516b1559565dc2bbd86720db427a1c495af477c73137ea16ce2057cc5dff5fa",
  "6644bce0f678d95ebcf57e84cda57f6efd8ee10a7013f4fe858788fff4906586",
  "29523f49bd08b105fd46e0b59b5c16fe3952a6fa5fbef877d4048d2ccd9c9dea",
  "314ce520991555101ce5463b4eb987af6fad5cdb48f2bc345b2cb51e4a793a18",
  "2a8c6839cd8b47b4de1534ed0af5b63e728cd109684bcf165e3f825756cc8d7f",
  "06dea32d88390d94ff1a44c9d99a5de783d025ed3cfeaed1e3e19cea9b9ae184",
  "a58546d7781f5639ae55a8896eddea2745e7c0e08d6aa257f6ca5d8f173cb7ce",
]);

export const hashDashboard = (text) => crypto.createHash("sha256").update(String(text).replace(/\r/g, "")).digest("hex");
