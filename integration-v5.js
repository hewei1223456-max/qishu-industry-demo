(() => {
'use strict';
const Q=window.Q;
const previousRoute=Q.access.canRoute,previousGuest=Q.access.guestView;
Q.access.canRoute=r=>['tools','industry'].includes(r)||previousRoute(r);
Q.access.guestView=(r,a=[])=>['tools','industry'].includes(r)||(r==='info'&&a[0]==='industry')?null:previousGuest(r,a);
const toolActions=new Set(['copy-tool','download-tool','use-topic','tele-start','tele-pause','tele-reset','tele-full','download-poster','watermark-download','move-shot','video-preview','download-video-plan','download-bg']);
const previousAction=Q.access.guardAction,previousSubmit=Q.access.guardSubmit;
Q.access.guardAction=(a,d={})=>{
 if(a.startsWith('industry-v5-')||a.startsWith('video-v5-'))return true;
 if(Q.route==='tools'&&toolActions.has(a))return true;
 return previousAction(a,d);
};
Q.access.guardSubmit=(id,f)=>{
 if(id.startsWith('industry-v5-')||id.startsWith('video-v5-'))return true;
 if(Q.route==='tools'&&id.startsWith('tool-'))return true;
 return previousSubmit(id,f);
};
const parent=Q.access.parent;
Q.access.parent=(r,a)=>r==='industry'?['返回行业资讯','info/industry']:parent(r,a);
})();
