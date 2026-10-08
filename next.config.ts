import type { NextConfig } from "next";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";

function localDevOrigins(): string[] {
  const hosts = Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
    .filter(({ address, family, internal }) => {
      if (internal || family !== "IPv4" || !isIPv4(address)) return false;
      const [first, second] = address.split(".").map(Number);
      return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
    })
    .map(({ address }) => address);
  return [...new Set(hosts)].sort();
}

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Exact private interface hosts only; reload the dev server after changing networks.
  allowedDevOrigins: localDevOrigins(),
};
export default config;
