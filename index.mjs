#!/usr/bin/env node
import { createInterface } from 'readline'; import { execSync } from 'child_process'; import { readFileSync, writeFileSync } from 'fs';
const tools = {
  bash:  ({cmd})          => { try { return execSync(cmd,{encoding:'utf8',stdio:'pipe'}) } catch(e) { return e.stderr||e.message } },
  read:  ({path})         => readFileSync(path,'utf8'),
  write: ({path,content}) => (writeFileSync(path,content),'ok'),
};
const mkp = (...keys) => ({type:'object',properties:Object.fromEntries(keys.map(k=>[k,{type:'string'}])),required:keys});
const defs = [{name:'bash',description:'run bash cmd',parameters:mkp('cmd')},{name:'read',description:'read a file',parameters:mkp('path')},
  {name:'write',description:'write a file',parameters:mkp('path','content')}].map(f=>({type:'function',function:f}));
async function run(msgs) { while (true) {
    const base = (process.env.OPENAI_BASE_URL||'https://api.openai.com').replace(/\/+$/,'');
    const r = await fetch(`${base}/v1/chat/completions`,{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({model:process.env.MODEL||'gpt-5.4',messages:msgs,tools:defs})}).then(r=>r.json());
    const msg = r.choices?.[0]?.message; if (!msg) throw new Error(JSON.stringify(r));
    msgs.push(msg); if (!msg.tool_calls) return msg.content;
    for (const t of msg.tool_calls) {
      const {name}=t.function, args=JSON.parse(t.function.arguments), dim=s=>`\x1b[90m${s}\x1b[0m`;
      console.log(dim(`⟡ ${name}(${JSON.stringify(args)})`));
      const out=String(tools[name](args)); console.log(dim(out.length>200?out.slice(0,200)+'…':out));
      msgs.push({role:'tool',tool_call_id:t.id,content:out});
    }
  }
}
const SYSTEM = (process.env.SYSTEM_PROMPT || 'You are an autonomous coding agent with bash, read, and write tools.\nExplore first (bash/read to understand codebase), plan, make one change at a time, then verify (test/lint/run). If it fails, diagnose and fix—don\'t retry blindly.\nBe concise—show work via tool calls. Always read before editing. Write complete files. Prefer simple correct solutions. Summarize changes when done.') + `\nCWD: ${process.cwd()}\nDate: ${new Date().toISOString()}`;
const hist = [{role:'system',content:SYSTEM}]; const pIdx = process.argv.indexOf('-p');
if (pIdx !== -1 && process.argv[pIdx+1]) { hist.push({role:'user',content:process.argv[pIdx+1]}); console.log(await run(hist)); process.exit(0);
} else { const rl = createInterface({input:process.stdin,output:process.stdout}); const ask = q => new Promise(r=>rl.question(q,r));
  while (true) { const i = await ask('\n> '); if (i.trim()) { hist.push({role:'user',content:i}); console.log(await run(hist)); } } }
