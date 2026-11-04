'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixedNow = Date.parse('2026-11-04T04:00:00Z'); // Beijing: 2026-11-04 12:00.
const copy = value => JSON.parse(JSON.stringify(value));
const emptyReport = () => ({total_seconds:0,confirmed_seconds:0,pending_seconds:0,items:[],daily:[],sessions:[]});

// A small native-bridge/DOM boundary fixture: no browser, no duplicate chart math.
async function dashboard(report = emptyReport()) {
  const nodes = new Map(), timers = [], windowEvents = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, value:'', dataset:{}, disabled:false, hidden:false, innerHTML:'', textContent:'',
      children:[], isConnected:true, tagName:'DIV', events:new Map(),
      addEventListener(name,handler){this.events.set(name,handler);},
      append(child){this.children.push(child);}, remove(){this.isConnected=false;},
      focus(){document.activeElement=this;}, closest(){return null;},
      querySelector(){return null;},querySelectorAll(){return [];},reportValidity(){return true;},
    });
    return nodes.get(id);
  }
  const document = {
    activeElement:null,
    querySelector(selector){return selector.startsWith('#')?node(selector.slice(1)):null;},
    querySelectorAll(){return [];},addEventListener(){},
    createElement(tag){return {...node(`created-${nodes.size}`),tagName:tag.toUpperCase()};},
  };
  document.activeElement=node('body');
  const calls={getState:[],pause:[],manual:[]};
  const native={report,paused:false};
  const bridge={
    async get_state(options){calls.getState.push(copy(options));return {version:'test',report:copy(native.report),config:{apps:[],websites:[],autostart:false},status:{paused:native.paused,idle_seconds:0,state:'untracked',current_name:'',browser_connected:false}};},
    async set_paused(value){calls.pause.push(value);native.paused=value;return {ok:true};},
    async add_manual(value){calls.manual.push(copy(value));return {ok:true};},
  };
  class FixedDate extends Date {
    constructor(...args){super(...(args.length?args:[fixedNow]));}
    static now(){return fixedNow;}
  }
  const window={addEventListener(name,handler){windowEvents.set(name,handler);},scrollTo(){},innerWidth:1200};
  const context=vm.createContext({document,window,location:{hash:'',search:''},navigator:{},URL,URLSearchParams,
    Intl,Date:FixedDate,console, setTimeout(){return 0;},setInterval(callback){timers.push(callback);return timers.length;}});
  for (const filename of ['charts.js','app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..','web',filename),'utf8'),context,{filename});
  window.pywebview={api:bridge};
  await vm.runInContext('start()',context);
  async function action(name,data={}) {
    const button={dataset:{action:name,...data},disabled:false,isConnected:true};
    await vm.runInContext('runAction',context)(button);
    return button;
  }
  async function openRecords() {
    context.location.hash='#records';
    windowEvents.get('hashchange')();
    await new Promise(resolve=>setImmediate(resolve));
  }
  return {context,node,native,calls,action,openRecords,poll:()=>timers[0](),document};
}

for (const [name,start,end] of [
  ['invalid calendar date','2026-02-30','2026-11-04'],
  ['more than 366 inclusive days','2025-01-01','2026-11-04'],
  ['future end date','2026-11-01','2026-11-05'],
  ['reversed dates','2026-11-04','2026-11-01'],
]) {
  test(`${name} never reaches the native report API or replaces the applied range`,async()=>{
    const ui=await dashboard();
    await ui.action('range',{value:'custom'});
    ui.node('range-start').value='2026-11-01';ui.node('range-end').value='2026-11-04';
    await ui.action('apply-range');
    const applied=copy(ui.calls.getState.at(-1)),count=ui.calls.getState.length;
    ui.node('range-start').value=start;ui.node('range-end').value=end;
    await ui.action('apply-range');
    assert.equal(ui.calls.getState.length,count,'invalid input must not trigger a backend request');
    assert.equal(ui.node('pause-button').disabled,false,'validation must not disable pause control');
    assert.equal(vm.runInContext('appState.connected',ui.context),true,'validation is not a service failure');
    await ui.poll();
    assert.deepEqual(ui.calls.getState.at(-1),applied,'the next poll must still use the last applied dates');
    await ui.node('pause-button').events.get('click')({currentTarget:ui.node('pause-button')});
    assert.deepEqual(ui.calls.pause,[true],'the pause action remains functional after validation failure');
  });
}

test('the 366-day inclusive boundary is accepted without off-by-one rejection',async()=>{
  const ui=await dashboard();
  await ui.action('range',{value:'custom'});
  ui.node('range-start').value='2025-11-04';ui.node('range-end').value='2026-11-04';
  await ui.action('apply-range');
  assert.deepEqual(ui.calls.getState.at(-1),{range:'custom',start:'2025-11-04',end:'2026-11-04'});
});

test('a future manual date is rejected even when HTML form validation is bypassed',async()=>{
  const ui=await dashboard();
  ui.node('manual-date').value='2026-11-05';ui.node('manual-minutes').value='15';
  ui.node('manual-name').value='Future correction';ui.node('manual-category').value='research';
  await ui.action('save-manual');
  assert.equal(ui.calls.manual.length,0);
  assert.equal(vm.runInContext('appState.connected',ui.context),true);
});

function provisionalReport() {
  return {total_seconds:30,confirmed_seconds:0,pending_seconds:30,items:[],daily:[],sessions:[{
    id:'pending-0',source_id:'app:editor',name:'Provisional editor',kind:'app',category:'coding',
    seconds:30,start:fixedNow/1000-30,end:fixedNow/1000,manual:false,pending:true,
  }]};
}
test('records polling removes a rolled-back provisional session without navigation',async()=>{
  const ui=await dashboard(provisionalReport());
  await ui.openRecords();
  assert.match(ui.node('content').innerHTML,/Provisional editor/);
  assert.match(ui.node('content').innerHTML,/待确认/);
  ui.native.report=emptyReport();
  await ui.poll();
  assert.doesNotMatch(ui.node('content').innerHTML,/Provisional editor/);
  assert.match(ui.node('content').innerHTML,/暂无记录/);
});

test('records refresh waits for active editing and an open modal to finish',async()=>{
  const ui=await dashboard(provisionalReport());
  await ui.openRecords();
  ui.native.report=emptyReport();
  ui.document.activeElement={tagName:'INPUT',closest(){return null;}};
  await ui.poll();
  assert.match(ui.node('content').innerHTML,/Provisional editor/,'typing must not be interrupted');
  ui.document.activeElement=ui.node('body');ui.node('modal-root').children=[{}];
  await ui.poll();
  assert.match(ui.node('content').innerHTML,/Provisional editor/,'open modal must not be replaced by polling');
  ui.node('modal-root').children=[];
  await ui.poll();
  assert.doesNotMatch(ui.node('content').innerHTML,/Provisional editor/);
});
