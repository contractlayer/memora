import { useState } from 'react';
import type { Api } from '../preload';

declare global {
  interface Window {
    api: Api;
  }
}

export function App() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onAsk() {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await window.api.query.ask({ question });
      setAnswer(res.answer);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>AI Search</h1>
        <span className="app__subtitle">Spotlight + ChatGPT for your files</span>
      </header>

      <main className="app__main">
        <div className="search">
          <input
            className="search__input"
            type="text"
            placeholder="Ask anything about your files…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAsk()}
          />
          <button className="search__button" onClick={onAsk} disabled={loading}>
            {loading ? '...' : 'Ask'}
          </button>
        </div>

        {answer && (
          <section className="answer">
            <h2>Answer</h2>
            <p>{answer}</p>
          </section>
        )}
      </main>
    </div>
  );
}
