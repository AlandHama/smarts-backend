import { Injectable, Logger, UnprocessableEntityException } from "@nestjs/common"
import * as tf from "@tensorflow/tfjs"
import "@tensorflow/tfjs-backend-cpu"
import { load, type NSFWJS, type PredictionType } from "nsfwjs"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import sharp, { type OutputInfo } from "sharp"

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 8_000
const UNSAFE_IMAGE_THRESHOLD = 0.45
const UNSAFE_SEXY_THRESHOLD = 0.62

// NSFWJS is an image classifier. Text needs a separate, deterministic policy
// because sending player text to an image model would not provide protection.
const UNSAFE_TEXT_TERMS = [
  "porn", "porno", "pornography", "hentai", "nsfw", "xxx", "nude", "nudes", "naked",
  "sex", "sexual", "sexting", "blowjob", "handjob", "dick", "cock", "pussy", "cunt",
  "fuck", "fucking", "whore", "slut", "onlyfans", "cum", "anal", "rape", "pedo",
  "pedophile", "childporn", "incest", "fetish", "bdsm", "boobs", "tits",
]

type ImageSafetyResult = {
  safe: boolean
  predictions: PredictionType[]
  reason?: string
}

@Injectable()
export class ContentSafetyService {
  private readonly logger = new Logger(ContentSafetyService.name)
  private modelPromise?: Promise<NSFWJS>

  assertSafeText(value: string | null | undefined, field = "text") {
    if (!this.isSafeText(value)) {
      throw new UnprocessableEntityException(`${field} contains content that is not allowed for this app`)
    }
  }

  isSafeText(value: string | null | undefined) {
    const normalized = this.normalizeText(value ?? "")
    return !normalized || !UNSAFE_TEXT_TERMS.some((term) => this.containsTerm(normalized, term))
  }

  assertSafeImage(buffer: Buffer, field = "image") {
    return this.checkImage(buffer).then((result) => {
      if (!result.safe) {
        throw new UnprocessableEntityException(`${field} contains content that is not allowed for this app`)
      }
      return result
    })
  }

  async assertSafeImageUrl(url: string | null | undefined, field = "image") {
    if (!url?.trim()) return null
    const buffer = await this.downloadImage(url)
    return this.assertSafeImage(buffer, field)
  }

  private async checkImage(buffer: Buffer): Promise<ImageSafetyResult> {
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      return { safe: false, predictions: [], reason: "image-size" }
    }

    let raw: { data: Buffer; info: OutputInfo }
    try {
      raw = await sharp(buffer, { failOn: "error" })
        .rotate()
        .resize({ width: 224, height: 224, fit: "cover" })
        .toColourspace("srgb")
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    } catch (error) {
      this.logger.warn(`Image decode failed during safety check: ${error instanceof Error ? error.message : String(error)}`)
      return { safe: false, predictions: [], reason: "image-decode" }
    }

    const model = await this.getModel()
    const tensor = tf.tensor3d(new Uint8Array(raw.data), [raw.info.height, raw.info.width, raw.info.channels], "int32")
    try {
      const predictions = await model.classify(tensor)
      const probability = (name: string) => predictions.find((item) => item.className === name)?.probability ?? 0
      const safe = probability("Porn") < UNSAFE_IMAGE_THRESHOLD
        && probability("Hentai") < UNSAFE_IMAGE_THRESHOLD
        && probability("Sexy") < UNSAFE_SEXY_THRESHOLD
      return { safe, predictions, reason: safe ? undefined : "nsfwjs" }
    } finally {
      tensor.dispose()
    }
  }

  private getModel() {
    this.modelPromise ??= (async () => {
      await tf.setBackend("cpu")
      await tf.ready()
      return load("MobileNetV2")
    })().catch((error) => {
      this.modelPromise = undefined
      this.logger.error(`NSFWJS model could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
      throw new UnprocessableEntityException("Image safety checking is temporarily unavailable")
    })
    return this.modelPromise
  }

  private normalizeText(value: string) {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[0@]/g, "o")
      .replace(/[1!|]/g, "i")
      .replace(/[3]/g, "e")
      .replace(/[4]/g, "a")
      .replace(/[5$]/g, "s")
      .replace(/[7]/g, "t")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  }

  private containsTerm(normalized: string, term: string) {
    if (new RegExp(`(?:^|\\s)${term}(?:$|\\s)`, "i").test(normalized)) return true
    // Compact matching catches separators used to evade the filter, but only
    // for terms long enough to avoid false positives such as "Essex" -> "sex".
    const compact = normalized.replace(/\s/g, "")
    return (term.length >= 4 || normalized.includes(" ")) && compact.includes(term)
  }

  private async downloadImage(value: string) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new UnprocessableEntityException("Avatar URL is invalid")
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && process.env.NODE_ENV !== "production")) {
      throw new UnprocessableEntityException("Avatar URL must use HTTPS")
    }
    await this.assertPublicHost(url.hostname)

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      headers: { Accept: "image/*" },
    }).catch(() => null)
    if (!response || !response.ok || response.status >= 300) throw new UnprocessableEntityException("Avatar image could not be checked")
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/")) throw new UnprocessableEntityException("Avatar URL must point to an image")
    const length = Number(response.headers.get("content-length") ?? 0)
    if (length > MAX_IMAGE_BYTES) throw new UnprocessableEntityException("Avatar image is too large")
    if (!response.body) throw new UnprocessableEntityException("Avatar image could not be checked")

    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        const chunk = Buffer.from(next.value)
        total += chunk.length
        if (total > MAX_IMAGE_BYTES) throw new UnprocessableEntityException("Avatar image is too large")
        chunks.push(chunk)
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks, total)
  }

  private async assertPublicHost(hostname: string) {
    if (isIP(hostname) && this.isPrivateAddress(hostname)) throw new UnprocessableEntityException("Avatar URL host is not allowed")
    const addresses = await lookup(hostname, { all: true }).catch(() => [])
    if (!addresses.length || addresses.some((item) => this.isPrivateAddress(item.address))) throw new UnprocessableEntityException("Avatar URL host is not allowed")
  }

  private isPrivateAddress(address: string) {
    const value = address.toLowerCase()
    if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true
    const ipv4 = value.startsWith("::ffff:") ? value.slice(7) : value
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return false
    const parts = ipv4.split(".").map(Number)
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
  }
}
