"use client";

import { Phone, MessageSquare, MessageCircle } from "lucide-react";
import { phoneActionLinks } from "@/lib/phoneLinks";

const DEFAULT_LABELS = { call: "Call", sms: "Send SMS", whatsapp: "WhatsApp", invalid: "No valid mobile number" };

// Call / SMS / WhatsApp icons for one person. The links only OPEN the device's
// dialer, messaging app or WhatsApp with the number filled in — nothing here
// records or reports that a call or message happened. When the stored number
// is missing or not a valid Indian mobile, the icons are shown disabled with an
// explanation instead of building a link to a wrong number.
// onAction(action) — optional: called with "call" | "sms" | "whatsapp" when the
// user clicks a live icon (the link still opens normally). Lists use it to record
// that an action was INITIATED.
export default function PhoneActions({ phone, name, labels, size = 15, className = "", onAction }) {
  const L = { ...DEFAULT_LABELS, ...(labels || {}) };
  const links = phoneActionLinks(phone);
  const box = "w-8 h-8 rounded-lg inline-flex items-center justify-center border";
  const who = name ? `${name} ` : "";

  if (!links) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`} title={L.invalid} data-testid="phone-actions-disabled">
        {[[Phone, L.call], [MessageSquare, L.sms], [MessageCircle, L.whatsapp]].map(([Icon, label]) => (
          <span key={label} role="img" aria-disabled="true" aria-label={`${label} — ${L.invalid}`}
                className={`${box} border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed`}>
            <Icon size={size} />
          </span>
        ))}
      </span>
    );
  }
  const items = [
    { href: links.tel, Icon: Phone, label: L.call, cls: "text-emerald-700 border-emerald-200 hover:bg-emerald-50", key: "call" },
    { href: links.sms, Icon: MessageSquare, label: L.sms, cls: "text-sky-700 border-sky-200 hover:bg-sky-50", key: "sms" },
    { href: links.whatsapp, Icon: MessageCircle, label: L.whatsapp, cls: "text-green-700 border-green-200 hover:bg-green-50", key: "whatsapp", external: true },
  ];
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} onClick={(e) => e.stopPropagation()} data-testid="phone-actions">
      {items.map(({ href, Icon, label, cls, key, external }) => (
        <a key={key} href={href} data-action={key} onClick={() => onAction?.(key)}
           {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
           title={`${label} ${who}(${links.display})`} aria-label={`${label} ${who}${links.display}`}
           className={`${box} bg-white ${cls}`}>
          <Icon size={size} />
        </a>
      ))}
    </span>
  );
}
