import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../backend/app.js';
import {Browser} from 'file:///C:/Users/Hassan%20Ismail/AppData/Local/hermes/skills/agents-imports/design-taste-frontend/scripts/lib/cdp.mjs';
const scratch=process.env.TMPDIR||path.join(os.homedir(),'AppData/Local/hermes/cache/scratch');
const dir=await mkdtemp(path.join(scratch,'nutri-fullstack-'));
const adminToken=randomBytes(32).toString('hex');
const app=await createApp({dataDir:dir,publicDir:path.resolve('public'),adminToken});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${app.server.address().port}`;
let browser;const log=[];
async function api(route,body){const r=await fetch(url+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.ok,true,route);return r.json();}
try{
 browser=await Browser.launch();const page=await browser.newPage({width:390,height:844});await page.goto(url);
 const image=await sharp({create:{width:240,height:120,channels:3,background:'#e4eae5'}}).png().toBuffer();
 const base64=image.toString('base64');
 await page.eval(`(()=>{const f=document.querySelector('#contribution');f.elements.productName.value='Synthetic integration fixture';f.elements.brand.value='Fixture only';f.elements.capturedOn.value='2026-11-01';f.elements.rightsAccepted.checked=true;f.elements.adultConfirmed.checked=true;const bytes=Uint8Array.from(atob('${base64}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'synthetic-fixture.png',{type:'image/png'}));f.elements.front.files=dt.files;f.requestSubmit();})()`);
 for(let i=0;i<60;i++){if(await page.eval(`!document.querySelector('#receipt').hidden`))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await page.eval(`document.querySelector('#receipt').hidden`),false,await page.eval(`document.querySelector('#form-error').textContent`));
 const receipt=await page.eval(`({id:document.querySelector('#receipt-id').value,receiptToken:document.querySelector('#receipt-token').value})`);
 assert.equal(receipt.receiptToken.length>20,true);log.push('Browser form saved synthetic evidence and received a private receipt.');
 let catalogue=await (await fetch(url+'/api/catalogue')).json();assert.equal(catalogue.items.length,0);
 const queue=await api('/api/admin/submissions');assert.equal(queue.items.length,1);assert.equal(queue.items[0].id,receipt.id);log.push('Private record visible to authenticated moderator, absent from public catalogue.');
 const adminPage=await browser.newPage({width:1440,height:900});await adminPage.goto(url+'/admin.html');
 assert.equal(await adminPage.eval(`document.querySelector('h1')?.textContent`),'Review label evidence','moderation interface missing');
 await adminPage.eval(`(()=>{document.querySelector('#admin-token').value=${JSON.stringify(adminToken)};document.querySelector('#reviewer').value='Synthetic Test Reviewer';document.querySelector('#unlock').click()})()`);
 for(let i=0;i<30;i++){if(await adminPage.eval(`document.querySelector('[data-open]')!==null`))break;await new Promise(r=>setTimeout(r,100));}
 await adminPage.eval(`document.querySelector('[data-open]').click()`);await new Promise(r=>setTimeout(r,150));
 await adminPage.eval(`document.querySelector('#mark-review').click()`);await new Promise(r=>setTimeout(r,150));
 await adminPage.eval(`(()=>{document.querySelector('#public-name').value='Synthetic integration fixture';document.querySelector('#attest').checked=true;document.querySelector('#publish').click()})()`);await new Promise(r=>setTimeout(r,250));
 assert.match(await adminPage.eval(`document.querySelector('#review-result').textContent`),/published/i);
 await page.eval(`location.hash='catalogue'`);await new Promise(r=>setTimeout(r,250));
 assert.equal(await page.eval(`document.querySelector('#catalogue-status').textContent`),'1 published product');
 assert.equal(await page.eval(`document.querySelector('#catalogue-list').textContent.includes('Synthetic integration fixture')`),true);log.push('Named API review/publication rendered an explicit factual projection in browser catalogue. Fixture not a real reviewed food.');
 await page.eval(`location.hash='withdraw'`);await new Promise(r=>setTimeout(r,100));
 await page.eval(`(()=>{const f=document.querySelector('#withdrawal');f.elements.id.value=${JSON.stringify(receipt.id)};f.elements.receiptToken.value=${JSON.stringify(receipt.receiptToken)};f.elements.confirm.checked=true;f.requestSubmit()})()`);
 for(let i=0;i<30;i++){if((await page.eval(`document.querySelector('#withdraw-result').textContent`)).includes('withdrawn'))break;await new Promise(r=>setTimeout(r,100));}
 assert.match(await page.eval(`document.querySelector('#withdraw-result').textContent`),/withdrawn/);
 assert.deepEqual(await readdir(path.join(dir,'images')),[]);
 await page.eval(`location.hash='catalogue'`);await new Promise(r=>setTimeout(r,250));assert.equal(await page.eval(`document.querySelector('#catalogue-status').textContent`),'0 published products');assert.equal(await page.eval(`document.querySelector('#catalogue-list').children.length`),0);log.push('Browser receipt withdrawal erased active evidence; public tombstone not rendered as a food.');
 assert.equal(await page.eval(`localStorage.length`),0);log.push('No receipt or admin secret persisted in browser localStorage.');
 await mkdir('verification',{recursive:true});await writeFile('verification/fullstack.json',JSON.stringify({passed:true,syntheticOnly:true,checks:log},null,2));console.log(log.map(s=>'PASS: '+s).join('\n'));
} finally{if(browser)await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}
