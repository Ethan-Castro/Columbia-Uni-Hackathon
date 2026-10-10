// Asks for the admin token once per tab (sessionStorage), then renders the
// admin page. Pages call onAuthError() on a 401 to ask again.
// PORTING: in Base44 this becomes a check of base44.auth.me() role === "admin".
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { getAdminToken, setAdminToken } from "../api.ts";
import { useI18n } from "../i18n.tsx";

export function AdminGate({ children }: { children: (signOut: (msg?: string) => void) => ReactNode }) {
  const { t } = useI18n();
  const [hasToken, setHasToken] = useState(() => !!getAdminToken());
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");

  const signOut = (msg = "") => {
    setAdminToken("");
    setHasToken(false);
    setMessage(msg);
  };

  if (hasToken) {
    return (
      <>
        <div className="admin-bar">
          <button type="button" className="btn btn-link" onClick={() => signOut()}>{t("adm_logout")}</button>
        </div>
        {children(signOut)}
      </>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setAdminToken(draft.trim());
    setDraft("");
    setMessage("");
    setHasToken(true);
  };

  return (
    <form className="card form token-form" onSubmit={onSubmit}>
      <label htmlFor="admin-token">{t("adm_token")}</label>
      <input
        id="admin-token"
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-describedby="admin-token-hint"
      />
      <p id="admin-token-hint" className="hint">{t("adm_token_hint")}</p>
      {message && <p className="error" role="alert">{message}</p>}
      <button type="submit" className="btn btn-primary">{t("adm_token_save")}</button>
    </form>
  );
}
