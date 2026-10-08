// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePhoto } from "../../src/lib/client/photos";
import { LIMITS } from "../../src/lib/contracts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function decoding(supported: boolean, width = 640, height = 480) {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = width;
      naturalHeight = height;
      decode() {
        return supported
          ? Promise.resolve()
          : Promise.reject(new Error("decode failed"));
      }
    },
  );
  let index = 0;
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:${++index}`),
    revokeObjectURL: revoke,
  });
  return revoke;
}

describe("local image preparation", () => {
  it("validates JPG locally and revokes the temporary decoding URL", async () => {
    const revoke = decoding(true);
    const file = new File(["image"], "bottle.jpg", { type: "image/jpeg" });
    const photo = await preparePhoto(file);
    expect(photo.file).toBe(file);
    expect(photo.url).toBe("blob:2");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:1");
  });
  it("converts a browser-decodable image to JPEG through the displayed orientation", async () => {
    decoding(true);
    const drawImage = vi.fn();
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })),
    );
    const photo = await preparePhoto(
      new File(["image"], "item.bmp", { type: "image/bmp" }),
    );
    expect(photo.file.type).toBe("image/jpeg");
    expect(photo.file.name).toBe("item.jpg");
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0][1]).toBe(0);
    expect(drawImage.mock.calls[0][2]).toBe(0);
  });
  it("explains an unsupported HEIC decode and releases its temporary URL", async () => {
    const revoke = decoding(false);
    await expect(
      preparePhoto(new File(["heic"], "item.heic", { type: "image/heic" })),
    ).rejects.toThrow("이 브라우저에서는 HEIC 사진을 열 수 없어요.");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:1");
  });
  it("rejects oversized and non-image files before creating a preview", async () => {
    decoding(true);
    await expect(
      preparePhoto(
        new File([new Uint8Array(LIMITS.photoBytes + 1)], "big.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).rejects.toThrow("5MB");
    await expect(
      preparePhoto(new File(["text"], "notes.txt", { type: "text/plain" })),
    ).rejects.toThrow("사진 파일을 선택해 주세요.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("safe canvas dimensions", () => {
  it.each([
    ["image/jpeg", "large.jpg", 8000, 6000, 4096, 3072],
    ["image/png", "portrait.png", 6000, 8000, 3072, 4096],
    ["image/webp", "large.webp", 10000, 3000, 4096, 1228],
    ["image/bmp", "panorama.bmp", 12000, 1000, 4096, 341],
  ])("preserves the full composition of %s at safe dimensions", async (type, name, width, height, expectedWidth, expectedHeight) => {
    decoding(true, width, height);
    const drawImage = vi.fn();
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      expect(this.width).toBe(expectedWidth);
      expect(this.height).toBe(expectedHeight);
      expect(this.width * this.height).toBeLessThanOrEqual(LIMITS.photoPixels);
      callback(new Blob(["jpeg"], { type: "image/jpeg" }));
    });
    const result = await preparePhoto(new File(["small compressed image"], name, { type }));
    expect(result.file.type).toBe("image/jpeg");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, expectedWidth, expectedHeight);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
  });

  it("keeps a supported image exactly at the server pixel limit unchanged", async () => {
    decoding(true, 6000, 4000);
    const file = new File(["jpeg"], "edge.jpg", { type: "image/jpeg" });
    expect((await preparePhoto(file)).file).toBe(file);
  });

  it("rejects a normalized JPEG over 5 MiB and releases its temporary URL", async () => {
    const revoke = decoding(true, 8000, 6000);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob([new Uint8Array(LIMITS.photoBytes + 1)], { type: "image/jpeg" })));
    await expect(preparePhoto(new File(["compressed"], "large.jpg", { type: "image/jpeg" }))).rejects.toThrow("변환한 사진이 5MB");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:1");
  });
});
