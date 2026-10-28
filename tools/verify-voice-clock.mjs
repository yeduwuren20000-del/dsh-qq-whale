import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'verification-data'), { recursive: true })
process.env.DSH_MENTOR_DATA = fs.mkdtempSync(path.join(root, 'verification-data', 'voice-clock-'))
const { replyPreference, deliverQQReply, speechChunks } = await import('../lib/qq-reply.js')
const { ensureVoiceProfile, speechDirection } = await import('../lib/voice-profile.js')
const { clockBlock } = await import('../lib/clock.js')
const { synthesizeVoice, stopPerception } = await import('../lib/perception.js')
const { setSettings, flush } = await import('../lib/store.js')
let count = 0
async function test(name, fn) { await fn(); count++; console.log('PASS', name) }
await test('Explicit voice requests and text restrictions are distinguished from feature discussion', () => {
  for (const s of ['我的语音呢', '用语音给我讲讲', '别打字，发语音', '不要发文字', '给我发一段语音']) assert.equal(replyPreference(s), 'voice')
  for (const s of ['别发语音，我不方便听', '用文字回复']) assert.equal(replyPreference(s), 'text')
  assert.equal(replyPreference('帮我看看语音识别功能'), 'auto')
})
await test('Successful voice delivery sends no preceding or duplicate text', async () => {
  const events = []
  const result = await deliverQQReply({text:'早上好',voicePlan:{}},{synthesize:async()=>{events.push('synthesize');return{file:'fixture'}},sendRecord:async()=>{events.push('voice');return true},sendText:async()=>events.push('text')})
  assert.deepEqual(events, ['synthesize','voice']); assert.equal(result.channel,'voice')
})
await test('Failed voice delivery falls back only after a real failure', async () => {
  const events=[]
  const result=await deliverQQReply({text:'原本要讲的话',voicePlan:{}},{synthesize:async()=>{events.push('failed');throw Error('offline')},sendRecord:async()=>assert.fail(),sendText:async(s)=>events.push(s)})
  assert.equal(result.channel,'fallback'); assert.equal(events[0],'failed');assert.match(events[1],/原本要讲的话/)
})
await test('A partial voice failure does not repeat already delivered content as text', async () => {
  const text='第一部分'.repeat(40)+'。'+'第二部分'.repeat(40)+'。', chunks=speechChunks(text)
  const spoken=[],written=[]
  await deliverQQReply({text,voicePlan:{}},{synthesize:async(s)=>({file:s}),sendRecord:async(s)=>{if(spoken.length)return false;spoken.push(s);return true},sendText:async(s)=>written.push(s)})
  assert.equal(spoken[0],chunks[0]); assert.equal(written.length,1);assert.ok(!written[0].includes(chunks[0]))
})
await test('A song already sent as voice is not sent again as text or TTS', async () => {
  const fail=async()=>assert.fail('Duplicate delivery')
  const result=await deliverQQReply({text:'唱好了',song:{ok:true,sent:4}},{synthesize:fail,sendText:fail,sendRecord:fail})
  assert.equal(result.channel,'song');assert.equal(result.sent,4)
})
await test('Long speech splits without dropping content', () => {
  const text='这段话会分段。'.repeat(100), chunks=speechChunks(text)
  assert.equal(chunks.join(''),text);assert.ok(chunks.every(s=>s.length<=180))
})
await test('Emotion changes delivery while preserving the reference speaker instruction', () => {
  const happy=speechDirection({mood:'开心'}),tired=speechDirection({mood:'疲惫'})
  assert.notEqual(happy,tired);assert.match(happy,/same speaker identity/);assert.match(tired,/same speaker identity/)
})
await test('Voice references cannot be registered with a remote endpoint', async () => {
  await assert.rejects(ensureVoiceProfile({base:'http://10.0.0.1:9000',voice:{id:'fixture'},generate:()=>assert.fail()}),/仅允许/)
})

const requests=[], registrations=[]
const server=http.createServer(async(req,res)=>{
  if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end('{"ok":true,"sample_rate":24000}');return}
  const buffers=[];for await(const b of req)buffers.push(b)
  const body=Buffer.concat(buffers)
  if(req.url==='/v1/voices'){registrations.push(body);res.setHeader('Content-Type','application/json');res.end('{"id":"fixed-whale-reference"}');return}
  assert.equal(req.url,'/v1/audio/speech');requests.push(JSON.parse(body));res.setHeader('X-Sample-Rate','24000');res.end(Buffer.alloc(4800))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
setSettings({breeze:{port:server.address().port},perception:{python:process.env.DSH_TEST_VOICE_PYTHON||'python',voice:'breeze-lazy'}})
try {
  await test('Actual Python requests reuse one reference for different emotional deliveries', async()=>{
    const a=await synthesizeVoice('今天很开心',{mood:'开心'}),b=await synthesizeVoice('我有一点困了',{mood:'疲惫'})
    assert.equal(a.profile,b.profile);assert.equal(requests.length,3)
    assert.equal(requests[0].voice,undefined)
    assert.equal(requests[1].voice,'fixed-whale-reference');assert.equal(requests[2].voice,'fixed-whale-reference')
    assert.equal(requests[1].seed,requests[2].seed);assert.notEqual(requests[1].instructions,requests[2].instructions)
    assert.match(requests[1].instructions,/happy/);assert.match(requests[2].instructions,/tired/)
    assert.equal(registrations.length,2);assert.ok(a.buffer.length>44);assert.ok(b.buffer.length>44)
  })
} finally {stopPerception();flush();await new Promise(r=>server.close(r))}

if(process.env.DSH_HOST_TOOLS){
  const host=createRequire(process.env.DSH_HOST_TOOLS),load=(name)=>import(pathToFileURL(host.resolve(name)))
  const [{Context},{default:SystemPrompt},{createScope}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-system-prompt'),load('@deepseek-ai/dsh-scope')])
  const ctx=new Context();await ctx.plugin(SystemPrompt)
  const agent={},scope=createScope(ctx,agent)
  try {
    await test('Real host runtime context refreshes across midnight and morning requests',async()=>{
      let now=Date.parse('2026-10-27T15:34:00Z')
      scope.ctx.get('systemPrompt').context({name:'mentor:clock',order:130,text:()=>clockBlock(now)})
      const first=await ctx.systemPrompt.assemble({scope:agent})
      assert.match(first.contexts.find(x=>x.name==='mentor:clock').text,/2026-10-27 23:34/)
      now=Date.parse('2026-10-28T00:00:00Z')
      const next=await ctx.systemPrompt.assemble({scope:agent})
      const value=next.contexts.find(x=>x.name==='mentor:clock').text
      assert.match(value,/2026-10-28 08:00/);assert.match(value,/上午/);assert.doesNotMatch(value,/23:34/)
    })
  } finally {await scope.dispose()}
}
console.log(`VERIFIED ${count} clock and voice delivery checks; isolated media and no real QQ messages`)
