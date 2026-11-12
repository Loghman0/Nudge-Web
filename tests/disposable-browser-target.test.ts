import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {disposableBrowserTarget} from '../scripts/lib/disposable-browser-target.mjs';

describe('disposable browser host selection',()=>{
  it('keeps local verification as the default',()=>{
    assert.deepEqual(disposableBrowserTarget({}),{external:false,baseURL:'http://127.0.0.1:3117'});
  });
  it('accepts only an explicitly matched external HTTPS origin',()=>{
    assert.deepEqual(disposableBrowserTarget({NUDGE_E2E_EXTERNAL:'1',NUDGE_E2E_BASE_URL:'https://demo.example/',NUDGE_E2E_AUTHORIZED_ORIGIN:'https://demo.example'}),{external:true,baseURL:'https://demo.example'});
    assert.throws(()=>disposableBrowserTarget({NUDGE_E2E_EXTERNAL:'1',NUDGE_E2E_BASE_URL:'https://other.example',NUDGE_E2E_AUTHORIZED_ORIGIN:'https://demo.example'}),/does not match/);
  });
  it('rejects missing authorization, credentials, paths and unsafe transport',()=>{
    const fixture={NUDGE_E2E_EXTERNAL:'1',NUDGE_E2E_BASE_URL:'https://demo.example',NUDGE_E2E_AUTHORIZED_ORIGIN:'https://demo.example'};
    for(const value of [undefined,'','http://demo.example','https://user:secret@demo.example','https://demo.example/login','https://demo.example?token=private','https://demo.example/#private']){
      assert.throws(()=>disposableBrowserTarget({...fixture,NUDGE_E2E_BASE_URL:value}));
      assert.throws(()=>disposableBrowserTarget({...fixture,NUDGE_E2E_AUTHORIZED_ORIGIN:value}));
    }
  });
});
