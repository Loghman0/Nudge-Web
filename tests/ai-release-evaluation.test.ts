import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { aiReleaseCases,evaluateAiReleaseCase } from '../scripts/lib/ai-release-evaluation';

describe('finite local AI release contracts (synthetic providers, no live accuracy claim)',()=>{
  it('keeps at least 100 uniquely identified fixed cases across all trust boundaries',()=>{
    assert.equal(aiReleaseCases.length,136);
    assert.equal(new Set(aiReleaseCases.map(test=>test.fixture.id)).size,136);
    assert.deepEqual(Object.fromEntries(['grounding','decoders','criteria','privacy','scope'].map(group=>[group,aiReleaseCases.filter(test=>test.group===group).length])),{grounding:40,decoders:24,criteria:24,privacy:32,scope:16});
  });
  for(const test of aiReleaseCases)it(test.fixture.id,async()=>{await evaluateAiReleaseCase(test);});
});
