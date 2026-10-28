import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
fs.mkdirSync(path.join(root,'verification-data'),{recursive:true})
process.env.DSH_MENTOR_DATA=fs.mkdtempSync(path.join(root,'verification-data','conversation-'))
const {buildConversationBlock}=await import('../lib/conversation.js')
const {buildGrowthBlock}=await import('../lib/growth.js')
const {buildPersonaBlock,defaultPersona}=await import('../lib/persona.js')
const now=Date.parse('2026-10-28T00:00:00Z')
const msg=(text,age=1000,role='user')=>({role,text,at:now-age})
let checks=0
function test(name,run){run();checks++;console.log('PASS',name)}
test('Recent fatigue and current obligations are considered together',()=>{
  const value=buildConversationBlock('但还得上课啊',[msg('行，困死了')],now)
  assert.match(value,/困或累/);assert.match(value,/别一律催睡/)
})
test('Last night and assistant guesses do not become the current user state',()=>{
  assert.equal(buildConversationBlock('早上好',[msg('我很困',8*3600000),msg('你应该很困',1000,'mentor')],now),'')
})
test('An explicit recovery supersedes previous fatigue',()=>{
  assert.equal(buildConversationBlock('我现在不困了，已经好了',[msg('困死了')],now),'')
})
test('Quoted speech and image interpretations are not treated as user feelings',()=>{
  assert.equal(buildConversationBlock('他说“我很困”',[],now),'')
  assert.equal(buildConversationBlock('[表情包]\n[表情包内容（本地视觉识别）：人物说我很困]',[],now),'')
})
test('A correction calls for verification rather than a relationship judgement',()=>{
  assert.match(buildConversationBlock('你刚才的时间说错了',[],now),/先核对并修正事实/)
})
test('Temporary distress stays temporary and cue context remains small',()=>{
  const value=buildConversationBlock('我很难过，也好累，还得赶报告',[],now)
  assert.match(value,/暂时收起讨白饭/);assert.match(value,/不推断长期性格/);assert.ok(value.length<500)
})
test('Existing personality data stays unchanged',()=>{
  const card=defaultPersona(),before=JSON.stringify(card)
  assert.match(buildPersonaBlock(card),/稳定的身份与行为基线/)
  buildConversationBlock('困死了',[msg('还得上班')],now)
  assert.equal(JSON.stringify(card),before)
  // An unformed growth card contributes no boilerplate to every chat turn.
  assert.equal(buildGrowthBlock(),'')
})
console.log(`VERIFIED ${checks} conversation checks; no model calls or real memory writes`)
