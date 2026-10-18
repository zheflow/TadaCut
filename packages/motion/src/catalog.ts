/**
 * Motion graphics templates. Each is a small React component that draws one
 * frame from (frame, fps, width, height); its settings arrive through a JSON
 * object placed where the code says __PARAMS__, so an instantiated template
 * is ordinary, editable code.
 */
export interface TemplateParam {
  key: string;
  name: string;
  type: "text" | "color" | "number" | "list";
  default: string | number | string[];
  /** Filled from the brand kit when the user gives no value. */
  brand?: "primary" | "secondary" | "font";
}
export interface MotionTemplate {
  id: string;
  name: string;
  category: "title" | "info" | "data" | "social" | "transition" | "ending";
  tags: string[];
  /** Seconds. */
  duration: number;
  params: TemplateParam[];
  code: string;
}
const ease = `const clamp=(v)=>Math.min(1,Math.max(0,v));const out=(t)=>1-Math.pow(1-clamp(t),3);const back=(t)=>{t=clamp(t);const c=1.70158;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);};`;
const p = (
  key: string,
  name: string,
  type: TemplateParam["type"],
  value: TemplateParam["default"],
  brand?: TemplateParam["brand"],
): TemplateParam => ({
  key,
  name,
  type,
  default: value,
  ...(brand ? { brand } : {}),
});
export const templateCatalog: MotionTemplate[] = [
  {
    id: "lower-third",
    name: "人物介绍条",
    category: "info",
    tags: ["人物", "介绍", "姓名", "访谈"],
    duration: 5,
    params: [
      p("name", "名字", "text", "名字 / 主标题"),
      p("title", "介绍", "text", "在这里写一句介绍"),
      p("accent", "强调色", "color", "#7fd1ae", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function LowerThird({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;const a=out(t/0.6);const e=out((t-0.25)/0.6);return <div style={{position:'absolute',left:width*.07,bottom:height*.12,fontFamily:P.font||'sans-serif',color:'#fff',opacity:a}}><div style={{background:P.accent,height:8,width:120*a,marginBottom:18,borderRadius:4}}/><div style={{fontSize:height*.055,fontWeight:800,transform:'translateX('+(1-a)*-60+'px)'}}>{P.name}</div><div style={{fontSize:height*.028,marginTop:10,opacity:.82*e,transform:'translateX('+(1-e)*-40+'px)'}}>{P.title}</div></div>;}`,
  },
  {
    id: "title-card",
    name: "大标题",
    category: "title",
    tags: ["标题", "开场", "片头"],
    duration: 4,
    params: [
      p("title", "标题", "text", "你的标题"),
      p("subtitle", "副标题", "text", "一句副标题"),
      p("color", "文字颜色", "color", "#ffffff"),
      p("accent", "强调色", "color", "#7fd1ae", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function TitleCard({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;const chars=[...P.title];return <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:P.font||'sans-serif',color:P.color}}><div style={{fontSize:height*.1,fontWeight:900,letterSpacing:'.02em'}}>{chars.map((c,i)=>{const k=out((t-i*0.04)/0.5);return <span key={i} style={{display:'inline-block',opacity:k,transform:'translateY('+(1-k)*40+'px)'}}>{c}</span>;})}</div><div style={{height:6,width:width*.18*out((t-.4)/.6),background:P.accent,margin:'18px 0',borderRadius:3}}/><div style={{fontSize:height*.035,opacity:out((t-.6)/.6)}}>{P.subtitle}</div></div>;}`,
  },
  {
    id: "countdown",
    name: "倒计时",
    category: "transition",
    tags: ["倒计时", "开场", "数字"],
    duration: 5,
    params: [
      p("from", "起始数字", "number", 5),
      p("color", "颜色", "color", "#d2e8b6", "primary"),
      p("end", "结束文字", "text", "GO"),
    ],
    code: `export default function Countdown({frame,fps,height}){const P=__PARAMS__;const n=Math.max(0,P.from-Math.floor(frame/fps));const s=1+(1-(frame%fps)/fps)*.16;return <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontFamily:'sans-serif',fontWeight:800,fontSize:height*.22,color:P.color,transform:'scale('+s+')'}}>{n||P.end}</div>;}`,
  },
  {
    id: "bar-chart",
    name: "柱状图",
    category: "data",
    tags: ["数据", "图表", "对比"],
    duration: 5,
    params: [
      p("labels", "标签", "list", ["一月", "二月", "三月", "四月"]),
      p("values", "数值（逗号分隔）", "text", "40,65,52,90"),
      p("unit", "单位", "text", "%"),
      p("color", "柱子颜色", "color", "#8fc3b0", "primary"),
    ],
    code: `export default function Bars({frame,fps,width,height}){const P=__PARAMS__;${ease}const values=String(P.values).split(',').map(Number);const max=Math.max(...values,1);return <div style={{position:'absolute',inset:0,display:'flex',gap:width*.03,alignItems:'flex-end',justifyContent:'center',padding:height*.14,boxSizing:'border-box',color:'#fff',fontFamily:'sans-serif'}}>{values.map((v,i)=>{const k=out((frame/fps-i*.15)/1);return <div key={i} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12}}><div style={{fontSize:height*.03,fontWeight:700,opacity:k}}>{Math.round(v*k)}{P.unit}</div><div style={{width:width*.08,height:height*.55*(v/max)*k,background:P.color,borderRadius:14}}/><div style={{fontSize:height*.025,opacity:.8}}>{P.labels[i]??''}</div></div>;})}</div>;}`,
  },
  {
    id: "progress-ring",
    name: "进度环",
    category: "data",
    tags: ["数据", "百分比", "进度"],
    duration: 4,
    params: [
      p("percent", "百分比", "number", 76),
      p("label", "说明", "text", "完成率"),
      p("color", "颜色", "color", "#7fd1ae", "primary"),
    ],
    code: `export default function Ring({frame,fps,height}){const P=__PARAMS__;${ease}const k=out(frame/fps/1.4);const r=height*.16,c=2*Math.PI*r;return <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontFamily:'sans-serif',color:'#fff'}}><svg width={r*2.6} height={r*2.6} viewBox={'0 0 '+r*2.6+' '+r*2.6}><circle cx={r*1.3} cy={r*1.3} r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={r*.18}/><circle cx={r*1.3} cy={r*1.3} r={r} fill="none" stroke={P.color} strokeWidth={r*.18} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c*(1-P.percent/100*k)} transform={'rotate(-90 '+r*1.3+' '+r*1.3+')'}/><text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={r*.5} fontWeight="800">{Math.round(P.percent*k)}%</text></svg><div style={{position:'absolute',top:'50%',marginTop:r*1.5,fontSize:height*.03,opacity:.85}}>{P.label}</div></div>;}`,
  },
  {
    id: "counter",
    name: "数字滚动",
    category: "data",
    tags: ["数字", "数据", "增长"],
    duration: 3,
    params: [
      p("from", "起始", "number", 0),
      p("to", "目标", "number", 10000),
      p("prefix", "前缀", "text", ""),
      p("suffix", "后缀", "text", "+"),
      p("label", "说明", "text", "用户"),
      p("color", "颜色", "color", "#ffffff"),
    ],
    code: `export default function Counter({frame,fps,height}){const P=__PARAMS__;${ease}const k=out(frame/fps/1.6);const v=Math.round(P.from+(P.to-P.from)*k);return <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:'sans-serif',color:P.color}}><div style={{fontSize:height*.14,fontWeight:900,fontVariantNumeric:'tabular-nums'}}>{P.prefix}{v.toLocaleString()}{P.suffix}</div><div style={{fontSize:height*.035,opacity:.8}}>{P.label}</div></div>;}`,
  },
  {
    id: "quote-card",
    name: "引用卡片",
    category: "info",
    tags: ["引用", "金句", "文字"],
    duration: 6,
    params: [
      p("text", "引用内容", "text", "把复杂的事说简单，就是最好的表达。"),
      p("author", "出处", "text", "— 作者"),
      p("accent", "强调色", "color", "#e8c46a", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function Quote({frame,fps,width,height}){const P=__PARAMS__;${ease}const k=out(frame/fps/.8);return <div style={{position:'absolute',left:'12%',right:'12%',top:'50%',transform:'translateY(-50%) scale('+(0.94+0.06*k)+')',opacity:k,background:'rgba(12,14,18,.72)',borderRadius:28,padding:height*.06,color:'#fff',fontFamily:P.font||'serif'}}><div style={{fontSize:height*.12,lineHeight:.6,color:P.accent}}>“</div><div style={{fontSize:height*.045,lineHeight:1.5}}>{P.text}</div><div style={{marginTop:24,fontSize:height*.028,opacity:.7,textAlign:'right'}}>{P.author}</div></div>;}`,
  },
  {
    id: "follow-prompt",
    name: "关注提示",
    category: "social",
    tags: ["关注", "点赞", "互动"],
    duration: 3,
    params: [
      p("text", "按钮文字", "text", "关注"),
      p("color", "按钮颜色", "color", "#ff4d6d", "primary"),
    ],
    code: `export default function Follow({frame,fps,height}){const P=__PARAMS__;${ease}const t=frame/fps;const k=back(t/.5);const press=t>1.1&&t<1.35?.92:1;const done=t>1.25;return <div style={{position:'absolute',left:'50%',bottom:'14%',transform:'translateX(-50%) scale('+k*press+')',background:done?'#2b2f36':P.color,color:'#fff',fontFamily:'sans-serif',fontWeight:800,fontSize:height*.04,padding:'.5em 1.4em',borderRadius:999,boxShadow:'0 10px 30px rgba(0,0,0,.3)'}}>{done?'✓ 已'+P.text:'+ '+P.text}</div>;}`,
  },
  {
    id: "location-tag",
    name: "地点标注",
    category: "info",
    tags: ["地点", "旅行", "Vlog"],
    duration: 4,
    params: [
      p("place", "地点", "text", "城市 · 地标"),
      p("detail", "补充", "text", "N 31.23° E 121.47°"),
      p("color", "颜色", "color", "#ffffff"),
    ],
    code: `export default function Location({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;const a=back(t/.5),b=out((t-.3)/.6);return <div style={{position:'absolute',left:width*.07,top:height*.1,display:'flex',alignItems:'center',gap:18,color:P.color,fontFamily:'sans-serif'}}><div style={{width:height*.05,height:height*.05,borderRadius:'50% 50% 50% 0',transform:'rotate(-45deg) scale('+a+')',background:P.color}}/><div style={{opacity:b,transform:'translateX('+(1-b)*-30+'px)'}}><div style={{fontSize:height*.04,fontWeight:800}}>{P.place}</div><div style={{fontSize:height*.022,opacity:.75}}>{P.detail}</div></div></div>;}`,
  },
  {
    id: "callout",
    name: "标注箭头",
    category: "info",
    tags: ["标注", "指示", "教程"],
    duration: 4,
    params: [
      p("label", "标注文字", "text", "看这里"),
      p("x", "目标横向位置 0–1", "number", 0.62),
      p("y", "目标纵向位置 0–1", "number", 0.45),
      p("color", "颜色", "color", "#ffd84a", "primary"),
    ],
    code: `export default function Callout({frame,fps,width,height}){const P=__PARAMS__;${ease}const k=out(frame/fps/.7);const x=P.x*width,y=P.y*height,lx=x-width*.18,ly=y-height*.16;return <svg style={{position:'absolute',inset:0}} width={width} height={height}><circle cx={x} cy={y} r={height*.04*back(frame/fps/.5)} fill="none" stroke={P.color} strokeWidth={6}/><line x1={lx} y1={ly} x2={lx+(x-lx)*k*.85} y2={ly+(y-ly)*k*.85} stroke={P.color} strokeWidth={6} strokeLinecap="round"/><text x={lx} y={ly-18} fill={P.color} fontSize={height*.04} fontWeight="800" fontFamily="sans-serif" textAnchor="middle" opacity={k}>{P.label}</text></svg>;}`,
  },
  {
    id: "list-reveal",
    name: "要点逐条",
    category: "info",
    tags: ["要点", "清单", "教程"],
    duration: 6,
    params: [
      p("title", "标题", "text", "三个要点"),
      p("items", "条目", "list", ["第一点", "第二点", "第三点"]),
      p("accent", "强调色", "color", "#7fd1ae", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function List({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;return <div style={{position:'absolute',left:width*.1,top:height*.18,color:'#fff',fontFamily:P.font||'sans-serif'}}><div style={{fontSize:height*.06,fontWeight:800,marginBottom:height*.04,opacity:out(t/.5)}}>{P.title}</div>{P.items.map((item,i)=>{const k=out((t-.5-i*.45)/.5);return <div key={i} style={{display:'flex',alignItems:'center',gap:20,fontSize:height*.04,margin:'0 0 '+height*.025+'px',opacity:k,transform:'translateX('+(1-k)*-50+'px)'}}><span style={{width:height*.05,height:height*.05,borderRadius:12,background:P.accent,color:'#111',display:'grid',placeItems:'center',fontWeight:800,fontSize:height*.028}}>{i+1}</span>{item}</div>;})}</div>;}`,
  },
  {
    id: "steps",
    name: "步骤流程",
    category: "info",
    tags: ["步骤", "流程", "教程"],
    duration: 6,
    params: [
      p("steps", "步骤", "list", ["准备", "制作", "发布"]),
      p("color", "颜色", "color", "#8fc3b0", "primary"),
    ],
    code: `export default function Steps({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;const n=P.steps.length;return <div style={{position:'absolute',left:'8%',right:'8%',top:'50%',transform:'translateY(-50%)',display:'flex',alignItems:'center',fontFamily:'sans-serif',color:'#fff'}}>{P.steps.map((s,i)=>{const k=back((t-i*.6)/.5);const line=out((t-i*.6-.3)/.5);return <div key={i} style={{flex:i<n-1?1:'none',display:'flex',alignItems:'center'}}><div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14,transform:'scale('+k+')'}}><div style={{width:height*.09,height:height*.09,borderRadius:'50%',background:P.color,display:'grid',placeItems:'center',fontSize:height*.04,fontWeight:800,color:'#102018'}}>{i+1}</div><div style={{fontSize:height*.03,whiteSpace:'nowrap'}}>{s}</div></div>{i<n-1&&<div style={{flex:1,height:6,margin:'0 16px',marginBottom:height*.05,background:'rgba(255,255,255,.2)',borderRadius:3}}><div style={{height:'100%',width:line*100+'%',background:P.color,borderRadius:3}}/></div>}</div>;})}</div>;}`,
  },
  {
    id: "kinetic-words",
    name: "动态文字",
    category: "title",
    tags: ["文字", "节奏", "口播"],
    duration: 4,
    params: [
      p("words", "词语", "list", ["简单", "好看", "高效"]),
      p("color", "颜色", "color", "#ffffff"),
      p("accent", "强调色", "color", "#ffcf3d", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function Kinetic({frame,fps,height}){const P=__PARAMS__;${ease}const t=frame/fps;const each=Math.max(.4,4/Math.max(1,P.words.length));const i=Math.min(P.words.length-1,Math.floor(t/each));const k=back((t-i*each)/.25);return <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontFamily:P.font||'sans-serif'}}><div style={{fontSize:height*.16,fontWeight:900,color:i%2?P.accent:P.color,transform:'scale('+k+') rotate('+(i%2?-3:3)*(1-clamp(k))+'deg)'}}>{P.words[i]}</div></div>;}`,
  },
  {
    id: "ticker",
    name: "底部滚动条",
    category: "info",
    tags: ["滚动", "新闻", "提示"],
    duration: 8,
    params: [
      p("label", "标签", "text", "最新"),
      p(
        "text",
        "滚动文字",
        "text",
        "这里是一条滚动的消息 · 可以写多条 · 用间隔符分开",
      ),
      p("accent", "标签颜色", "color", "#ff4d6d", "primary"),
    ],
    code: `export default function Ticker({frame,fps,width,height}){const P=__PARAMS__;const speed=width*.12;const x=width-(frame/fps)*speed;return <div style={{position:'absolute',left:0,right:0,bottom:height*.06,height:height*.07,background:'rgba(10,12,16,.8)',display:'flex',alignItems:'center',overflow:'hidden',fontFamily:'sans-serif',color:'#fff',fontSize:height*.032}}><div style={{background:P.accent,height:'100%',display:'flex',alignItems:'center',padding:'0 1em',fontWeight:800,zIndex:1}}>{P.label}</div><div style={{position:'absolute',left:x,whiteSpace:'nowrap'}}>{P.text}</div></div>;}`,
  },
  {
    id: "end-card",
    name: "片尾卡片",
    category: "ending",
    tags: ["片尾", "结尾", "行动号召"],
    duration: 5,
    params: [
      p("title", "标题", "text", "感谢观看"),
      p("subtitle", "副标题", "text", "下期再见"),
      p("cta", "行动号召", "text", "关注获取更多"),
      p("accent", "强调色", "color", "#7fd1ae", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function EndCard({frame,fps,height}){const P=__PARAMS__;${ease}const t=frame/fps;return <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:height*.025,fontFamily:P.font||'sans-serif',color:'#fff',background:'radial-gradient(circle at 50% 40%, rgba(255,255,255,.08), rgba(0,0,0,.6))',opacity:out(t/.5)}}><div style={{fontSize:height*.09,fontWeight:900,transform:'translateY('+(1-out(t/.7))*30+'px)'}}>{P.title}</div><div style={{fontSize:height*.035,opacity:out((t-.3)/.6)}}>{P.subtitle}</div><div style={{marginTop:height*.03,padding:'.55em 1.6em',borderRadius:999,background:P.accent,color:'#0f1a14',fontWeight:800,fontSize:height*.032,transform:'scale('+back((t-.7)/.5)+')'}}>{P.cta}</div></div>;}`,
  },
  {
    id: "price-tag",
    name: "价格标签",
    category: "info",
    tags: ["价格", "促销", "电商"],
    duration: 4,
    params: [
      p("label", "标签", "text", "限时价"),
      p("price", "价格", "text", "¥199"),
      p("original", "原价", "text", "¥299"),
      p("color", "颜色", "color", "#ff4d6d", "primary"),
    ],
    code: `export default function Price({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;const k=back(t/.5);return <div style={{position:'absolute',right:width*.08,top:height*.14,transform:'scale('+k+') rotate(-4deg)',background:P.color,color:'#fff',borderRadius:24,padding:'.6em 1.1em',fontFamily:'sans-serif',boxShadow:'0 14px 40px rgba(0,0,0,.35)'}}><div style={{fontSize:height*.026,opacity:.9}}>{P.label}</div><div style={{fontSize:height*.075,fontWeight:900,lineHeight:1.1}}>{P.price}</div><div style={{fontSize:height*.024,textDecoration:'line-through',opacity:.75*out((t-.4)/.4)}}>{P.original}</div></div>;}`,
  },
  {
    id: "chapter",
    name: "章节标题",
    category: "transition",
    tags: ["章节", "段落", "分段"],
    duration: 3,
    params: [
      p("number", "编号", "text", "01"),
      p("title", "章节名", "text", "开始"),
      p("accent", "强调色", "color", "#7fd1ae", "primary"),
      p("font", "字体", "text", "", "font"),
    ],
    code: `export default function Chapter({frame,fps,width,height}){const P=__PARAMS__;${ease}const t=frame/fps;const k=out(t/.6);const exit=out((t-2.3)/.6);return <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',gap:width*.03,fontFamily:P.font||'sans-serif',color:'#fff',opacity:1-exit}}><div style={{fontSize:height*.14,fontWeight:900,color:P.accent,transform:'translateX('+(1-k)*-80+'px)'}}>{P.number}</div><div style={{width:6,height:height*.14*k,background:'#fff',opacity:.6}}/><div style={{fontSize:height*.07,fontWeight:800,transform:'translateX('+(1-k)*80+'px)',opacity:k}}>{P.title}</div></div>;}`,
  },
  {
    id: "handle-card",
    name: "账号名片",
    category: "social",
    tags: ["账号", "署名", "社交"],
    duration: 4,
    params: [
      p("handle", "账号名", "text", "@你的账号"),
      p("note", "说明", "text", "每周更新"),
      p("color", "底色", "color", "#1f2a33"),
      p("accent", "强调色", "color", "#7fd1ae", "primary"),
    ],
    code: `export default function Handle({frame,fps,width,height}){const P=__PARAMS__;${ease}const k=back(frame/fps/.5);return <div style={{position:'absolute',left:'50%',bottom:height*.1,transform:'translateX(-50%) scale('+k+')',display:'flex',alignItems:'center',gap:18,background:P.color,borderRadius:999,padding:'.5em 1.2em .5em .5em',fontFamily:'sans-serif',color:'#fff'}}><div style={{width:height*.07,height:height*.07,borderRadius:'50%',background:P.accent}}/><div><div style={{fontSize:height*.035,fontWeight:800}}>{P.handle}</div><div style={{fontSize:height*.022,opacity:.75}}>{P.note}</div></div></div>;}`,
  },
  {
    id: "highlight-box",
    name: "高亮框",
    category: "info",
    tags: ["高亮", "框选", "教程", "录屏"],
    duration: 3,
    params: [
      p("x", "左边 0–1", "number", 0.3),
      p("y", "上边 0–1", "number", 0.3),
      p("w", "宽 0–1", "number", 0.4),
      p("h", "高 0–1", "number", 0.25),
      p("label", "标签", "text", ""),
      p("color", "颜色", "color", "#ffd84a", "primary"),
    ],
    code: `export default function Box({frame,fps,width,height}){const P=__PARAMS__;${ease}const k=out(frame/fps/.5);const x=P.x*width,y=P.y*height,w=P.w*width,h=P.h*height;return <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,'+.45*k+')',clipPath:'polygon(0 0,100% 0,100% 100%,0 100%,0 0,'+x+'px '+y+'px,'+x+'px '+(y+h)+'px,'+(x+w)+'px '+(y+h)+'px,'+(x+w)+'px '+y+'px,'+x+'px '+y+'px)'}}><div style={{position:'absolute',left:x,top:y,width:w,height:h,border:'6px solid '+P.color,borderRadius:16,boxSizing:'border-box',transform:'scale('+(1.08-.08*k)+')',opacity:k}}/>{P.label&&<div style={{position:'absolute',left:x,top:y+h+14,background:P.color,color:'#111',fontFamily:'sans-serif',fontWeight:800,fontSize:height*.03,padding:'.2em .6em',borderRadius:8,opacity:k}}>{P.label}</div>}</div>;}`,
  },
  {
    id: "split-reveal",
    name: "分屏揭示",
    category: "transition",
    tags: ["转场", "揭示", "标题"],
    duration: 2,
    params: [
      p("text", "文字", "text", "下一部分"),
      p("color", "颜色", "color", "#11161c"),
      p("accent", "文字颜色", "color", "#ffffff"),
    ],
    code: `export default function Split({frame,fps,height}){const P=__PARAMS__;${ease}const t=frame/fps;const close=out(t/.45),open=out((t-1.3)/.5);const k=close*(1-open);return <div style={{position:'absolute',inset:0,overflow:'hidden'}}><div style={{position:'absolute',left:0,right:0,top:0,height:'50%',background:P.color,transform:'translateY('+(k-1)*100+'%)'}}/><div style={{position:'absolute',left:0,right:0,bottom:0,height:'50%',background:P.color,transform:'translateY('+(1-k)*100+'%)'}}/><div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',color:P.accent,fontFamily:'sans-serif',fontWeight:900,fontSize:height*.08,opacity:clamp((t-.35)/.2)*(1-open)}}>{P.text}</div></div>;}`,
  },
];
export const templateCategories: Record<MotionTemplate["category"], string> = {
  title: "标题",
  info: "信息",
  data: "数据",
  social: "社交",
  transition: "转场",
  ending: "片尾",
};
/** Template code with its settings filled in. Brand values fill settings the user left out. */
export function instantiateTemplate(
  template: MotionTemplate,
  values: Record<string, unknown> = {},
  brand: { colors?: string[]; fonts?: string[] } = {},
) {
  const params: Record<string, unknown> = {};
  for (const param of template.params) {
    let value = values[param.key];
    if (value === undefined && param.brand === "primary" && brand.colors?.[0])
      value = brand.colors[0];
    if (value === undefined && param.brand === "secondary" && brand.colors?.[1])
      value = brand.colors[1];
    if (value === undefined && param.brand === "font" && brand.fonts?.[0])
      value = brand.fonts[0];
    value ??= param.default;
    if (param.type === "number") value = Number(value);
    if (param.type === "list" && !Array.isArray(value))
      value = String(value)
        .split(/[\n,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
    if (param.type === "text" || param.type === "color") value = String(value);
    params[param.key] = value;
  }
  // JSON is valid JavaScript; escaping "<" keeps the code readable in any host.
  return template.code.replace(
    "__PARAMS__",
    JSON.stringify(params).replace(/</g, "\\u003c"),
  );
}
export const findTemplate = (id: string) =>
  templateCatalog.find((t) => t.id === id);
