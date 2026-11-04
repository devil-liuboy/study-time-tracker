/* Pure chart data transforms. All calendar boundaries use Beijing time (UTC+8). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StudyCharts=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400, OFFSET=8*3600;
  const PALETTE=['#2878e4','#8862d4','#35a18b','#eb9a43','#db6c87','#5d94aa','#7380c7','#b67d50','#609966','#a76c9f'];
  const finite=value=>Number.isFinite(Number(value))?Number(value):0;
  function colorFor(key){
    let hash=2166136261;
    for(const char of String(key??'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
    return PALETTE[(hash>>>0)%PALETTE.length];
  }
  function categoryLabel(value){
    const map={ai:'AI 助手',agent:'AI 助手',coding:'编程开发',development:'编程开发',research:'论文研究',notes:'笔记整理',reading:'文献阅读',docs:'技术文档',academic:'学术检索',website:'学习网站',other:'其他学习'};
    return map[value]||String(value||'其他学习');
  }
  function sourceKey(row){return String(row.source_id||`${row.kind||'app'}:${row.name||'未命名来源'}`);}
  function buildDistribution(sessions,options={}){
    const groupBy=options.groupBy==='category'?'category':'source';
    const limit=Number.isFinite(Number(options.limit))?Math.max(1,Math.floor(Number(options.limit))):5;
    const groups=new Map(),sources=new Set();
    let total=0,manual=0,pending=0,manualCount=0;
    for(const row of Array.isArray(sessions)?sessions:[]){
      if(!row||typeof row!=='object')continue;
      const seconds=finite(row.seconds);
      if(row.manual||row.kind==='manual'){manual+=seconds;manualCount++;continue;}
      if(seconds<=0)continue;
      const sid=sourceKey(row),name=groupBy==='category'?categoryLabel(row.category):String(row.name||'未命名来源');
      const id=groupBy==='category'?`category:${name}`:`source:${sid}`;
      const item=groups.get(id)||{id,name,seconds:0,color:colorFor(id),kind:groupBy==='category'?'category':row.kind||'app'};
      item.seconds+=seconds;groups.set(id,item);sources.add(sid);total+=seconds;
      if(row.pending)pending+=seconds;
    }
    // Resolve palette collisions by stable source identity before sorting by time.
    // Changing durations or the top-N limit therefore never swaps source colors.
    const usedColors=new Set();
    [...groups.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).forEach((item,index)=>{
      let color=item.color;
      if(usedColors.has(color))color=PALETTE.find(candidate=>!usedColors.has(candidate));
      if(!color){let hue=(index*137.508)%360;color=`hsl(${hue.toFixed(3)}, 49%, 49%)`;while(usedColors.has(color)){hue=(hue+37.019)%360;color=`hsl(${hue.toFixed(3)}, 49%, 49%)`;}}
      item.color=color;usedColors.add(color);
    });
    const all=[...groups.values()].sort((a,b)=>b.seconds-a.seconds||(a.id<b.id?-1:a.id>b.id?1:0));
    const items=all.slice(0,limit);
    if(all.length>limit)items.push({id:'other',name:'其他',kind:'other',seconds:all.slice(limit).reduce((sum,row)=>sum+row.seconds,0),color:'#a3adbd'});
    for(const item of items)item.percent=total>0?item.seconds/total*100:0;
    return {items,total_seconds:total,manual_seconds:manual,manual_count:manualCount,pending_seconds:pending,source_count:sources.size,group_count:all.length};
  }
  function parseDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new RangeError('日期须为 YYYY-MM-DD');
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new RangeError('日期无效');
    return date.getTime()/1000;
  }
  function dateString(utcMidnight){return new Date(utcMidnight*1000).toISOString().slice(0,10);}
  function beijingDate(epoch){return new Date((epoch+OFFSET)*1000).toISOString().slice(0,10);}
  function pendingByDay(sessions){
    const result=new Map();
    for(const row of Array.isArray(sessions)?sessions:[]){
      if(!row||!row.pending||row.manual||row.kind==='manual')continue;
      const seconds=Math.max(0,finite(row.seconds));if(!seconds)continue;
      const start=Number(row.start),end=Number(row.end);
      if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=DAY*366){
        let left=start;
        const ratio=seconds/(end-start);
        while(left<end){
          const right=Math.min(end,(Math.floor((left+OFFSET)/DAY)+1)*DAY-OFFSET);
          const day=beijingDate(left);
          result.set(day,(result.get(day)||0)+(right-left)*ratio);
          left=right;
        }
      }else if(typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)){
        result.set(row.date,(result.get(row.date)||0)+seconds);
      }
    }
    return result;
  }
  function buildCalendar(daily,sessions,options={}){
    const today=options.today||beijingDate(Date.now()/1000),todayUTC=parseDate(today);
    let start=todayUTC,end=todayUTC;
    const anchor=new Date(todayUTC*1000);
    if(options.range==='week'){
      start=todayUTC-((anchor.getUTCDay()+6)%7)*DAY;end=start+6*DAY;
    }else if(options.range==='month'){
      start=Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),1)/1000;
      end=Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0)/1000;
    }else if(options.range==='custom'){
      start=parseDate(options.start||today);end=parseDate(options.end||today);
      if(end<start||end-start>DAY*365)throw new RangeError('日期范围须在 1 到 366 天之间');
    }
    const sums=new Map();
    for(const row of Array.isArray(daily)?daily:[]){if(row&&typeof row.date==='string')sums.set(row.date,(sums.get(row.date)||0)+finite(row.seconds));}
    const pending=pendingByDay(sessions),days=[];
    let total=0,elapsed=0,active=0,best=null,max=0;
    for(let stamp=start;stamp<=end;stamp+=DAY){
      const date=dateString(stamp),future=date>today,seconds=future?null:(sums.get(date)||0);
      const day={date,seconds,pending_seconds:future?0:Math.min(Math.max(0,seconds),Math.max(0,pending.get(date)||0)),is_future:future,is_today:date===today};
      days.push(day);
      if(future)continue;
      elapsed++;total+=seconds;max=Math.max(max,seconds);
      if(seconds>0){active++;if(!best||seconds>best.seconds)best={date,seconds};}
    }
    return {days,total_seconds:total,average_seconds:elapsed?total/elapsed:0,best_day:best,active_days:active,elapsed_days:elapsed,max_seconds:max};
  }
  function formatDuration(value,options={}){
    const number=finite(value),negative=number<0,seconds=Math.round(Math.abs(number));
    const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
    const text=hours?`${hours} 小时 ${minutes} ${options.compact?'分':'分钟'}`:minutes?`${minutes} ${options.compact?'分':'分钟'}`:`${seconds} 秒`;
    return (negative?'−':'')+text;
  }
  return {buildDistribution,buildCalendar,formatDuration,colorFor,categoryLabel};
});
