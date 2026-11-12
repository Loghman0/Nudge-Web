import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../src/lib/services/rate-limit";

describe("checkRateLimit", () => {
  it("allows up to the limit and then blocks", () => {
    const user = `u-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      assert.equal(checkRateLimit(user, "t", 3, 60_000).allowed, true);
    }
    const blocked = checkRateLimit(user, "t", 3, 60_000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
  });

  it("isolates users and actions from each other", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    assert.equal(checkRateLimit(a, "x", 1, 60_000).allowed, true);
    assert.equal(checkRateLimit(a, "x", 1, 60_000).allowed, false);
    // Different user, same action: unaffected.
    assert.equal(checkRateLimit(b, "x", 1, 60_000).allowed, true);
    // Same user, different action: unaffected.
    assert.equal(checkRateLimit(a, "y", 1, 60_000).allowed, true);
  });

  it("frees capacity once the window has passed", async () => {
    const user = `w-${Math.random()}`;
    assert.equal(checkRateLimit(user, "t", 1, 50).allowed, true);
    assert.equal(checkRateLimit(user, "t", 1, 50).allowed, false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(checkRateLimit(user, "t", 1, 50).allowed, true);
  });
});
