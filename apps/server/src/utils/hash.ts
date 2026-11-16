import { createHash } from "crypto";

export function hashEmail(email: string): string {
	const normalizedEmail = email.toLowerCase().trim();
	const hash = createHash("sha256");
	hash.update(normalizedEmail);
	return hash.digest("hex");
}
