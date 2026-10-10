// Small app-icon tiles that sit inline in the hero headline (Claude, ChatGPT, WhatsApp, phone).
// Simple drawn marks, not the official logos; decorative, so hidden from screen readers.
import type { ReactNode } from "react";

function Tile({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="mx-[0.08em] inline-grid size-[0.82em] -translate-y-[0.06em] place-items-center rounded-[0.2em] border border-black/10 align-middle shadow-[inset_0_-0.04em_0_rgba(0,0,0,0.06)]"
      style={{ background: bg }}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]">{children}</svg>
    </span>
  );
}

export function ClaudeTile() {
  const rays = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <Tile bg="linear-gradient(#d97757,#c96442)">
      {rays.map((a) => (
        <line key={a} x1="12" y1="12" x2="12" y2={a % 72 ? 2.5 : 1.5} stroke="#fff6f0" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />
      ))}
    </Tile>
  );
}

export function ChatGPTTile() {
  return (
    <Tile bg="linear-gradient(#ffffff,#ececec)">
      {[0, 60, 120].map((a) => (
        <ellipse key={a} cx="12" cy="12" rx="9" ry="4.2" fill="none" stroke="#141414" strokeWidth="1.8" transform={`rotate(${a} 12 12)`} />
      ))}
    </Tile>
  );
}

export function WhatsAppTile() {
  return (
    <Tile bg="linear-gradient(#3fe07a,#25c45d)">
      <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" fill="#fff" />
      <path d="M9.2 7.8c.3-.1.6 0 .7.3l.7 1.6c.1.3 0 .5-.2.7l-.5.5c.6 1.2 1.6 2.2 2.8 2.8l.5-.5c.2-.2.5-.3.7-.2l1.6.7c.3.1.4.4.3.7-.3 1-1.2 1.6-2.2 1.4-2.8-.6-5-2.8-5.6-5.6-.2-1 .4-1.9 1.2-2.4Z" fill="#25c45d" />
    </Tile>
  );
}

export function PhoneTile() {
  return (
    <Tile bg="linear-gradient(#2b2b2b,#141414)">
      <path d="M7.5 3.5c.5-.2 1 0 1.2.5l1.3 3c.2.4 0 .9-.3 1.2l-1.2 1c1 2.2 2.7 3.9 4.9 4.9l1-1.2c.3-.4.8-.5 1.2-.3l3 1.3c.5.2.7.7.5 1.2-.6 1.9-2.4 3.1-4.4 2.8A11 11 0 0 1 4.7 8c-.3-2 .9-3.8 2.8-4.5Z" fill="#fff" />
    </Tile>
  );
}
