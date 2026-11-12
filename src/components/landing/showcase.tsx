import { CompareDemo, MemoryGraph } from "./interactions";
export function KnowledgeGraph() {
  return <section id="knowledge" className="lp-section lp-memory-section"><div className="lp-container"><div className="lp-section-intro"><h2>A memory you<br />can look into.</h2><p>Follow the connections between a preference, a choice and its outcome. Inspect the evidence behind a belief.</p></div><MemoryGraph /></div></section>;
}
export function AskAnything() {
  return <section className="lp-section lp-ask"><div className="lp-container"><div className="lp-section-intro"><p className="lp-eyebrow">Try a comparison</p><h2>Two options.<br />A little context.</h2><p>Change these sample choices. See when the available evidence supports a preference and when it does not.</p></div><CompareDemo /></div></section>;
}
