import { createHash, randomBytes } from "node:crypto";

/** Random exam token given to the student's browser (256 bits, URL-safe). */
export function newExamToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
