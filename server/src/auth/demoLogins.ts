const PLACEHOLDERS = new Set(["", "replace-with-a-local-password", "changeme", "password"]);

export function passwordsForDemoLogins(input: {
  emails: string[];
  fileText: string | null;
  fallbackPassword: string | null;
}): Map<string, string> {
  const wanted = input.emails.map((email) => email.trim().toLowerCase());
  if (input.fileText == null) {
    const fallback = input.fallbackPassword ?? "";
    if (!passwordUsable(fallback)) {
      throw new Error(
        "Set ECC_DEMO_LOGINS_FILE to a gitignored email,password file, or set ECC_DEMO_PASSWORD to a local password of at least 10 characters. Do not commit it.",
      );
    }
    return new Map(wanted.map((email) => [email, fallback]));
  }

  const parsed = parseLoginFile(input.fileText);
  const missing = wanted.filter((email) => !parsed.has(email));
  if (missing.length > 0) {
    throw new Error(`No password entry for ${missing.join(", ")}. Add one email,password line per demo login.`);
  }
  const out = new Map<string, string>();
  for (const email of wanted) {
    const password = parsed.get(email) ?? "";
    if (!passwordUsable(password)) {
      throw new Error(
        `Password for ${email} must be at least 10 characters and must not be a placeholder. Do not commit it.`,
      );
    }
    out.set(email, password);
  }
  return out;
}

function passwordUsable(password: string): boolean {
  return password.length >= 10 && !PLACEHOLDERS.has(password);
}

function parseLoginFile(text: string): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const comma = line.indexOf(",");
    if (comma <= 0) {
      throw new Error("Each demo login line must be email,password.");
    }
    const email = line.slice(0, comma).trim().toLowerCase();
    const password = line.slice(comma + 1);
    if (!email.includes("@")) {
      throw new Error("Each demo login line must be email,password.");
    }
    parsed.set(email, password);
  }
  return parsed;
}
