import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_CERTIFICATES, localAddresses, nextHttpsArguments, prepareHttps } from "../../scripts/local-https.mjs";

const fixtures: string[] = [];
function fixture() {
  mkdirSync(LOCAL_CERTIFICATES, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(LOCAL_CERTIFICATES, "test-"));
  fixtures.push(directory);
  return directory;
}
function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null };
}
function prepare(directory: string, address = "192.168.45.202") {
  return prepareHttps({ directory, interfaces: { en0: [ipv4(address)] } });
}
afterEach(() => { for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("local HTTPS preparation", () => {
  it("includes only distinct, current non-internal RFC1918 IPv4 addresses", () => {
    const allowed = ["10.0.0.2", "172.16.0.1", "172.31.255.254", "192.168.45.202"];
    const rejected = ["8.8.8.8", "127.0.0.1", "172.15.1.1", "172.32.1.1", "100.64.1.1", "169.254.1.1", "192.168.1.*", "192.168.1.256", "192.168.1.2.example.com"];
    expect(localAddresses({ en0: [...allowed, ...rejected, allowed[0]].map(value => ipv4(value)), lo: [ipv4("10.0.0.1", true)], absent: undefined })).toEqual(allowed.toSorted());
    expect(localAddresses({})).toEqual([]);
  });

  it("generates a verifiable CA and localhost/current-IP server certificate with private keys", () => {
    const paths = prepare(fixture());
    const certificate = new X509Certificate(readFileSync(paths.cert));
    expect(certificate.subjectAltName).toBe("DNS:localhost, IP Address:192.168.45.202");
    for (const verification of [["-verify_hostname", "localhost"], ["-verify_ip", "192.168.45.202"]]) {
      expect(() => execFileSync("openssl", ["verify", "-purpose", "sslserver", "-CAfile", paths.ca, ...verification, paths.cert], { stdio: "pipe" })).not.toThrow();
    }
    expect(spawnSync("openssl", ["verify", "-CAfile", paths.ca, "-verify_ip", "192.168.45.203", paths.cert]).status).not.toBe(0);
    for (const key of [paths.key, paths.caKey]) expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(statSync(paths.directory).mode & 0o777).toBe(0o700);
    expect(execFileSync("git", ["-c", "core.quotePath=false", "check-ignore", paths.key], { encoding: "utf8" }).trim()).toBe(paths.key);
  }, 20_000);

  it("reuses the CA and server key, and replaces only the certificate when current IP changes", () => {
    const directory = fixture();
    const first = prepare(directory);
    const originals = { ca: readFileSync(first.ca), caKey: readFileSync(first.caKey), cert: readFileSync(first.cert), key: readFileSync(first.key) };
    expect(prepare(directory).renewed).toBe(false);
    expect(readFileSync(first.cert)).toEqual(originals.cert);
    const changed = prepare(directory, "10.0.0.42");
    expect(changed.renewed).toBe(true);
    expect(readFileSync(changed.ca)).toEqual(originals.ca);
    expect(readFileSync(changed.caKey)).toEqual(originals.caKey);
    expect(readFileSync(changed.key)).toEqual(originals.key);
    expect(readFileSync(changed.cert)).not.toEqual(originals.cert);
    expect(new X509Certificate(readFileSync(changed.cert)).subjectAltName).toBe("DNS:localhost, IP Address:10.0.0.42");
  }, 20_000);

  it("refuses paths outside the private certificate directory before writing anything", () => {
    expect(() => prepareHttps({ directory: "/tmp/recycle-https-outside" })).toThrow(/인증서 폴더/);
  });

  it("refuses a linked destination and leaves the other directory untouched", () => {
    const directory = fixture();
    const target = join(directory, "untouched"); mkdirSync(target, { mode: 0o700 });
    const link = join(directory, "linked"); symlinkSync(target, link);
    expect(() => prepare(link)).toThrow(/심볼릭 링크/);
    expect(readdirSync(target)).toEqual([]);
  });

  it("refuses unsafe permissions and linked keys instead of changing or overwriting them", () => {
    const directory = fixture(); const paths = prepare(directory);
    const original = readFileSync(paths.caKey);
    chmodSync(paths.caKey, 0o644);
    expect(() => prepare(directory)).toThrow(/권한/);
    expect(statSync(paths.caKey).mode & 0o777).toBe(0o644);
    expect(readFileSync(paths.caKey)).toEqual(original);
    chmodSync(paths.caKey, 0o600);
    const target = join(directory, "untouched.pem"); writeFileSync(target, "unchanged", { mode: 0o600 });
    rmSync(paths.key); symlinkSync(target, paths.key);
    expect(() => prepare(directory)).toThrow(/심볼릭 링크/);
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  }, 20_000);

  it("rejects incomplete and corrupted existing material and preserves the original CA", () => {
    const directory = fixture(); const paths = prepare(directory);
    const originalCA = readFileSync(paths.ca);
    writeFileSync(paths.cert, "invalid certificate");
    expect(() => prepare(directory)).toThrow(/인증서/);
    expect(readFileSync(paths.cert, "utf8")).toBe("invalid certificate");
    expect(readFileSync(paths.ca)).toEqual(originalCA);
    rmSync(paths.cert);
    expect(() => prepare(directory)).toThrow(/불완전/);
    expect(existsSync(paths.cert)).toBe(false);
  }, 20_000);

  it("keeps valid files and releases its lock when OpenSSL renewal fails", () => {
    const directory = fixture(); const paths = prepare(directory);
    const originals = [paths.ca, paths.caKey, paths.cert, paths.key].map(file => readFileSync(file));
    const failingCommand = join(directory, "failing-openssl");
    writeFileSync(failingCommand, '#!/bin/sh\nif [ "$1" = version ]; then printf "OpenSSL 3.6.4\\n"; exit 0; fi\necho "provider error must not escape" >&2\nexit 17\n', { mode: 0o700 });
    expect(() => prepareHttps({ directory, interfaces: { en0: [ipv4("10.0.0.42")] }, openssl: failingCommand })).toThrow(/^OpenSSL/);
    expect([paths.ca, paths.caKey, paths.cert, paths.key].map(file => readFileSync(file))).toEqual(originals);
    expect(readdirSync(directory).sort()).toEqual(["authority", "failing-openssl", "server"]);
  }, 20_000);

  it("does not mint a replacement trust root when a server remains but its CA is missing", () => {
    const directory = fixture(); const paths = prepare(directory);
    const originalKey = readFileSync(paths.key);
    rmSync(join(directory, "authority"), { recursive: true });
    expect(() => prepare(directory)).toThrow(/불완전/);
    expect(existsSync(paths.ca)).toBe(false);
    expect(readFileSync(paths.key)).toEqual(originalKey);
  }, 20_000);

  it("does not steal another preparation lock", () => {
    const directory = fixture(); mkdirSync(join(directory, ".lock"), { mode: 0o700 });
    expect(() => prepare(directory)).toThrow(/준비 중/);
    expect(readdirSync(directory)).toEqual([".lock"]);
  });

  it("starts Next with explicit local key/cert/CA paths and a separate port", () => {
    const paths = { key: "/private/server/key.pem", cert: "/private/server/cert.pem", ca: "/private/authority/cert.pem" };
    const args = nextHttpsArguments(paths, 3443);
    expect(args).toEqual(["dev", "--hostname", "0.0.0.0", "--port", "3443", "--experimental-https", "--experimental-https-key", paths.key, "--experimental-https-cert", paths.cert, "--experimental-https-ca", paths.ca]);
    for (const port of [0, 80, 65536, NaN, 3443.5]) expect(() => nextHttpsArguments(paths, port)).toThrow(/포트/);
  });
});
