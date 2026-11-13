import test from 'node:test';
import assert from 'node:assert/strict';

test('catalogue suppresses withdrawn tombstones and status reads actual pause contract',async()=>{
 const m=await import('../public/ui-model.mjs');
 assert.equal(typeof m.visibleCatalogue,'function','tombstone projection missing');
 assert.deepEqual(m.visibleCatalogue({items:[{id:'gone',state:'withdrawn'},{id:'live',productName:'Fixture'}]}),[{id:'live',productName:'Fixture'}]);
 assert.equal(m.intakeLabel({intake:'paused'}),'intake paused');
 assert.equal(m.intakeLabel({intake:'open'}),'private intake');
 assert.equal(m.intakeLabel({}),'intake status unavailable');
});

test('contribution requires rights, adult confirmation and an original label image', async () => {
  let validateDraft;
  try { ({validateDraft} = await import('../public/ui-model.mjs')); } catch {}
  assert.equal(typeof validateDraft, 'function', 'draft validation is not implemented');
  const result = validateDraft({productName:'Test fixture',rightsAccepted:false,adultConfirmed:false,images:[]});
  assert.ok(result.includes('Confirm that you may share these photographs.'));
  assert.ok(result.includes('Confirm that you are at least 18.'));
  assert.ok(result.includes('Add at least one JPEG or PNG label photograph.'));
});

test('submits Nigeria label evidence with fixed terms version and stable retry key', async () => {
  const model=await import('../public/ui-model.mjs');
  assert.equal(typeof model.sendContribution,'function','submission transport missing');
  let sent;
  const result=await model.sendContribution({productName:'Fixture cereal',brand:'Fixture',capturedOn:'2026-11-12',rightsAccepted:true,adultConfirmed:true,images:[{role:'front',dataUrl:'data:image/png;base64,AAAA'}]},'retry-key',async (url,options)=>{
    sent={url,options}; return {ok:true,json:async()=>({id:'fixture-id',receiptToken:'fixture-secret',state:'received_private'})};
  });
  assert.equal(sent.url,'/api/submissions');
  assert.equal(sent.options.headers['Idempotency-Key'],'retry-key');
  const body=JSON.parse(sent.options.body);
  assert.equal(body.market,'Nigeria'); assert.equal(body.termsVersion,'pilot-v1');
  assert.equal(result.state,'received_private');
});

test('idempotent replay without a receipt does not impersonate a newly issued receipt',async()=>{
 const {sendContribution}=await import('../public/ui-model.mjs');
 await assert.rejects(()=>sendContribution({rightsAccepted:true,adultConfirmed:true,images:[{}]},'key',async()=>({ok:true,json:async()=>({id:'existing',state:'received_private',replayed:true})})),/already saved.*receipt/i);
});
