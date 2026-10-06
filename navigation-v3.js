(() => {
'use strict';
const Q=window.Q;let record;
try{record=JSON.parse(sessionStorage.getItem('qishu-nav-v3')||'null')}catch{}
record||={sid:'nav'+Date.now(),entries:[],cursor:-1};
let targetY=0,firstObservation=true,restoring=false;
// Keep the browser from restoring a prior page's scroll after our hash router.
if('scrollRestoration' in history)history.scrollRestoration='manual';
const save=()=>{try{sessionStorage.setItem('qishu-nav-v3',JSON.stringify(record))}catch{}};
function observe(raw){const state=history.state?.qishu;if(firstObservation){firstObservation=false;if(!state||state.sid!==record.sid||record.entries[state.index]?.hash!==raw)record={sid:'nav'+Date.now()+Math.random().toString(36).slice(2,6),entries:[],cursor:-1}}if(state?.sid===record.sid&&record.entries[state.index]?.hash===raw){record.cursor=state.index;targetY=record.entries[record.cursor].y||0;return}if(record.entries[record.cursor]?.hash===raw)return;record.entries=record.entries.slice(0,record.cursor+1);record.entries.push({hash:raw,y:0});record.cursor++;targetY=0;history.replaceState({...history.state,qishu:{sid:record.sid,index:record.cursor}},'');save()}
function fallback(){const r=Q.route,a=Q.args;if(['login','auth','rights','home'].includes(r))return 'home';if(['gathering','gatherings'].includes(r))return 'gatherings';if(r==='community'&&a.length)return 'community';if(['manufacturer','ops','creator'].includes(r)&&a.length)return r;return Q.access.parent(r,a)?.[1]||({product:'sources',supplier:'sources',publish:'creator',tools:'tools',checkout:'orders',ugc:'info',person:'peers',study:'study',groupbuy:'sources',fairs:'sources'}[r])||'home'}
function back(){if(['login','auth'].includes(Q.route)&&Q.identity.stepBack())return;if(record.cursor>0){history.back();return}Q.navigate(fallback())}
window.addEventListener('scroll',()=>{const raw=(location.hash||'#/home').replace(/^#\/?/,'').split('?')[0];if(!restoring&&record.entries[record.cursor]?.hash===raw){record.entries[record.cursor].y=window.scrollY;save()}},{passive:true});
function afterHash(){const y=targetY;restoring=true;window.scrollTo({top:y,left:0,behavior:'instant'});requestAnimationFrame(()=>{window.scrollTo({top:y,left:0,behavior:'instant'});restoring=false;if(record.entries[record.cursor]){record.entries[record.cursor].y=y;save()}})}
Q.history={observe,afterHash,back};
Q.backControl=()=>`<div class="universal-return"><button class="btn ghost sm" data-action="app-back">‹ 返回上一步</button><a href="#/home">回到首页</a><a href="#/rights">账号权益</a></div>`;
Q.modules.unshift({action:a=>{if(a==='app-back'){back();return true}return false}});
})();
