import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { resolveExecutable } from '../lib/chromium.js'
import { sanitizePersona } from '../lib/persona.js'

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'verification-data','persona-preview')
fs.mkdirSync(output,{recursive:true})
const fixture=sanitizePersona({name:'大肥鱼',dims:{voice:{tone:'自然，会温柔地吐槽',signature:'A_long_personality_value_'.repeat(5)},runtime:{temperature:0,reinforceOpening:false}}})
const code=fs.readFileSync(path.join(root,'client/client.js'),'utf8')
let posts=0,failPost=false
const self={identity:'喜欢把事情慢慢做好，也愿意说自己的看法。',voice:'熟悉时自然地吐槽，遇到正事会认真。',understandingOfUser:'对方已经做决定时，照他的决定办。'}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost')
  if(url.pathname==='/react.js'||url.pathname==='/react-dom.js'){
    res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(process.env.DSH_TEST_REACT_DIR||path.join(root,'node_modules'),url.pathname==='/react.js'?'react/umd/react.development.js':'react-dom/umd/react-dom.development.js')));return
  }
  if(url.pathname==='/client.js'){res.setHeader('Content-Type','text/javascript');res.end(code);return}
  if(url.pathname.endsWith('/persona/grow')){
    res.setHeader('Content-Type','application/json')
    if(req.method==='POST'){
      posts++
      if(failPost){res.statusCode=503;res.end('{"ok":false,"error":"暂时无法整理"}');return}
      res.end(JSON.stringify({ok:true,status:{grown:true,updatedAt:Date.now(),self:{...self,identity:'新经历让我更愿意先核对事实。'},growthLog:[]}}));return
    }
    res.end(JSON.stringify({ok:true,grown:true,updatedAt:Date.now()-86400000,self,growthLog:[]}));return
  }
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.end(`<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><div id="root"></div>
  <script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(d){window.design=d.factory(()=>React).__design}};</script><script src="/client.js"></script><script>
  const h=React.createElement,params=new URLSearchParams(location.search),sample=${JSON.stringify(fixture)};window.saved=[];
  const style=document.createElement('style');style.textContent=design.CSS;document.head.append(style);
  function Fixture(){const [persona,setPersona]=React.useState(params.has('loading')?null:sample);return h('div',{className:'dm-page dm-shell'},h('div',{className:'dm-panel'},h(design.PersonaDrawer,{persona,presets:[],setup:{done:true,personaSource:params.has('preset')?'preset':'memory',personaLocked:!params.has('preset')},onClose(){},onRetry(){setPersona(sample)},onSave:async(args)=>{window.saved.push(args);setPersona({...sample,...args.patch});return sample}})))}
  ReactDOM.createRoot(document.getElementById('root')).render(h(Fixture));</script>`)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({executablePath:resolveExecutable(),headless:true})
const errors=[];let checks=0
const pass=(name)=>{checks++;console.log('PASS',name)}
try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message))
  const base=`http://127.0.0.1:${server.address().port}`
  if(!process.argv.includes('--loading-only')) {
  for(const width of [1100,390]){
    await page.setViewportSize({width,height:820});await page.goto(base)
    await page.getByText(self.identity,{exact:true}).waitFor()
    assert.equal(await page.locator('.dm-drawer-tabs button').count(),7)
    await page.getByText(/消耗 token/).waitFor()
    assert.equal(await page.getByText('重新生长一次',{exact:true}).count(),0)
    await page.screenshot({path:path.join(output,`overview-${width}.png`)})
    const dimensions=await page.evaluate(()=>design.DIM_IDS.map(id=>({id,label:design.PERSONA_SCHEMA[id].label,count:design.PERSONA_SCHEMA[id].fields.length})))
    let fields=0
    for(const dim of dimensions){
      await page.locator('.dm-drawer-tabs').getByRole('button',{name:dim.label,exact:true}).click()
      assert.equal(await page.locator('[data-persona-field]').count(),dim.count)
      assert.equal(await page.locator('.dm-dbody input,.dm-dbody textarea,.dm-dbody select').count(),0)
      assert.equal(await page.getByRole('button',{name:'保存',exact:true}).count(),0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      fields+=dim.count
      if(dim.id==='voice'){
        await page.getByText('自然，会温柔地吐槽',{exact:true}).waitFor()
        await page.screenshot({path:path.join(output,`voice-${width}.png`)})
      }
      if(dim.id==='runtime'){
        assert.equal(await page.locator('[data-persona-field=temperature] .dm-field-value').textContent(),'0')
        assert.equal(await page.locator('[data-persona-field=reinforceOpening] .dm-field-value').textContent(),'关闭')
      }
    }
    assert.equal(fields,41);assert.equal(await page.evaluate(()=>window.saved.length),0)
    pass(`Locked memory card exposes all six dimensions and 41 read-only values (${width}px)`)
    await page.locator('.dm-drawer-tabs').getByRole('button',{name:'概览',exact:true}).click()
    const before=posts
    await page.getByRole('button',{name:'根据最近经历更新',exact:true}).click()
    await page.getByText('新经历让我更愿意先核对事实。',{exact:true}).waitFor()
    assert.equal(posts,before+1);assert.equal(await page.evaluate(()=>window.saved.length),0)
    pass('Updating growth calls only the growth endpoint and preserves the six-dimensional baseline')
  }
  await page.goto(base);await page.getByText(self.identity,{exact:true}).waitFor();failPost=true
  await page.getByRole('button',{name:'根据最近经历更新',exact:true}).click()
  await page.getByText(/这次没能更新，现有记录已保留/).waitFor()
  assert.equal(await page.getByText(self.identity,{exact:true}).count(),1);failPost=false
  pass('Failed growth updates keep the old understanding visible and explain the failure')
  await page.goto(`${base}/?preset`);await page.locator('.dm-drawer-tabs').getByRole('button',{name:'身份',exact:true}).click()
  await page.locator('.dm-field').filter({hasText:'名字'}).first().locator('input').fill('新的名字')
  await page.getByRole('button',{name:'保存',exact:true}).click()
  await page.waitForFunction(()=>window.saved.length===1)
  assert.equal(await page.evaluate(()=>window.saved[0].patch.dims.identity.name),'新的名字')
  pass('An unlocked preset remains editable even after onboarding')
  }
  await page.goto(`${base}/?loading`);await page.getByRole('status').filter({hasText:'性格卡还没加载出来。'}).waitFor()
  await page.getByRole('button',{name:'重新加载',exact:true}).click()
  await page.locator('.dm-drawer-tabs').getByRole('button',{name:'身份',exact:true}).click()
  assert.equal(await page.locator('[data-persona-field]').count(),5)
  pass('An unloaded card has a recovery action instead of invented empty values')
  assert.deepEqual(errors,[])
  console.log(`VERIFIED ${checks} persona UI checks; screenshots: ${output}`)
}finally{await browser.close();server.close()}
