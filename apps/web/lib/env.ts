/** Reads a required environment variable or throws. Never logs the value. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** Fails closed if STELLAR_NETWORK is ever anything but "testnet" (build-prompt.md hard rule). */
export function testnetPassphrase(): string {
  const network = process.env.STELLAR_NETWORK;
  if (network !== "testnet") {
    throw new Error(`STELLAR_NETWORK must be "testnet", got ${JSON.stringify(network)}`);
  }
  return "Test SDF Network ; September 2015";
}
