import { execFileSync, spawn } from "node:child_process";
import { createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
export const LOCAL_CERTIFICATES = join(PROJECT_ROOT, ".local-https");
const DAY = 86_400_000;

/** @param {ReturnType<typeof networkInterfaces>} interfaces */
export function localAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flatMap(entries => entries ?? [])
    .filter(({ address, family, internal }) => {
      if (internal || family !== "IPv4" || !isIPv4(address)) return false;
      const [first, second] = address.split(".").map(Number);
      return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
    }).map(({ address }) => address))].sort();
}

/** @param {string} path */
function inspect(path) {
  try { return lstatSync(path); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
}

/** @param {string} path @param {boolean} directory */
function requirePrivate(path, directory) {
  const stat = inspect(path);
  if (!stat) throw new Error("기존 인증서 파일이 불완전합니다. 자동으로 덮어쓰지 않습니다.");
  if (stat.isSymbolicLink()) throw new Error("인증서 경로의 심볼릭 링크는 사용할 수 없습니다.");
  if ((directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    || (process.getuid && stat.uid !== process.getuid())) throw new Error("인증서 경로의 종류 또는 소유자가 올바르지 않습니다.");
  if ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) throw new Error("인증서 폴더는 0700, 파일은 0600 권한이어야 합니다. 기존 권한은 자동 변경하지 않습니다.");
}

/** @param {string} directory */
function preparePrivateDirectory(directory) {
  const parts = relative(LOCAL_CERTIFICATES, directory).split(sep).filter(Boolean);
  if (parts.some(part => part === "..") || (directory !== LOCAL_CERTIFICATES && !directory.startsWith(`${LOCAL_CERTIFICATES}${sep}`))) {
    throw new Error("프로젝트의 비공개 인증서 폴더 안에서만 준비할 수 있습니다.");
  }
  let current = LOCAL_CERTIFICATES;
  for (const part of ["", ...parts]) {
    if (part) current = join(current, part);
    if (!inspect(current)) mkdirSync(current, { mode: 0o700 });
    requirePrivate(current, true);
  }
}

/** @param {string} command @param {string[]} args */
function opensslRun(command, args) {
  try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }); }
  catch { throw new Error("OpenSSL 인증서 작업에 실패했습니다. OpenSSL 3 설치와 로컬 파일 상태를 확인하세요."); }
}

/** @param {string} directory */
function material(directory) {
  requirePrivate(directory, true);
  const key = join(directory, "key.pem"); const cert = join(directory, "cert.pem");
  requirePrivate(key, false); requirePrivate(cert, false);
  try {
    const certificate = new X509Certificate(readFileSync(cert));
    if (!certificate.checkPrivateKey(createPrivateKey(readFileSync(key)))) throw new Error();
    if (Date.parse(certificate.validFrom) > Date.now()) throw new Error();
    return { key, cert, certificate };
  } catch { throw new Error("기존 인증서와 키가 유효하지 않습니다. 자동으로 덮어쓰지 않습니다."); }
}

/** @param {string} directory @param {string} command */
function authority(directory, command) {
  const target = join(directory, "authority");
  if (!inspect(target)) {
    const stage = mkdtempSync(join(directory, ".pending-ca-"));
    try {
      opensslRun(command, ["req", "-x509", "-newkey", "rsa:3072", "-noenc", "-sha256", "-days", "3650", "-config", "/dev/null", "-subj", "/CN=RecycleGuide Local Development CA",
        "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
        "-keyout", join(stage, "key.pem"), "-out", join(stage, "cert.pem")]);
      chmodSync(join(stage, "key.pem"), 0o600); chmodSync(join(stage, "cert.pem"), 0o600);
      material(stage);
      renameSync(stage, target);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  const ca = material(target);
  if (!ca.certificate.ca || !ca.certificate.verify(ca.certificate.publicKey)
    || Date.parse(ca.certificate.validTo) < Date.now() + 31 * DAY) {
    throw new Error("로컬 CA가 유효하지 않거나 만료가 가깝습니다. 기존 CA를 자동 교체하지 않습니다.");
  }
  return ca;
}

/**
 * Produces local files only. It never installs a trust root or starts a server.
 * @param {{directory?: string, interfaces?: ReturnType<typeof networkInterfaces>, openssl?: string}} options
 */
export function prepareHttps({ directory = LOCAL_CERTIFICATES, interfaces = networkInterfaces(), openssl = "openssl" } = {}) {
  directory = resolve(directory);
  preparePrivateDirectory(directory);
  const lock = join(directory, ".lock");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error("인증서를 준비 중이거나 이전 잠금이 남아 있습니다. 실행 중인 준비 작업을 먼저 확인하세요."); }
  const previousUmask = process.umask(0o077);
  try {
    if (inspect(join(directory, "server")) && !inspect(join(directory, "authority"))) {
      throw new Error("기존 인증서 구성이 불완전합니다. 서버 인증서가 남아 있어 CA를 새로 만들지 않습니다.");
    }
    if (!/^OpenSSL 3\./.test(opensslRun(openssl, ["version"]))) throw new Error("OpenSSL 3가 필요합니다. 자동 설치하지 않습니다.");
    const ca = authority(directory, openssl);
    const addresses = localAddresses(interfaces);
    const expectedSAN = ["DNS:localhost", ...addresses.map(address => `IP Address:${address}`)].join(", ");
    const target = join(directory, "server");
    const existing = inspect(target) ? material(target) : null;
    if (existing && (existing.certificate.ca || !existing.certificate.verify(ca.certificate.publicKey))) {
      throw new Error("서버 인증서가 현재 로컬 CA와 일치하지 않습니다. 자동으로 덮어쓰지 않습니다.");
    }
    const renewed = !existing || existing.certificate.subjectAltName !== expectedSAN || Date.parse(existing.certificate.validTo) < Date.now() + DAY;
    if (renewed) {
      const stage = mkdtempSync(join(directory, ".pending-server-"));
      try {
        const key = existing?.key ?? join(stage, "key.pem");
        const cert = join(stage, "cert.pem");
        if (!existing) opensslRun(openssl, ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", key]);
        opensslRun(openssl, ["req", "-new", "-x509", "-key", key, "-CA", ca.cert, "-CAkey", ca.key,
          "-set_serial", `0x${randomBytes(16).toString("hex")}`, "-sha256", "-days", "30", "-config", "/dev/null", "-subj", "/CN=localhost",
          "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature,keyEncipherment",
          "-addext", "extendedKeyUsage=serverAuth", "-addext", `subjectAltName=DNS:localhost${addresses.map(address => `,IP:${address}`).join("")}`, "-out", cert]);
        chmodSync(cert, 0o600);
        if (!existing) chmodSync(key, 0o600);
        const generated = new X509Certificate(readFileSync(cert));
        if (generated.subjectAltName !== expectedSAN || !generated.checkPrivateKey(createPrivateKey(readFileSync(key)))) throw new Error("생성한 서버 인증서 검증에 실패했습니다.");
        opensslRun(openssl, ["verify", "-purpose", "sslserver", "-verify_hostname", "localhost", "-CAfile", ca.cert, cert]);
        // Keep the private key stable; renewal publishes just one validated certificate atomically.
        if (existing) renameSync(cert, existing.cert);
        else renameSync(stage, target);
      } finally { rmSync(stage, { recursive: true, force: true }); }
    }
    return { directory, key: join(target, "key.pem"), cert: join(target, "cert.pem"), ca: ca.cert, caKey: ca.key, addresses, renewed };
  } finally {
    process.umask(previousUmask);
    rmdirSync(lock);
  }
}

/** @param {{key: string, cert: string, ca: string}} paths @param {number} port */
export function nextHttpsArguments(paths, port = 3443) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("포트는 1024~65535 사이 정수여야 합니다.");
  return ["dev", "--hostname", "0.0.0.0", "--port", String(port), "--experimental-https", "--experimental-https-key", paths.key, "--experimental-https-cert", paths.cert, "--experimental-https-ca", paths.ca];
}

function main() {
  const args = process.argv.slice(2);
  let prepareOnly = false; let port = 3443;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--prepare") prepareOnly = true;
    else if (args[index] === "--port" && /^\d+$/.test(args[index + 1] ?? "")) port = Number(args[++index]);
    else if (args[index] === "--help") {
      console.log("로컬 HTTPS: npm run https:prepare 또는 npm run dev:https -- --port 3443\n인증서와 키는 .local-https에 생성합니다. CA 신뢰 설치는 자동으로 하지 않습니다.");
      return;
    } else throw new Error("지원하지 않는 옵션입니다. --prepare, --port 번호, --help만 사용할 수 있습니다.");
  }
  nextHttpsArguments({ key: "", cert: "", ca: "" }, port);
  const paths = prepareHttps();
  console.log(`로컬 인증서 ${paths.renewed ? "준비" : "재사용"} 완료. CA 공개 인증서: ${paths.ca}`);
  console.log("컴퓨터와 휴대폰에서 위 CA 공개 인증서만 직접 신뢰 설정해야 합니다. key.pem은 전송하지 마세요.");
  console.log(["localhost", ...paths.addresses].map(host => `https://${host}:${port}`).join("\n"));
  if (prepareOnly) return;
  const child = spawn(process.execPath, [join(PROJECT_ROOT, "node_modules/next/dist/bin/next"), ...nextHttpsArguments(paths, port)], { cwd: PROJECT_ROOT, stdio: "inherit" });
  const interrupt = () => { child.kill("SIGINT"); };
  const terminate = () => { child.kill("SIGTERM"); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  child.on("error", () => { console.error("로컬 HTTPS 서버를 시작하지 못했습니다."); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : "로컬 HTTPS 준비에 실패했습니다."); process.exitCode = 1; }
}
