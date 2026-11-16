import * as Crypto from "expo-crypto";

export function randomNonce(length = 32) {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  const array = Crypto.getRandomBytes(length);
  array.forEach((n) => (result += chars[n % chars.length]));
  return result;
}

export async function sha256(str: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    str,
  );
  return digest;
}
