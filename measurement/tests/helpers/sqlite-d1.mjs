import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function sqliteD1({ through = null, transform = null } = {}) {
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe') : 'python3');
  const child = spawn(python, ['-u', fileURLToPath(new URL('./sqlite-d1.py', import.meta.url))], { stdio: ['pipe','pipe','inherit'], windowsHide: true });
  let sequence = 0; const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => { const response=JSON.parse(Buffer.from(line,'base64').toString('utf8')),p=pending.get(response.id);pending.delete(response.id);response.error?p.reject(new Error(response.error)):p.resolve(response.value); });
  const send = body => new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(Buffer.from(JSON.stringify({id,...body}),'utf8').toString('base64')+'\n');});
  child.on('error',error=>{for(const p of pending.values())p.reject(error);});
  const db = { prepare(sql) { const statement = { sql,args:[],bind(...args){this.args=args;return this;},async run(){return (await send({statements:[{sql:this.sql,args:this.args}]}))[0];},async all(){return this.run();},async first(){return (await this.run()).results[0]||null;}};return statement; },
    async batch(statements){return send({statements:statements.map(s=>({sql:s.sql,args:s.args}))});},
    async applySchema(sql){return send({schema:sql});},close(){child.stdin.end();} };
  const dir=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')&&(!through||f<=through)).sort()){
    const source=await readFile(join(dir,file),'utf8');
    await send({schema:transform?transform(file,source):source});
  }
  return db;
}
