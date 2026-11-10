import math, os, base64
src=open(os.path.join(os.path.dirname(__file__),'export_card.py')).read()
exec(src[:src.index("# ---------- 记分气泡")])
from PIL import Image
A=os.path.join(ROOT,'assets','game')+'/'
D=OUT+'sing/'; os.makedirs(D,exist_ok=True)
def adv(fk,text,size):
    f=fonts[fk]; cmap=f.getBestCmap(); return sum(f['hmtx'][cmap[ord(c)]][0] for c in text)*size/f['head'].unitsPerEm
LF=22
# ---------- 1. 歌词 ----------
SYL=[[('Hap','-'),('py',' '),('birth','-'),('day',' '),('to',' '),('you','')],
     [('Hap','-'),('py',' '),('birth','-'),('day',' '),('to',' '),('you','')],
     [('Hap','-'),('py',' '),('birth','-'),('day',' '),('dear',' '),('friend','')],
     [('Hap','-'),('py',' '),('birth','-'),('day',' '),('to',' '),('you','')]]
HIT=[[5],[5],[],[5]]
def lyric(li,fill):
    parts=[a+b for a,b in SYL[li]]; ws=[adv('pop',p,LF) for p in parts]; total=sum(ws)
    Wd=math.ceil(total+20); x=10; y=20; g=[]
    for i,pt in enumerate(parts):
        d=text_path('pop',pt.strip() if pt.strip()!=pt and False else pt,LF,x+ws[i]/2,y)
        g.append(f'<g id="syllable-{i+1}"><path d="{d}" stroke="#000" stroke-width="4" stroke-linejoin="round" fill="#000"/><path d="{d}" fill="{fill}"/></g>')
        if i in HIT[li]:
            sw=adv('pop',SYL[li][i][0],LF)
            g.append(f'<circle id="landing-dot" cx="{x+sw/2:.2f}" cy="{y+21}" r="4" fill="{fill}" stroke="#000" stroke-width="2"/>')
        x+=ws[i]
    return svgdoc(Wd,50,'\n'.join(g))
for li in range(4):
    open(D+f'lyrics-line{li+1}-white.svg','w').write(lyric(li,'#FFFFFF'))
    open(D+f'lyrics-line{li+1}-sung-yellow.svg','w').write(lyric(li,'#FFE600'))
# ---------- 2. 倒计时提示文字 ----------
lines=['Sing along and','catch the emojis!']
open(D+'countdown-text.svg','w').write(svgdoc(220,70,'\n'.join(outlined('pop',t,20,110,20+i*26,2,'#FFFFFF',None,f'line{i+1}') for i,t in enumerate(lines))))
# ---------- 3. 落点提示虚线胶囊 ----------
def capsule(col): 
    return svgdoc(106,42,f'<rect id="landing-hint" x="3" y="3" width="100" height="36" rx="18" stroke="{col}" stroke-width="2.5" stroke-dasharray="7 5"/>')
open(D+'landing-hint-white.svg','w').write(capsule('#FFFFFF'))
open(D+'landing-hint-green-aligned.svg','w').write(capsule('#5CFF8A'))
# ---------- 4. 音符 ----------
def note(cx,cy,col,dbl,rot=0,sz=1.3,ident='note'):
    head=lambda hx:f'<ellipse cx="{hx}" cy="0" rx="5.5" ry="4" transform="rotate({-0.4*180/math.pi:.2f} {hx} 0)" fill="{col}" stroke="#111111" stroke-width="2"/>'
    if dbl: body='<path d="M4.6 1.5L4.6 -20L18.6 -24L18.6 1.5" stroke="#111111" stroke-width="2.4" stroke-linejoin="round"/><path d="M4.6 -19L18.6 -23" stroke="#111111" stroke-width="4"/>'+head(0)+head(14)
    else: body='<path d="M4.6 1.5L4.6 -21Q12 -16 11 -8" stroke="#111111" stroke-width="2.4" stroke-linejoin="round"/>'+head(0)
    return f'<g id="{ident}" transform="translate({cx} {cy}) rotate({rot}) scale({sz})">{body}</g>'
cols=[('yellow','#FFE600'),('pink','#FF2E93'),('cyan','#00C2FF'),('white','#FFFFFF')]
for name,c in cols:
    open(D+f'note-single-{name}.svg','w').write(svgdoc(34,40,note(12,32,c,False,0,1.3,'note-single')))
    open(D+f'note-double-{name}.svg','w').write(svgdoc(42,44,note(9,35,c,True,0,1.3,'note-double')))
# ---------- 5. 钢琴舞台（底色 + 粉色网点 + 黄色点点 + 钢琴） ----------
im=Image.open(A+'piano.png').convert('RGBA'); iw,ih=im.size; al=im.getchannel('A').load()
N=80; edge=[]
for i in range(N+1):
    x=min(iw-1,round(i/N*(iw-1))); top=bot=-1
    for y in range(ih):
        if al[x,y]>140:
            if top<0: top=y
            bot=y
    if top>=0: edge.append((i/N,top/ih,bot/ih))
W,H,WB=390,300,20
w=760; h=w*ih/iw; cx,cy,rot=235,WB+h*0.42+16,-0.06
def P(u,v):
    x=(u-0.5)*w; y=(v-0.5)*h; c,s=math.cos(rot),math.sin(rot); return (cx+x*c-y*s, cy+x*s+y*c)
mid=[P(u,(t+b)/2) for u,t,b in edge]
first,last=P(0,0.5),P(1,0.5)
poly=mid+[(max(last[0],W+10),H+10),(min(first[0],-10),H+10)]
bgpath='M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in poly)+'Z'
bgdots=[]; row=0; ly=0
while ly<=H:
    k=min(1,max(0,(ly-40)/200))
    if k>0.03:
        x=4 if row%2 else 0
        while x<=W+4:
            yy=WB+ly
            if inpoly(x,yy,poly): bgdots.append(circ(x,yy,0.4+2.2*k))
            x+=8
    ly+=7; row+=1
tops=sorted(P(u,t) for u,t,b in edge)
def topAt(x):
    for i in range(1,len(tops)):
        if tops[i][0]>=x:
            (x0,y0),(x1,y1)=tops[i-1],tops[i]; return y0+(y1-y0)*(x-x0)/((x1-x0) or 1)
    return tops[-1][1]
topdots=[]; x=2; col=0
while x<=W:
    ty=topAt(x); reach=36*(1+0.28*math.sin(x/47+1)+0.15*math.sin(x/19)); dy=4+(3.4 if col%2 else 0)
    while dy<reach:
        k=1-dy/reach; r=2.7*k**0.85
        if r>=0.45: topdots.append(circ(x,ty-dy,r))
        dy+=6.8
    x+=7.5; col+=1
b64=base64.b64encode(open(A+'piano.png','rb').read()).decode()
stage='\n'.join([
  f'<g id="background"><path id="bg-teal" d="{bgpath}" fill="#3AA8C8"/><path id="bg-pink-dots" d="{"".join(bgdots)}" fill="#F4A7B9" fill-opacity="0.9"/></g>',
  f'<path id="yellow-dots-above-piano" d="{"".join(topdots)}" fill="#F7D44C" fill-opacity="0.9"/>',
  f'<image id="piano" xlink:href="data:image/png;base64,{b64}" width="{w:.2f}" height="{h:.2f}" transform="translate({cx:.2f} {cy:.2f}) rotate({rot*180/math.pi:.3f}) translate({-w/2:.2f} {-h/2:.2f})"/>'])
open(D+'piano-stage.svg','w').write(svgdoc(W,H,stage).replace('xmlns="http://www.w3.org/2000/svg"','xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'))
open(D+'piano-stage-background-only.svg','w').write(svgdoc(W,H,stage[:stage.index('<image')]))
print(sorted(os.listdir(D)))
