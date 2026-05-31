import { useState } from "react";

/**
 * BYO-provider connection — VALIDATE-FIRST PROTOTYPE.
 *
 * Proves the economic keystone of the public product (see PRODUCT.md in the
 * planning repo): the app is free because per-user LLM compute runs on the
 * USER's own provider account, not ours.
 *
 * What this screen validates:
 *   1. A user can connect their own provider key (Claude / ChatGPT).
 *   2. A real call runs on THEIR key (effort → model tier mapping).
 *   3. The onboarding friction is tolerable for a non-technical PM.
 *   4. The privacy story: the key goes browser → provider directly and never
 *      touches auditjob.me's servers.
 *
 * Prototype scope (intentionally minimal):
 *   - Client-side fetch (not the anthropic-proxy edge function — that one burns
 *     OUR key, which is the cost trap we're escaping).
 *   - Key held in component state only, never persisted, never uploaded.
 *     Production will store it encrypted in Supabase so background digest/audit
 *     jobs can run while the user is away.
 */

// Effort → model tier, per provider. Intentionally editable — tune as models ship.
const MODEL_TIERS = {
  anthropic: { low: "claude-haiku-4-5", med: "claude-sonnet-4-6", high: "claude-opus-4-8" },
  openai: { low: "gpt-4o-mini", med: "gpt-4o", high: "gpt-4o" },
} as const;

type ProviderId = keyof typeof MODEL_TIERS;
type EffortId = "low" | "med" | "high";

const PROVIDERS: { id: ProviderId; label: string; sub: string; hint: string; keysUrl: string }[] = [
  { id: "anthropic", label: "Claude", sub: "Anthropic", hint: "sk-ant-…", keysUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "ChatGPT", sub: "OpenAI", hint: "sk-…", keysUrl: "https://platform.openai.com/api-keys" },
];

const EFFORTS: { id: EffortId; label: string; note: string }[] = [
  { id: "low", label: "Low", note: "fastest · cheapest" },
  { id: "med", label: "Medium", note: "balanced" },
  { id: "high", label: "High", note: "deepest" },
];

const TEST_PROMPT =
  "You are powering a free job-application audit tool that runs on the user's own AI account. In ONE short, friendly sentence, confirm the connection is live and name the model that is replying.";

type TestResult = { text: string; model: string; usage: string };

async function callAnthropic(apiKey: string, model: string): Promise<TestResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for direct browser (CORS) access — the user's key, their session.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: 256, messages: [{ role: "user", content: TEST_PROMPT }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic error [${res.status}]`);
  const text = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const u = data.usage;
  return { text, model: data.model || model, usage: u ? `${u.input_tokens} in / ${u.output_tokens} out tokens` : "" };
}

async function callOpenAI(apiKey: string, model: string): Promise<TestResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 256, messages: [{ role: "user", content: TEST_PROMPT }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error [${res.status}]`);
  const text = data.choices?.[0]?.message?.content || "";
  const u = data.usage;
  return { text, model: data.model || model, usage: u ? `${u.prompt_tokens} in / ${u.completion_tokens} out tokens` : "" };
}

export default function ConnectProvider() {
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [effort, setEffort] = useState<EffortId>("low");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  const activeProvider = PROVIDERS.find((p) => p.id === provider)!;
  const model = MODEL_TIERS[provider][effort];

  async function runTest() {
    if (!apiKey.trim()) {
      setError("Paste your API key first.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const out =
        provider === "anthropic"
          ? await callAnthropic(apiKey.trim(), model)
          : await callOpenAI(apiKey.trim(), model);
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cp-root">
      <style>{CP_CSS}</style>

      <header className="cp-nav">
        <span className="cp-wordmark">auditjob.me</span>
        <span className="cp-chip">Prototype</span>
      </header>

      <main className="cp-main">
        <p className="cp-eyebrow"><span className="cp-dot" /> Step · Connect your AI</p>
        <h1 className="cp-h1">Bring your own AI.</h1>
        <p className="cp-lede">
          auditjob.me is free. The thinking runs on <em>your</em> AI account, so you only pay your
          provider for what you use — and we never have to cut corners to save cost.
        </p>

        <section className="cp-card" aria-label="Connect provider">
          {/* Provider */}
          <div className="cp-field">
            <label className="cp-label">Provider</label>
            <div className="cp-seg" role="tablist">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={provider === p.id}
                  className={`cp-seg-btn ${provider === p.id ? "is-active" : ""}`}
                  onClick={() => { setProvider(p.id); setResult(null); setError(""); }}
                >
                  <span className="cp-seg-label">{p.label}</span>
                  <span className="cp-seg-sub">{p.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API key */}
          <div className="cp-field">
            <label className="cp-label" htmlFor="cp-key">API key</label>
            <div className="cp-key-row">
              <input
                id="cp-key"
                className="cp-input"
                type={showKey ? "text" : "password"}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={activeProvider.hint}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runTest()}
              />
              <button type="button" className="cp-ghost" onClick={() => setShowKey((s) => !s)} aria-label="Toggle key visibility">
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <a className="cp-hint-link" href={activeProvider.keysUrl} target="_blank" rel="noreferrer">
              Where do I get a {activeProvider.label} key? ↗
            </a>
          </div>

          {/* Effort */}
          <div className="cp-field">
            <label className="cp-label">Effort <span className="cp-label-meta">→ {model}</span></label>
            <div className="cp-seg cp-seg-3">
              {EFFORTS.map((ef) => (
                <button
                  key={ef.id}
                  type="button"
                  className={`cp-seg-btn ${effort === ef.id ? "is-active" : ""}`}
                  onClick={() => setEffort(ef.id)}
                >
                  <span className="cp-seg-label">{ef.label}</span>
                  <span className="cp-seg-sub">{ef.note}</span>
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="cp-cta" onClick={runTest} disabled={loading}>
            {loading ? "Testing…" : "Test connection"}
          </button>

          {error && (
            <div className="cp-result cp-result-err" role="alert">
              <strong>Couldn’t connect.</strong>
              <p>{error}</p>
            </div>
          )}

          {result && (
            <div className="cp-result cp-result-ok" role="status">
              <strong>✓ Connected — {result.model}</strong>
              <p className="cp-result-text">{result.text}</p>
              {result.usage && <p className="cp-result-meta">{result.usage}</p>}
            </div>
          )}
        </section>

        <p className="cp-privacy">
          Your key goes straight from this browser to {activeProvider.sub}. It never touches
          auditjob.me’s servers. <span className="cp-privacy-meta">(Prototype: the key isn’t saved
          anywhere yet.)</span>
        </p>
      </main>
    </div>
  );
}

const CP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700;9..40,800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

.cp-root{--bg:#0f0e0c;--surface:#1a1916;--text:#f0ede8;--muted:#8a8780;--border:#2a2825;--accent:#8a9a8a;
  min-height:100dvh;background:var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;}
.cp-root *{box-sizing:border-box;margin:0;padding:0;}

.cp-nav{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;
  height:52px;padding:0 1.25rem;border-bottom:1px solid var(--border);
  background:rgba(15,14,12,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
.cp-wordmark{font-family:'DM Sans',sans-serif;font-weight:700;font-size:.8rem;letter-spacing:.02em;}
.cp-chip{font-size:.55rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);
  border:1px solid var(--border);border-radius:999px;padding:.3rem .7rem;}

/* MOBILE-FIRST: single column, generous tap targets, comfortable padding */
.cp-main{max-width:560px;margin:0 auto;padding:1.75rem 1.25rem 4rem;}
.cp-eyebrow{display:flex;align-items:center;gap:.5rem;font-size:.62rem;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:1rem;}
.cp-dot{width:8px;height:8px;background:var(--accent);display:inline-block;}
.cp-h1{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(2rem,9vw,2.8rem);line-height:1.04;
  letter-spacing:-.03em;margin-bottom:.7rem;}
.cp-lede{font-size:.9rem;line-height:1.65;color:var(--muted);margin-bottom:2rem;}
.cp-lede em{color:var(--text);font-style:italic;}

.cp-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1.25rem;}
.cp-field{margin-bottom:1.4rem;}
.cp-label{display:block;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--accent);margin-bottom:.6rem;}
.cp-label-meta{color:var(--muted);font-weight:600;letter-spacing:.04em;text-transform:none;}

.cp-seg{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;}
.cp-seg-3{grid-template-columns:1fr 1fr 1fr;}
.cp-seg-btn{display:flex;flex-direction:column;align-items:flex-start;gap:.15rem;min-height:56px;
  padding:.7rem .85rem;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);
  cursor:pointer;text-align:left;transition:border-color .15s,background .15s;font-family:inherit;}
.cp-seg-btn:hover{border-color:var(--muted);}
.cp-seg-btn.is-active{border-color:var(--accent);background:rgba(138,154,138,.12);}
.cp-seg-label{font-family:'DM Sans',sans-serif;font-weight:700;font-size:.9rem;}
.cp-seg-sub{font-size:.6rem;color:var(--muted);letter-spacing:.02em;}

.cp-key-row{display:flex;gap:.5rem;}
.cp-input{flex:1;min-width:0;height:48px;padding:0 .9rem;border:1px solid var(--border);border-radius:10px;
  background:var(--bg);color:var(--text);font-size:.9rem;font-family:'JetBrains Mono',ui-monospace,monospace;
  letter-spacing:.02em;}
.cp-input:focus{outline:none;border-color:var(--accent);}
.cp-input::placeholder{color:var(--muted);opacity:.6;}
.cp-ghost{height:48px;padding:0 .9rem;border:1px solid var(--border);border-radius:10px;background:transparent;
  color:var(--muted);font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
  font-family:inherit;white-space:nowrap;}
.cp-ghost:hover{color:var(--text);border-color:var(--muted);}
.cp-hint-link{display:inline-block;margin-top:.6rem;font-size:.7rem;color:var(--accent);text-decoration:none;
  border-bottom:1px dotted var(--accent);}

.cp-cta{width:100%;min-height:52px;border:none;border-radius:10px;background:var(--accent);color:#0f0e0c;
  font-family:'DM Sans',sans-serif;font-weight:700;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;
  cursor:pointer;transition:opacity .15s;}
.cp-cta:hover{opacity:.88;}
.cp-cta:disabled{opacity:.5;cursor:not-allowed;}

.cp-result{margin-top:1.1rem;padding:1rem;border-radius:10px;font-size:.85rem;line-height:1.6;border:1px solid var(--border);}
.cp-result strong{font-family:'DM Sans',sans-serif;font-size:.82rem;display:block;margin-bottom:.4rem;}
.cp-result-ok{border-color:rgba(138,154,138,.5);background:rgba(138,154,138,.1);}
.cp-result-ok strong{color:var(--accent);}
.cp-result-err{border-color:rgba(200,90,70,.5);background:rgba(200,90,70,.1);}
.cp-result-err strong{color:#e08a78;}
.cp-result-text{color:var(--text);}
.cp-result-meta{margin-top:.5rem;font-size:.65rem;color:var(--muted);letter-spacing:.03em;}

.cp-privacy{margin-top:1.4rem;font-size:.72rem;line-height:1.6;color:var(--muted);text-align:center;}
.cp-privacy-meta{opacity:.7;}

/* ENHANCE UP for larger viewports */
@media (min-width:640px){
  .cp-main{padding:3rem 1.5rem 5rem;}
  .cp-card{padding:1.75rem;}
}
`;
