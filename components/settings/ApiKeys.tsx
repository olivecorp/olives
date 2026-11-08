"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import type { ApiKey } from "@/lib/types";

/**
 * Manage external API keys — the Bearer tokens that let other people and
 * scripts add todos and events to this account via POST /api/v1/*. A key
 * can only create items; it can never read, change, or delete anything.
 * The full secret is shown exactly once, at creation (the server keeps only
 * a sha256 hash); revoke instantly kills a leaked one.
 */
export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/keys");
      if (!res.ok) {
        setMessage("Couldn't load API keys.");
        return;
      }
      const { keys } = (await res.json()) as { keys: ApiKey[] };
      setKeys(keys);
    })();
  }, []);

  async function create() {
    const label = name.trim();
    if (!label) return;
    setBusy(true);
    setMessage(null);
    setCopied(false);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        key?: ApiKey;
        secret?: string;
        error?: string;
      };
      if (!res.ok || !data.key || !data.secret) {
        setMessage(data.error || "Couldn't create the key.");
        return;
      }
      setKeys((cur) => [data.key!, ...(cur ?? [])]);
      setNewSecret(data.secret);
      setName("");
    } catch {
      setMessage("Couldn't create the key.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKey) {
    if (
      !window.confirm(
        `Revoke "${key.name}"? Anything using this key stops working immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/keys/${key.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setKeys(
        (cur) =>
          cur?.map((k) =>
            k.id === key.id ? { ...k, revokedAt: new Date().toISOString() } : k,
          ) ?? cur,
      );
    } catch {
      setMessage("Couldn't revoke the key.");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Copy failed — select the text and copy it manually.");
    }
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : "never";

  // Only rendered once a key was just created (client-side), so
  // window.location is safe here.
  const curl = newSecret
    ? [
        `curl -X POST ${window.location.origin}/api/v1/todos \\`,
        `  -H "Authorization: Bearer ${newSecret}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"text":"Added via the API"}'`,
      ].join("\n")
    : "";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <h2 className="text-base font-semibold">External API</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Let scripts and friends add todos and events to your account with an
        API key. Keys can add items only — they can never read, change, or
        delete anything.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name, e.g. Oliver's Shortcuts"
          maxLength={100}
          className="h-9 min-w-[10rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm outline-none focus:border-[var(--color-check)]"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex h-9 items-center gap-1 rounded-lg bg-[var(--color-check)] px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          <KeyRound className="h-4 w-4" />
          {busy ? "Creating…" : "Create key"}
        </button>
      </form>

      {newSecret && (
        <div className="mt-3 rounded-lg border border-[var(--color-exempt-soft)] bg-[var(--color-exempt-soft)] px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <code className="break-all font-mono text-sm">{newSecret}</code>
            <button
              type="button"
              onClick={() => void copySecret()}
              title="Copy key"
              aria-label="Copy key"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-black/5"
            >
              {copied ? (
                <Check className="h-4 w-4 text-[var(--color-check)]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="mt-1 text-xs">
            <strong>This key won&apos;t be shown again.</strong> Keep it
            somewhere safe — revoke and create a new one if it leaks.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-xs text-[var(--muted)]">
            {curl}
          </pre>
        </div>
      )}

      <ul className="mt-3 divide-y divide-[var(--border)]">
        {(keys ?? []).map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{k.name}</span>
                <span className="font-mono text-xs text-[var(--muted)]">
                  {k.keyPrefix}…
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Created {fmt(k.createdAt)} · Last used {fmt(k.lastUsedAt)}
              </p>
            </div>
            {k.revokedAt ? (
              <span className="shrink-0 text-xs text-[var(--muted)]">
                Revoked
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void revoke(k)}
                disabled={busy}
                title="Stop anything using this key immediately"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {keys !== null && keys.length === 0 && (
        <p className="mt-2 text-sm text-[var(--muted)]">No API keys yet.</p>
      )}

      {message && <p className="mt-3 text-sm text-[var(--muted)]">{message}</p>}
    </section>
  );
}
