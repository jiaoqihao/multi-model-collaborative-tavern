declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TAVERN_ENCRYPTION_KEY?: string;
  }
}
