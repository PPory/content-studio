import crypto from "node:crypto";
import fs from "node:fs/promises";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";

export const name = "xenho-file-attachments";

class XenhoFileAttachments extends AttachmentStore {
  imageLimits = {
    maxImageBytes: 1_000_000,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 4_000_000,
    maxImagePixels: 4_194_304,
    maxImageDimension: 4096,
    mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  };

  async index() {
    return JSON.parse(await fs.readFile(process.env.XENHO_IMAGE_INDEX_FILE, "utf8"));
  }

  async validateImage(input) {
    if (!this.imageLimits.mediaTypes.includes(input.mediaType)) throw new Error(`不支持图片类型 ${input.mediaType}`);
    if (!input.data?.byteLength || input.data.byteLength > this.imageLimits.maxImageBytes) throw new Error("图片超过 1MB 限制");
  }

  async saveImage() {
    throw new Error("图片必须先由 Xenho 工作台附件入口保存");
  }

  async readImage(ref, signal) {
    signal?.throwIfAborted();
    const item = (await this.index())[ref.attachmentId];
    if (!item?.path) throw new Error("图片附件已经不存在");
    const data = new Uint8Array(await fs.readFile(item.path));
    return { ref: { attachmentId: ref.attachmentId, mediaType: item.mediaType, bytes: data.byteLength, width: item.width, height: item.height, name: item.name }, data };
  }

  async readImageRequest(ref, policy, signal) {
    const stored = await this.readImage(ref, signal);
    if (stored.data.byteLength > policy.maxBytes || stored.ref.width * stored.ref.height > policy.maxPixels) throw new Error("图片超过当前模型的视觉输入限制，请压缩后重试");
    return {
      variantId: `sha256:${crypto.createHash("sha256").update(`${ref.attachmentId}:${stored.data.byteLength}:${policy.maxBytes}:${policy.maxPixels}`).digest("hex")}`,
      attachment: stored.ref,
      data: stored.data,
      mediaType: stored.ref.mediaType,
      bytes: stored.data.byteLength,
      width: stored.ref.width,
      height: stored.ref.height,
      depth: "uchar",
      space: "srgb",
      hasAlpha: stored.ref.mediaType === "image/png" || stored.ref.mediaType === "image/webp",
    };
  }
}

export function apply(ctx) {
  new XenhoFileAttachments(ctx);
}
