import React, { useState } from "react";
import { apiPost, UnauthorizedError } from "../api";
import type { ChatAnswer } from "../types";

interface ChatTurn {
  question: string;
  answer?: ChatAnswer;
  error?: string;
}

const SUGGESTIONS = ["What was my burn last month for Brevard?", "What's my cash on hand across all business?", "Any open reconciliation exceptions?"];

export function ChatDrawer({ open, onClose, onUnauthorized }: { open: boolean; onClose: () => void; onUnauthorized: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setQuestion("");
    setTurns((t) => [...t, { question }]);
    try {
      const answer = await apiPost<ChatAnswer>("/api/chat", { question });
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: (e as Error).message } : turn)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && <div className="chat-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`chat-drawer ${open ? "chat-drawer-open" : ""}`} aria-label="CFO chat">
        <div className="chat-drawer-head">
          <h2>Ask the CFO</h2>
          <button type="button" onClick={onClose} aria-label="Close chat">
            ✕
          </button>
        </div>
        <div className="chat-turns" role="log" aria-live="polite">
          {turns.length === 0 && (
            <div className="chat-empty">
              <p>Ask about burn, cashflow, cash on hand, spend categories, recurring costs, commingled costs, or reconciliation.</p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="chat-turn">
              <p className="chat-question">{t.question}</p>
              {t.error && <p className="chat-error">Error: {t.error}</p>}
              {t.answer && (
                <div className={`chat-answer ${t.answer.refused ? "chat-refused" : ""}`}>
                  <p>{t.answer.answer}</p>
                  {!t.answer.refused && (
                    <details className="chat-sql">
                      <summary>View SQL</summary>
                      <pre className="mono">{t.answer.sql}</pre>
                    </details>
                  )}
                </div>
              )}
              {!t.answer && !t.error && <p className="chat-thinking">Thinking…</p>}
            </div>
          ))}
        </div>
        <form
          className="chat-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question…"
            aria-label="Ask the CFO a question"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !question.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      </aside>
    </>
  );
}
