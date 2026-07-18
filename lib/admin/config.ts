/** Emails allowed to access the admin usage dashboard. */
export const ADMIN_EMAILS = ["iyersamir@gmail.com"] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (ADMIN_EMAILS as readonly string[]).includes(email.toLowerCase());
}
