import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema } from "next/dist/server/config-schema";
import { blockCrossSiteDEV } from "next/dist/server/lib/router-utils/block-cross-site-dev";
import type { NextConfig } from "next";

vi.mock("node:os", async original => ({ ...await original<typeof import("node:os")>(), networkInterfaces: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` };
}
async function configFor(interfaces: ReturnType<typeof networkInterfaces>) {
  vi.resetModules(); vi.mocked(networkInterfaces).mockReturnValue(interfaces);
  return (await import("../../next.config")).default;
}
function devRequest(config: NextConfig, url: string, headers: IncomingMessage["headers"]) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = new IncomingMessage(new Socket()); request.url = url; request.headers = headers;
  const response = new ServerResponse(request); const end = vi.spyOn(response, "end").mockReturnValue(response);
  const blocked = blockCrossSiteDEV(request, response, config.allowedDevOrigins, "0.0.0.0");
  request.socket.destroy();
  return { blocked, status: response.statusCode, end };
}

describe("local network development origins", () => {
  it("applies exact RFC1918 interface hosts to valid Next configuration", async () => {
    const hosts = ["10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.255.254"];
    const config = await configFor({ en0: hosts.map(host => ipv4(host)) });
    expect(config.allowedDevOrigins).toEqual(hosts.toSorted());
    expect(config.poweredByHeader).toBe(false); expect(config.agentRules).toBe(false);
    expect(configSchema.safeParse(config).success).toBe(true);
  });
  it("excludes public, loopback, link-local, shared, IPv6 and malformed interface addresses", async () => {
    const denied = ["9.255.255.255", "11.0.0.1", "172.15.255.255", "172.32.0.1", "192.167.255.255", "192.169.0.1", "127.0.0.1", "0.0.0.0", "169.254.1.2", "100.64.0.1", "8.8.8.8", "203.0.113.20", "192.168.1.*", "192.168.1.999", "192.168.1.2.example.com", "192.168.1.2:3000"];
    const config = await configFor({
      en0: [...denied.map(host => ipv4(host)), ipv4("192.168.1.1", true)],
      en1: [{ address: "::ffff:192.168.45.202", family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: null, scopeid: 0 }],
    });
    expect(config.allowedDevOrigins).toEqual([]);
  });
  it("deduplicates interfaces and tolerates missing or empty interface lists", async () => {
    const config = await configFor({ en0: [ipv4("192.168.45.202")], bridge0: [ipv4("192.168.45.202")], missing: undefined, empty: [] });
    expect(config.allowedDevOrigins).toEqual(["192.168.45.202"]);
    expect((await configFor({})).allowedDevOrigins).toEqual([]);
  });
  it("uses the current interface addresses when configuration reloads after a network change", async () => {
    expect((await configFor({ en0: [ipv4("192.168.45.202")] })).allowedDevOrigins).toEqual(["192.168.45.202"]);
    expect((await configFor({ en0: [ipv4("10.0.0.42")] })).allowedDevOrigins).toEqual(["10.0.0.42"]);
  });
  it("lets Next's actual HMR guard accept the LAN host while retaining its other-origin block", async () => {
    const config = await configFor({ en0: [ipv4("192.168.45.202"), ipv4("8.8.8.8")] });
    for (const origin of ["http://192.168.45.202:3000", "http://localhost:3000"]) {
      const result = devRequest(config, "/_next/hmr", { origin });
      expect(result.blocked).toBe(false); expect(result.end).not.toHaveBeenCalled();
    }
    for (const origin of ["http://192.168.45.203:3000", "http://8.8.8.8:3000", "https://192.168.45.202.example.com", "https://external.example.com", "null"]) {
      const result = devRequest(config, "/_next/hmr", { origin });
      expect(result.blocked).toBe(true); expect(result.status).toBe(403); expect(result.end).toHaveBeenCalledWith("Unauthorized");
    }
  });
  it("applies the same exact allowlist to cross-site development script referers", async () => {
    const config = await configFor({ en0: [ipv4("192.168.45.202")] });
    const headers = { "sec-fetch-mode": "no-cors", "sec-fetch-site": "cross-site" };
    expect(devRequest(config, "/_next/static/chunks/app.js", { ...headers, referer: "http://192.168.45.202:3000/" }).blocked).toBe(false);
    expect(devRequest(config, "/_next/static/chunks/app.js", { ...headers, referer: "http://192.168.45.203:3000/" }).blocked).toBe(true);
    expect(devRequest(config, "/_next/static/chunks/app.js", headers).blocked).toBe(true);
  });
});
