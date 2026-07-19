/** Map Firebase Auth errors to short user-facing messages. */
export function formatAuthError(error: unknown, fallback: string): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email/password sign-up is disabled in Firebase Auth. Enable it in the Firebase console.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "Firebase is misconfigured (invalid API key). Check NEXT_PUBLIC_FIREBASE_* in .env.local.";
    case "auth/configuration-not-found":
      return "Firebase Auth is not configured for this project.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Pop-up was blocked. Allow pop-ups for this site and try again.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Auth settings.";
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "Invalid email or password.";
    default:
      if (code) return `${fallback} (${code})`;
      return fallback;
  }
}
