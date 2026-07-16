export const minimumOfflineUnlockPasswordLength = 8;

export function validateOfflineUnlockPassword(password) {
  return typeof password === "string" && password.trim().length >= minimumOfflineUnlockPasswordLength;
}
