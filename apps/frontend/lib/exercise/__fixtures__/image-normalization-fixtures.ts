import sharp from "sharp";

export type ImageNormalizationFixtures = {
  exifOrientation6Jpeg: Buffer;
  largePng: Buffer;
  overPixelLimitPng: Buffer;
  transparentPng: Buffer;
  webp: Buffer;
  corruptedJpeg: Buffer;
  spoofedJpeg: Buffer;
  animatedWebp: Buffer;
  multipageTiff: Buffer;
  invalidDimensionsPng: Buffer;
};

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rewritePngDimensions(
  source: Buffer,
  width: number,
  height: number,
): Buffer {
  const fixture = Buffer.from(source);
  fixture.writeUInt32BE(width, 16);
  fixture.writeUInt32BE(height, 20);
  fixture.writeUInt32BE(crc32(fixture.subarray(12, 29)), 29);
  return fixture;
}

async function createAnimatedFixture(format: "webp" | "tiff") {
  const width = 8;
  const pageHeight = 8;
  const pages = 2;
  const height = pageHeight * pages;
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = y < pageHeight ? 255 : 0;
      rgba[offset + 1] = y < pageHeight ? 0 : 255;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 255;
    }
  }

  const image = sharp(rgba, {
    raw: { width, height, channels: 4, pageHeight },
  });
  return format === "webp"
    ? image.webp({ quality: 90, loop: 0, delay: [100, 100] }).toBuffer()
    : image.tiff().toBuffer();
}

export async function createImageNormalizationFixtures(): Promise<ImageNormalizationFixtures> {
  const onePixelPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: "#ffffff",
    },
  })
    .png()
    .toBuffer();

  const [
    exifOrientation6Jpeg,
    largePng,
    overPixelLimitPng,
    transparentPng,
    webp,
    animatedWebp,
    multipageTiff,
  ] = await Promise.all([
    sharp({
      create: {
        width: 80,
        height: 40,
        channels: 3,
        background: "#1474e8",
      },
    })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .withXmp(
        '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"/>',
      )
      .toBuffer(),
    sharp({
      create: {
        width: 5_000,
        height: 3_000,
        channels: 3,
        background: "#e9edf2",
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    sharp({
      create: {
        width: 6_325,
        height: 6_325,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    sharp({
      create: {
        width: 32,
        height: 24,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer(),
    sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: "#f2b544",
      },
    })
      .webp({ quality: 85 })
      .toBuffer(),
    createAnimatedFixture("webp"),
    createAnimatedFixture("tiff"),
  ]);

  return {
    exifOrientation6Jpeg,
    largePng,
    overPixelLimitPng,
    transparentPng,
    webp,
    corruptedJpeg: Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]),
    spoofedJpeg: Buffer.from("not a decoded JPEG image", "utf8"),
    animatedWebp,
    multipageTiff,
    invalidDimensionsPng: rewritePngDimensions(onePixelPng, 0, 1),
  };
}
