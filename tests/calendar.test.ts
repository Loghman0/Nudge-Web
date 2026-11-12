import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {calendarDay,journalDate} from '../src/lib/services/calendar';
describe('account calendar boundaries',()=>{
 it('renders journal labels in the explicit account zone regardless of host timezone',()=>{
  const previous=process.env.TZ;
  try{
   process.env.TZ='UTC';const server=journalDate('2026-10-14T21:30:00Z','Asia/Baku');
   process.env.TZ='America/Los_Angeles';assert.equal(journalDate('2026-10-14T21:30:00Z','Asia/Baku'),server);
   assert.equal(server,'Oct 15, 2026');
   assert.equal(journalDate('2026-10-14T21:30:00Z','bad/zone'),journalDate('2026-10-14T21:30:00Z','UTC'));
   assert.equal(journalDate('invalid','UTC'),'Unknown date');
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 });
 it('uses the account date and weekday instead of the server zone',()=>{
  assert.deepEqual(calendarDay('2026-10-14T21:30:00Z','Asia/Baku'),{date:'2026-10-15',weekday:4});
  assert.deepEqual(calendarDay('2026-10-14T21:30:00Z','Europe/Istanbul'),{date:'2026-10-15',weekday:4});
  assert.deepEqual(calendarDay('2026-10-14T21:30:00Z','UTC'),{date:'2026-10-14',weekday:3});
 });
 it('handles DST, invalid zones and invalid timestamps',()=>{
  assert.deepEqual(calendarDay('2026-03-08T06:59:00Z','America/New_York'),{date:'2026-03-08',weekday:0});
  assert.deepEqual(calendarDay('2026-03-08T07:01:00Z','America/New_York'),{date:'2026-03-08',weekday:0});
  assert.deepEqual(calendarDay('2026-10-14T21:30:00Z','bad/zone'),calendarDay('2026-10-14T21:30:00Z','UTC'));
  assert.equal(calendarDay('bad','Asia/Baku'),null);
 });
});
