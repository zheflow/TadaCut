/**
 * GLSL ES 3.00 shaders for library effects and pixel transitions. Each pass
 * reads u_texture and writes fragColor; u_resolution is the frame size in
 * pixels, u_time seconds into the clip and u_progress 0–1 (clip progress for
 * effects, transition progress for transitions). Effect parameters arrive as
 * u_<key> floats. Sizes in pixels are measured against a 1080-pixel-tall frame
 * so a look is the same at every export size.
 */
const header = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_progress;
out vec4 fragColor;
// FNV-1a over the coordinate bytes, followed by a xorshift permutation.
// Keeping the arithmetic integer makes the random pattern stable across GPUs.
float hash(vec2 p) {
  uvec2 coordinates = floatBitsToUint(p);
  uint state = 2166136261u;
  for (int axis = 0; axis < 2; axis++) {
    uint coordinate = coordinates[axis];
    for (int byte = 0; byte < 4; byte++) {
      state = (state ^ (coordinate & 255u)) * 16777619u;
      coordinate >>= 8u;
    }
  }
  state ^= state << 13u;
  state ^= state >> 17u;
  state ^= state << 5u;
  return float(state >> 8u) / 16777216.0;
}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));vec2 u=f*f*(3.-2.*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
// Construct RGB from chroma and the six hue sectors of the HSV cylinder.
vec3 hsv2rgb(vec3 c) {
  float sector = fract(c.x) * 6.0;
  float chroma = c.z * c.y;
  float middle = chroma * (1.0 - abs(mod(sector, 2.0) - 1.0));
  vec3 color;
  if (sector < 1.0) color = vec3(chroma, middle, 0.0);
  else if (sector < 2.0) color = vec3(middle, chroma, 0.0);
  else if (sector < 3.0) color = vec3(0.0, chroma, middle);
  else if (sector < 4.0) color = vec3(0.0, middle, chroma);
  else if (sector < 5.0) color = vec3(middle, 0.0, chroma);
  else color = vec3(chroma, 0.0, middle);
  return color + vec3(c.z - chroma);
}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec2 px1080(vec2 d){return d*vec2(u_resolution.y/u_resolution.x,1.)/1080.;}
`;
const uniforms = (keys: string[]) =>
  keys.map((k) => `uniform float u_${k};`).join("\n");
const effect = (keys: string[], body: string) =>
  `${header}${uniforms(keys)}\nvoid main(){${body}}`;

export const effectShaders: Record<string, string> = {
  pixelate: effect(
    ["size"],
    `vec2 b=px1080(vec2(u_size));vec2 uv=(floor(v_uv/b)+.5)*b;fragColor=texture(u_texture,uv);`,
  ),
  duotone: effect(
    ["shadowHue", "highlightHue", "amount"],
    `vec4 c=texture(u_texture,v_uv);float y=luma(c.rgb);vec3 a=hsv2rgb(vec3(u_shadowHue/360.,.75,.22));vec3 b=hsv2rgb(vec3(u_highlightHue/360.,.5,1.));fragColor=vec4(mix(c.rgb,mix(a,b,smoothstep(0.,1.,y)),u_amount),c.a);`,
  ),
  fisheye: effect(
    ["strength"],
    `float aspect=u_resolution.x/u_resolution.y;vec2 p=v_uv*2.-1.;p.x*=aspect;float r=length(p);vec2 q=r>1e-4?p*(pow(r,max(.2,1.+u_strength*.8))/r):p;q.x/=aspect;fragColor=texture(u_texture,clamp(q*.5+.5,0.,1.));`,
  ),
  kaleidoscope: effect(
    ["segments", "rotation"],
    `float aspect=u_resolution.x/u_resolution.y;vec2 p=v_uv-.5;p.x*=aspect;float seg=6.2831853/max(2.,floor(u_segments));float a=mod(atan(p.y,p.x)+radians(u_rotation),seg);a=abs(a-seg*.5);vec2 q=vec2(cos(a),sin(a))*length(p);q.x/=aspect;fragColor=texture(u_texture,clamp(q+.5,0.,1.));`,
  ),
  "soft-glow": effect(
    ["radius", "strength", "threshold"],
    `vec4 c=texture(u_texture,v_uv);vec3 acc=vec3(0.);for(int i=0;i<24;i++){float fi=float(i);float r=sqrt((fi+.5)/24.)*u_radius;float a=fi*2.39996323;acc+=max(texture(u_texture,v_uv+px1080(vec2(cos(a),sin(a))*r)).rgb-u_threshold,0.);}vec3 glow=acc/24.*u_strength*2.;fragColor=vec4(1.-(1.-c.rgb)*(1.-clamp(glow,0.,1.)),c.a);`,
  ),
  "light-leak": effect(
    ["intensity", "hue", "speed"],
    `vec4 c=texture(u_texture,v_uv);float t=u_time*u_speed;float n=noise(vec2(v_uv.x*1.5+t*.3,v_uv.y*1.2-t*.2));float edge=smoothstep(.45,1.,1.-v_uv.x+n*.45)*(.65+.35*sin(t+v_uv.y*3.));vec3 leak=hsv2rgb(vec3(fract(u_hue/360.+n*.08),.7,1.))*edge*u_intensity;fragColor=vec4(1.-(1.-c.rgb)*(1.-leak),c.a);`,
  ),
  glitch: effect(
    ["amount", "speed"],
    `float t=floor(u_time*(4.+u_speed*6.));float row=floor(v_uv.y*24.);float h=hash(vec2(row,t));float shift=h>1.-u_amount*.6?(hash(vec2(t,row*1.7))-.5)*.15*u_amount:0.;vec2 uv=vec2(fract(v_uv.x+shift),v_uv.y);float split=.012*u_amount*(hash(vec2(t,3.))-.5)*2.;vec4 c=texture(u_texture,uv);fragColor=vec4(texture(u_texture,uv+vec2(split,0.)).r,c.g,texture(u_texture,uv-vec2(split,0.)).b,c.a);`,
  ),
  vignette: effect(
    ["amount", "softness"],
    `vec4 c=texture(u_texture,v_uv);vec2 p=v_uv-.5;p.x*=u_resolution.x/u_resolution.y*.75;float v=1.-smoothstep(.75-u_softness*.7,.75,length(p));fragColor=vec4(c.rgb*mix(1.,v,u_amount),c.a);`,
  ),
  "film-grain": effect(
    ["amount", "size"],
    `vec4 c=texture(u_texture,v_uv);vec2 cell=floor(v_uv*vec2(u_resolution.x/u_resolution.y,1.)*1080./u_size);float n=hash(cell+fract(u_time*13.7)*97.)-.5;fragColor=vec4(c.rgb+n*u_amount*.35,c.a);`,
  ),
  "chromatic-aberration": effect(
    ["offset"],
    `vec2 off=(v_uv-.5)*2.*px1080(vec2(u_offset));vec4 c=texture(u_texture,v_uv);fragColor=vec4(texture(u_texture,v_uv+off).r,c.g,texture(u_texture,v_uv-off).b,c.a);`,
  ),
  sharpen: effect(
    ["amount"],
    `vec2 px=1./u_resolution;vec4 c=texture(u_texture,v_uv);vec3 b=(texture(u_texture,v_uv+vec2(px.x,0.)).rgb+texture(u_texture,v_uv-vec2(px.x,0.)).rgb+texture(u_texture,v_uv+vec2(0.,px.y)).rgb+texture(u_texture,v_uv-vec2(0.,px.y)).rgb)*.25;fragColor=vec4(c.rgb+(c.rgb-b)*u_amount,c.a);`,
  ),
  posterize: effect(
    ["levels"],
    `vec4 c=texture(u_texture,v_uv);float l=max(2.,floor(u_levels));fragColor=vec4(floor(c.rgb*(l-1.)+.5)/(l-1.),c.a);`,
  ),
  halftone: effect(
    ["size", "angle"],
    `float a=radians(u_angle);mat2 rot=mat2(cos(a),sin(a),-sin(a),cos(a));float s=u_size*u_resolution.y/1080.;vec2 q=rot*(v_uv*u_resolution);vec2 cell=(floor(q/s)+.5)*s;vec4 c=texture(u_texture,clamp(transpose(rot)*cell/u_resolution,0.,1.));float r=(1.-luma(c.rgb))*s*.62;float ink=1.-smoothstep(r-1.,r+1.,length(q-cell));fragColor=vec4(mix(vec3(.97),c.rgb*.9,ink),c.a);`,
  ),
  sketch: effect(
    ["strength"],
    `vec2 px=1./u_resolution;float tl=luma(texture(u_texture,v_uv+px*vec2(-1.,1.)).rgb),tc=luma(texture(u_texture,v_uv+px*vec2(0.,1.)).rgb),tr=luma(texture(u_texture,v_uv+px*vec2(1.,1.)).rgb),ml=luma(texture(u_texture,v_uv+px*vec2(-1.,0.)).rgb),mr=luma(texture(u_texture,v_uv+px*vec2(1.,0.)).rgb),bl=luma(texture(u_texture,v_uv+px*vec2(-1.,-1.)).rgb),bc=luma(texture(u_texture,v_uv+px*vec2(0.,-1.)).rgb),br=luma(texture(u_texture,v_uv+px*vec2(1.,-1.)).rgb);float gx=-tl-2.*ml-bl+tr+2.*mr+br;float gy=-bl-2.*bc-br+tl+2.*tc+tr;float e=clamp(length(vec2(gx,gy))*u_strength,0.,1.);fragColor=vec4(vec3(1.-e),texture(u_texture,v_uv).a);`,
  ),
  mirror: effect(
    ["axis"],
    `vec2 uv=v_uv;if(u_axis<.5)uv.x=uv.x>.5?1.-uv.x:uv.x;else uv.y=uv.y<.5?1.-uv.y:uv.y;fragColor=texture(u_texture,uv);`,
  ),
  wave: effect(
    ["amplitude", "frequency", "speed"],
    `vec2 uv=v_uv;uv.x+=sin(uv.y*u_frequency+u_time*u_speed*3.)*u_amplitude;uv.y+=cos(uv.x*u_frequency*.7+u_time*u_speed*2.)*u_amplitude*.5;fragColor=texture(u_texture,clamp(uv,0.,1.));`,
  ),
  scanlines: effect(
    ["amount", "density"],
    `vec4 c=texture(u_texture,v_uv);float line=.5+.5*sin(v_uv.y*u_density*3.14159);float flicker=1.-.03*u_amount*sin(u_time*60.);fragColor=vec4(c.rgb*mix(1.,line,u_amount)*flicker,c.a);`,
  ),
  "tilt-shift": effect(
    ["focus", "width", "blur"],
    `float d=abs((1.-v_uv.y)-u_focus);float radius=u_blur*2.*smoothstep(u_width*.5,u_width*.5+.25,d);vec4 acc=vec4(0.);for(int i=0;i<16;i++){float fi=float(i);float r=sqrt((fi+.5)/16.)*radius;float a=fi*2.39996323;acc+=texture(u_texture,v_uv+px1080(vec2(cos(a),sin(a))*r));}fragColor=acc/16.;`,
  ),
  "zoom-blur": effect(
    ["amount"],
    `vec2 dir=v_uv-.5;vec4 acc=vec4(0.);for(int i=0;i<16;i++){acc+=texture(u_texture,.5+dir*(1.-u_amount*float(i)/15.));}fragColor=acc/16.;`,
  ),
  "hue-shift": effect(
    ["degrees"],
    `vec4 c=texture(u_texture,v_uv);mat3 toYiq=mat3(.299,.596,.211,.587,-.274,-.523,.114,-.322,.312);mat3 toRgb=mat3(1.,1.,1.,.956,-.272,-1.106,.621,-.647,1.703);vec3 q=toYiq*c.rgb;float h=atan(q.z,q.y)+radians(u_degrees);float ch=length(q.yz);fragColor=vec4(toRgb*vec3(q.x,ch*cos(h),ch*sin(h)),c.a);`,
  ),
  temperature: effect(
    ["temperature", "tint"],
    `vec4 c=texture(u_texture,v_uv);fragColor=vec4(c.rgb*vec3(1.+u_temperature*.15,1.-u_tint*.1,1.-u_temperature*.15),c.a);`,
  ),
  "black-white": effect(
    ["contrast", "red", "green", "blue"],
    `vec4 c=texture(u_texture,v_uv);float y=dot(c.rgb,vec3(u_red,u_green,u_blue))/max(.001,u_red+u_green+u_blue);fragColor=vec4(vec3((y-.5)*u_contrast+.5),c.a);`,
  ),
  invert: effect(
    ["amount"],
    `vec4 c=texture(u_texture,v_uv);fragColor=vec4(mix(c.rgb,1.-c.rgb,u_amount),c.a);`,
  ),
};

/** Transitions drawn on the incoming clip's pixels: u_progress runs 0 → 1 and alpha reveals it. */
export const transitionShaders: Record<string, string> = {
  noise: effect(
    [],
    `vec4 c=texture(u_texture,v_uv);float n=noise(v_uv*vec2(u_resolution.x/u_resolution.y,1.)*8.)*.7+noise(v_uv*40.)*.3;fragColor=vec4(c.rgb,c.a*smoothstep(n-.08,n+.08,u_progress*1.2-.1));`,
  ),
  pixelate: effect(
    [],
    `float block=mix(72.,1.,smoothstep(0.,1.,u_progress));vec2 b=px1080(vec2(block));vec2 uv=block>1.5?(floor(v_uv/b)+.5)*b:v_uv;vec4 c=texture(u_texture,uv);fragColor=vec4(c.rgb,c.a*smoothstep(0.,.5,u_progress));`,
  ),
  glitch: effect(
    [],
    `float row=floor(v_uv.y*30.);float h=hash(vec2(row,floor(u_progress*20.)));vec2 uv=vec2(fract(v_uv.x+(1.-u_progress)*(h-.5)*.3),v_uv.y);vec4 c=texture(u_texture,uv);float r=texture(u_texture,uv+vec2((1.-u_progress)*.03,0.)).r;fragColor=vec4(r,c.g,c.b,c.a*step(hash(vec2(row,7.)),u_progress*1.3));`,
  ),
  ripple: effect(
    [],
    `float aspect=u_resolution.x/u_resolution.y;vec2 p=v_uv-.5;p.x*=aspect;float d=length(p);float front=u_progress*1.4;float wave=sin((d-front)*40.)*.02*(1.-u_progress);vec2 uv=v_uv+normalize(p+1e-5)*wave*vec2(1./aspect,1.);vec4 c=texture(u_texture,clamp(uv,0.,1.));fragColor=vec4(c.rgb,c.a*(1.-smoothstep(front-.15,front,d)));`,
  ),
};
/**
 * An extension transition supplies `vec4 transition(vec2 uv)`, which can read
 * the incoming clip with `incoming(uv)` and returns it with an alpha mask.
 */
export const extensionTransition = (body: string) =>
  `${header}\nvec4 incoming(vec2 uv){return texture(u_texture,uv);}\n#define progress u_progress\n${body}\nvoid main(){fragColor=transition(v_uv);}`;
