import {validateDraft,sendContribution,visibleCatalogue,intakeLabel} from './ui-model.mjs';
const $=s=>document.querySelector(s);
const form=$('#contribution');
let retryKey=crypto.randomUUID(),receipt=null;
function showError(message){const el=$('#form-error');el.textContent=message;el.hidden=false;el.scrollIntoView({block:'center'});}
function route(){
 const name=location.hash.slice(1)||'contribute';
 const valid=[...document.querySelectorAll('[data-view]')].some(el=>el.dataset.view===name);
 const current=valid?name:'contribute';
 document.querySelectorAll('[data-view]').forEach(el=>el.hidden=el.dataset.view!==current);
 document.querySelectorAll('nav a').forEach(el=>{if(el.hash==='#'+current)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 document.title=`NutriAfrica — ${current==='contribute'?'food label contributions':current}`;
 if(current==='catalogue') loadCatalogue();
}
addEventListener('hashchange',()=>{route();$('#content').focus({preventScroll:true});window.scrollTo(0,0);});route();
async function status(){try{const r=await fetch('/api/status');if(!r.ok)throw Error();const data=await r.json();$('#connection').textContent='Local test service · '+intakeLabel(data);}catch{$('#connection').textContent='Service unavailable · nothing can be saved';}}
status();
form.addEventListener('input',()=>{retryKey=crypto.randomUUID();$('#form-error').hidden=true;});
form.addEventListener('change',()=>{retryKey=crypto.randomUUID();const names=[...form.querySelectorAll('input[type=file]')].flatMap(el=>[...el.files].map(f=>`${f.name} · ${(f.size/1024/1024).toFixed(1)} MB`));$('#selected-images').textContent=names.length?names.join(' / '):'No photographs selected.';});
function readImage(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not read that photograph. Select it again.'));r.readAsDataURL(file);});}
form.addEventListener('submit',async event=>{
 event.preventDefault();$('#form-error').hidden=true;const button=$('#submit');button.disabled=true;button.textContent='Saving privately…';
 try{
  const images=[];
  for(const [name,role] of [['front','front'],['nutrition','nutrition'],['ingredients','ingredients'],['barcodeImage','barcode']]){const file=form.elements[name].files[0];if(!file)continue;if(!['image/jpeg','image/png'].includes(file.type)||file.size>8*1024*1024)throw Error('Use JPEG or PNG photographs no larger than 8 MB each.');images.push({role,dataUrl:await readImage(file)});}
  const data=new FormData(form);const draft={productName:String(data.get('productName')||'').trim(),brand:String(data.get('brand')||'').trim(),city:String(data.get('city')||'').trim(),capturedOn:String(data.get('capturedOn')||''),barcode:String(data.get('barcode')||'').trim(),nafdac:String(data.get('nafdac')||'').trim(),rightsAccepted:form.elements.rightsAccepted.checked,adultConfirmed:form.elements.adultConfirmed.checked,images};
  const errors=validateDraft(draft);if(!draft.productName)errors.unshift('Enter the product name, or “Unknown” if unreadable.');if(!draft.capturedOn)errors.push('Choose the date the photographs were taken.');if(errors.length)throw Error(errors.join(' '));
  receipt=await sendContribution(draft,retryKey);$('#receipt-id').value=receipt.id;$('#receipt-token').value=receipt.receiptToken;form.hidden=true;$('.context').hidden=true;$('#receipt').hidden=false;$('#receipt').focus();$('#receipt').scrollIntoView({block:'start'});
 }catch(error){showError(error.message||'Nothing was saved. Check your connection and retry.');}
 finally{button.disabled=false;button.textContent='Save private contribution';}
});
$('#another').addEventListener('click',()=>{form.reset();form.hidden=false;$('.context').hidden=false;$('#receipt').hidden=true;$('#receipt-id').value='';$('#receipt-token').value='';receipt=null;retryKey=crypto.randomUUID();$('#selected-images').textContent='No photographs selected.';form.elements.productName.focus();});
$('#download-receipt').addEventListener('click',()=>{if(!receipt)return;const url=URL.createObjectURL(new Blob([JSON.stringify({service:'NutriAfrica local contribution pilot',...receipt,warning:'Private: anyone with this token can withdraw the contribution.'},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='nutriafrica-private-receipt.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
async function loadCatalogue(){const target=$('#catalogue-list');target.replaceChildren();$('#catalogue-empty').hidden=true;$('#catalogue-status').textContent='Loading catalogue…';try{const response=await fetch('/api/catalogue');if(!response.ok)throw Error();const data=await response.json();const foods=visibleCatalogue(data);$('#catalogue-status').textContent=`${foods.length} published ${foods.length===1?'product':'products'}`;$('#catalogue-empty').hidden=foods.length>0;for(const food of foods){const article=document.createElement('article');article.className='catalogue-item';const heading=document.createElement('h2');heading.textContent=food.productName||food.name||'Name not documented';article.append(heading);for(const text of [food.brand,food.market,food.capturedOn?`Photographed ${food.capturedOn}`:null,'Label observation · human review required for publication','Physical authenticity not assessed']){if(!text)continue;const p=document.createElement('p');p.textContent=text;article.append(p);}target.append(article);}}catch{$('#catalogue-status').textContent='Could not load the catalogue. No coverage claim can be made. Use Refresh to retry.';}}
$('#refresh').addEventListener('click',loadCatalogue);
$('#withdrawal').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget;const button=f.querySelector('button');button.disabled=true;$('#withdraw-result').textContent='Requesting withdrawal…';try{const response=await fetch('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:f.elements.id.value.trim(),receiptToken:f.elements.receiptToken.value.trim()})});const result=await response.json();if(!response.ok)throw Error(result.error||'Withdrawal failed. Check your private receipt.');$('#withdraw-result').textContent='Contribution withdrawn from the active service.';f.reset();}catch(error){$('#withdraw-result').textContent=error.message||'Could not withdraw. Please retry.';}finally{button.disabled=false;}});
