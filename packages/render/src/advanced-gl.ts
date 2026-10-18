import type { ClipAdvanced } from "../../domain/src/advanced-model";
const n = (v: number) => Number(v).toFixed(8);
export const needsAdvancedPass = (a?: ClipAdvanced) =>
  Boolean(a?.curves || a?.hsl?.length || a?.beauty);
/** Parameters are validated numeric domain data, never shader source supplied by a model. */
export function advancedShader(a: ClipAdvanced) {
  const curve = (key: "master" | "red" | "green" | "blue") => {
    const points = a.curves?.[key];
    return `float ${key}(float x){${
      points
        ? points
            .slice(1)
            .map(
              (p, i) =>
                `if(x<=${n(p[0])})return mix(${n(points[i][1])},${n(p[1])},clamp((x-${n(points[i][0])})/${n(p[0] - points[i][0])},0.,1.));`,
            )
            .join("") + `return ${n(points.at(-1)![1])};`
        : "return x;"
    }}`;
  };
  const b = a.beauty;
  const area = (r: { x: number; y: number; width: number; height: number }) =>
    `vec4(${n(r.x)},${n(1 - r.y)},${n(r.width)},${n(r.height)})`;
  return `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_texture; uniform vec2 u_resolution; out vec4 fragColor;
${["master", "red", "green", "blue"].map((k) => curve(k as "master")).join("\n")}
vec3 toHsl(vec3 c){float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)), d=mx-mn,l=(mx+mn)*.5,h=0.,s=0.;if(d>.00001){s=d/max(.00001,1.-abs(2.*l-1.));if(mx==c.r)h=mod((c.g-c.b)/d,6.);else if(mx==c.g)h=(c.b-c.r)/d+2.;else h=(c.r-c.g)/d+4.;h=fract(h/6.+1.);}return vec3(h,s,l);}
vec3 fromHsl(vec3 h){vec3 rgb=clamp(abs(mod(h.x*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);return h.z+(rgb-.5)*(1.-abs(2.*h.z-1.))*h.y;}
float ellipse(vec2 p,vec4 r){return 1.-smoothstep(.5,1.,length((p-r.xy)/max(r.zw*.5,vec2(.0001))));}
vec2 slim(vec2 p,vec4 r,float amount){float f=ellipse(p,r);p.x=r.x+(p.x-r.x)*(1.+amount*.4*f);return p;}
vec2 eye(vec2 p,vec2 center,float amount){float f=1.-smoothstep(0.,.085,length(p-center));return center+(p-center)*(1.-amount*f);}
void main(){vec2 uv=v_uv;
${b ? `uv=slim(uv,${area(b.body)},${n(b.bodySlim)});uv=slim(uv,${area(b.face)},${n(b.faceSlim)});uv=eye(uv,vec2(${n(b.leftEye[0])},${n(1 - b.leftEye[1])}),${n(b.eyeSize)});uv=eye(uv,vec2(${n(b.rightEye[0])},${n(1 - b.rightEye[1])}),${n(b.eyeSize)});` : ""}
vec4 c=texture(u_texture,uv);
${b ? `float region=ellipse(uv,${area(b.face)});vec3 sum=vec3(0.);float weights=0.;for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++){vec3 v=texture(u_texture,uv+vec2(float(x),float(y))*2./u_resolution).rgb;float w=exp(-dot(v-c.rgb,v-c.rgb)*55.)*exp(-float(x*x+y*y)/6.);sum+=w*v;weights+=w;}c.rgb=mix(c.rgb,sum/weights,region*${n(b.smooth)});c.rgb+=region*${n(b.brighten)}*.15*(1.-c.rgb);` : ""}
c.rgb=vec3(master(red(c.r)),master(green(c.g)),master(blue(c.b)));
vec3 h=toHsl(clamp(c.rgb,0.,1.));vec3 delta=vec3(0.);
${(a.hsl ?? []).map((b) => `{float dist=abs(mod(h.x*360.-${n(b.center)}+540.,360.)-180.);float w=1.-smoothstep(0.,${n(b.width)},dist);delta+=w*vec3(${n(b.hue / 360)},${n(b.saturation)},${n(b.lightness)});}`).join("\n")}
h=vec3(fract(h.x+delta.x+1.),clamp(h.y+delta.y,0.,1.),clamp(h.z+delta.z,0.,1.));c.rgb=fromHsl(h);fragColor=c;}`;
}
