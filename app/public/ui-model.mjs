export function visibleCatalogue(data) {return (Array.isArray(data)?data:(data.items||[])).filter(item=>item.state!=='withdrawn');}
export function intakeLabel(data) {return data.intake==='paused'?'intake paused':data.intake==='open'?'private intake':'intake status unavailable';}

export function validateDraft(draft) {
  const errors=[];
  if (!draft.rightsAccepted) errors.push('Confirm that you may share these photographs.');
  if (!draft.adultConfirmed) errors.push('Confirm that you are at least 18.');
  if (!draft.images?.length) errors.push('Add at least one JPEG or PNG label photograph.');
  return errors;
}

export async function sendContribution(draft,key,request=fetch) {
  const problems=validateDraft(draft);
  if(problems.length) throw new Error(problems.join(' '));
  const response=await request('/api/submissions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({...draft,market:'Nigeria',termsVersion:'pilot-v1'})});
  const result=await response.json();
  if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'The submission was not saved. Please try again.');
  if(result.replayed && !result.receiptToken) throw new Error('This contribution was already saved. Keep your original private receipt. If the first response was lost, this preview cannot recover its token; do not resubmit a duplicate.');
  return result;
}
