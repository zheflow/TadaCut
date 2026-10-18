export const motionTemplates = {
  lowerThird: {
    name: "人物介绍",
    code: `export default function LowerThird({frame,fps,width,height}) {
  const p=Math.min(1,frame/(fps*.6));
  return <div style={{position:'absolute',left:width*.07,bottom:height*.12,transform:'translateX('+(p-1)*180+'px)',opacity:p,fontFamily:'sans-serif',color:'white'}}><div style={{background:'#a5c78a',width:70,height:6,marginBottom:18}}/><div style={{fontSize:56,fontWeight:700}}>名字 / 主标题</div><div style={{fontSize:28,marginTop:12,opacity:.75}}>在这里写一句介绍</div></div>;
}`,
  },
  countdown: {
    name: "倒计时",
    code: `export default function Countdown({frame,fps}) {const n=Math.max(0,5-Math.floor(frame/fps));const s=1+(1-frame%fps/fps)*.16;return <div style={{width:'100%',height:'100%',display:'grid',placeItems:'center',fontFamily:'sans-serif',fontWeight:700,fontSize:240,color:'#d2e8b6',transform:'scale('+s+')'}}>{n||'GO'}</div>;}`,
  },
  bars: {
    name: "数据图形",
    code: `export default function Bars({frame,fps}) {const p=Math.min(1,frame/(fps*1.4));return <div style={{width:'100%',height:'100%',display:'flex',gap:40,alignItems:'flex-end',justifyContent:'center',padding:120,boxSizing:'border-box',color:'white',fontFamily:'sans-serif'}}>{[.4,.7,1].map((v,i)=><div key={i} style={{width:140,height:520*v*p,background:['#b6cc99','#93b5ab','#758fa5'][i],borderRadius:18,display:'flex',alignItems:'flex-end',justifyContent:'center',paddingBottom:24,fontSize:32}}>{[40,70,100][i]}%</div>)}</div>;}`,
  },
};
