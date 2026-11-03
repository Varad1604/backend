import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { configProblems } from './config';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

if (configProblems.length) {
  // Fail loudly: never run with a guessed configuration.
  console.error('[kpmpl] Invalid configuration:\n - ' + configProblems.join('\n - '));
  createRoot(root).render(
    <main className="mx-auto max-w-2xl px-6 py-16 text-ink">
      <h1 className="text-[28px] font-semibold">Configuration error</h1>
      <p className="mt-3 text-[16px] text-muted">This build of KPMPL Gate to Bill was configured incorrectly and will not start. Tell the administrator:</p>
      <ul className="mt-5 border-t border-rule">
        {configProblems.map((p) => <li key={p} className="border-b border-rule py-2.5 font-mono text-[15px]">{p}</li>)}
      </ul>
    </main>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
