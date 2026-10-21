import { ROLE_LOGIN_DOMAIN } from "../command/personas.js";

const DEMO_ROLE_DOMAINS = new Set(Object.values(ROLE_LOGIN_DOMAIN));

export type OutboundMail = {
  mode: "log";
  sent: false;
  reason: string;
};

/**
 * The product has no mail transport. Demo role domains (ciso.com and the
 * other seven) are real public domains, so messages to them are never sent.
 * Anything else is also log-only until a transport exists, and demo domains
 * stay log-only even then.
 */
export function deliverMail(input: { to: string; subject: string }): OutboundMail {
  const domain = input.to.split("@")[1]?.trim().toLowerCase() ?? "";
  const demo = DEMO_ROLE_DOMAINS.has(domain);
  const reason = demo
    ? "demo role domain is public; mail stays log-only"
    : "no mail transport is configured; mail stays log-only";
  console.info(`outbound mail withheld mode=log to=${input.to} subject=${JSON.stringify(input.subject)} reason=${reason}`);
  return { mode: "log", sent: false, reason };
}
