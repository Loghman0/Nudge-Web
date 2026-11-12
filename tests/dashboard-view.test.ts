import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { DashboardView, type DashboardViewProps } from "../src/components/app/dashboard-view";

const empty: DashboardViewProps = {
  firstName: "Tester", greeting: "Good morning", decisionCount: 0, recentCount: 0,
  tip: { text: "Compare two options.", a: "Eat in", b: "Eat out" }, reflection: null, decisions: [],
};
function documentFor(props: DashboardViewProps) {
  return new JSDOM(renderToStaticMarkup(createElement(DashboardView, props))).window.document;
}
describe("dashboard evidence and destinations", () => {
  it("shows empty history honestly and keeps optional tools reachable", () => {
    const doc = documentFor(empty);
    assert.equal(doc.querySelector("meter"), null);
    assert.equal(doc.querySelector(".dh-reflection"), null);
    assert.equal(doc.querySelector(".dh-milestones"), null);
    assert.match(doc.body.textContent ?? "", /No outcome to show yet/);
    assert.match(doc.body.textContent ?? "", /Your next choice starts the story/);
    for (const route of ["/ask", "/discover", "/history", "/analytics", "/groups", "/profile", "/notifications", "/onboarding"])
      assert.ok(doc.querySelector(`a[href="${route}"]`), route);
    assert.deepEqual([...doc.querySelectorAll(".dh-stat-value")].map(x => x.textContent), ["0", "0"]);
  });
  it("encodes comparison options and links directly to both recent and due records", () => {
    const doc = documentFor({ ...empty, tip: { text: "Saved preference", a: "Tea & cake", b: "Soup / salad" }, decisions: [{ id: "choice-123", question: "<script>bad()</script>", status: "decided", category: "food" }], reflection: { id: "due-456", question: "Tea or coffee?" } });
    const comparison = doc.querySelector<HTMLAnchorElement>('a[href^="/ask?"]')!;
    const url = new URL(comparison.getAttribute("href")!, "http://localhost");
    assert.equal(url.searchParams.get("a"), "Tea & cake");
    assert.equal(url.searchParams.get("b"), "Soup / salad");
    assert.ok(doc.querySelector('a[href="/history?decision=choice-123"]'));
    assert.ok(doc.querySelector('.dh-reflection a[href="/history?decision=due-456"]'));
    assert.equal(doc.querySelector("script"), null);
    assert.match(doc.querySelector(".dh-decision-list")?.textContent ?? "", /<script>bad/);
  });
  it("shows the recorded outcome with copy and journal links without predicting success", () => {
    const doc = documentFor({ ...empty, lastOutcome: { id: "outcome-789", question: "Dinner?", chosen: "Soup", rating: 4, decidedAt: "2026-10-23T23:30:00Z" } });
    assert.match(doc.querySelector(".dh-outcome")?.textContent ?? "", /You chose Soup/);
    assert.match(doc.querySelector(".dh-outcome")?.textContent ?? "", /4\/5/);
    assert.match(doc.querySelector(".dh-outcome")?.textContent ?? "", /not a prediction/);
    assert.equal(doc.querySelector("time")?.textContent, "Oct 23, 2026 (UTC)");
    assert.ok(doc.querySelector('a[href="/ask?copy=outcome-789"]'));
    assert.ok(doc.querySelector('a[href="/history?decision=outcome-789"]'));
  });
  it("distinguishes an unavailable outcome from an empty history", () => {
    const doc = documentFor({ ...empty, outcomeUnavailable: true });
    assert.match(doc.body.textContent ?? "", /latest outcome could not be loaded/);
    assert.doesNotMatch(doc.body.textContent ?? "", /No outcome to show yet/);
  });
});
