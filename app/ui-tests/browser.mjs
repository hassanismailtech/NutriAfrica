import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Browser} from 'file:///C:/Users/Hassan%20Ismail/AppData/Local/hermes/skills/agents-imports/design-taste-frontend/scripts/lib/cdp.mjs';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(req.url.includes('catalogue')?{items:[]}:{mode:'local-preview',intakeOpen:true}));}
 const name=req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0].slice(1);
 if(!/^[\w.-]+$/.test(name)){res.writeHead(404);return res.end();}
 try{const body=await readFile(root+name);res.setHeader('Content-Type',name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.ttf')?'font/ttf':'text/html');res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await Browser.launch();const page=await browser.newPage({width:390,height:844});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.eval(`location.hash='catalogue'`);await new Promise(r=>setTimeout(r,300));
 assert.equal(await page.eval(`document.querySelector('[data-view="catalogue"]').hidden`),false,'catalogue navigation should reveal the catalogue view');
 assert.equal(await page.eval(`document.querySelector('[data-view="contribute"]').hidden`),true);
 await page.eval(`location.hash='contribute'`);await new Promise(r=>setTimeout(r,100));
 await page.eval(`document.querySelector('#contribution').requestSubmit()`);await new Promise(r=>setTimeout(r,100));
 assert.equal(await page.eval(`document.querySelector('#form-error').hidden`),false,'invalid submission needs an accessible error');
 assert.equal(await page.eval(`document.documentElement.scrollWidth<=innerWidth`),true,'phone must not overflow');
 console.log('PASS: real Chrome navigation, invalid submission, phone overflow (isolated API test fixtures, not persistence)');
} finally {if(browser) await browser.close();await new Promise(r=>server.close(r));}
