import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  constants,
  openSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { canonicalPacket } from "../../shared/runner-control.js";
import { PublicError } from "../public-error.js";
/** Separate node/control-plane keys; never copied in thread checkpoints. */
export class PacketCipher {
  private key: Buffer;
  private closed = false;
  constructor(directory: string, required: boolean) {
    directory = resolve(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (realpathSync(directory) !== directory)
      throw new PublicError("传输存储目录不能使用链接");
    const path = join(directory, "transport.key");
    if (!existsSync(path)) {
      if (required) throw new PublicError("传输密钥缺失，保留原回执并停止恢复");
      const fd = openSync(
          path,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        ),
        key = randomBytes(32);
      try {
        writeFileSync(fd, key);
        fsyncSync(fd);
      } finally {
        key.fill(0);
        closeSync(fd);
      }
      const parent = openSync(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    }
    const info = lstatSync(path);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw new PublicError("传输密钥文件权限无效");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      this.key = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
    if (this.key.length !== 32) throw new PublicError("传输密钥文件无效");
  }
  private assertOpen() {
    if (this.closed) throw new PublicError("传输存储已关闭");
  }
  fingerprint(value: unknown) {
    this.assertOpen();
    return createHmac("sha256", this.key)
      .update(canonicalPacket(value))
      .digest("hex");
  }
  seal(value: unknown, context: string) {
    this.assertOpen();
    const plain = Buffer.from(canonicalPacket(value)),
      nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    try {
      return Buffer.concat([
        nonce,
        cipher.update(plain),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("base64");
    } finally {
      plain.fill(0);
    }
  }
  open(packet: string, context: string): unknown {
    this.assertOpen();
    const all = Buffer.from(packet, "base64");
    let plain: Buffer | undefined;
    try {
      if (all.length < 28) throw Error();
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        all.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(all.subarray(-16));
      plain = Buffer.concat([
        decipher.update(all.subarray(12, -16)),
        decipher.final(),
      ]);
      return JSON.parse(plain.toString("utf8"));
    } catch {
      throw new PublicError("传输回执校验失败，不能重放此命令");
    } finally {
      plain?.fill(0);
    }
  }
  close() {
    this.key.fill(0);
    this.closed = true;
  }
}
