import math, random, re, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.normpath(os.path.join(HERE,'..','..'))
F=os.path.join(HERE,'fonts')+'/'
OUT=os.path.join(ROOT,'design','exports')+'/'
fonts={'pop':TTFont(F+'Poppins-ExtraBoldItalic.ttf'),'bang':TTFont(F+'Bangers-Regular.ttf')}
def text_path(fk,text,size,cx,cy):
    f=fonts[fk]; gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f['head'].unitsPerEm; s=size/upm
    hh=f['hhea']; asc,desc=hh.ascent,hh.descent
    names=[cmap[ord(c)] for c in text]; adv=sum(f['hmtx'][n][0] for n in names)*s
    x=cx-adv/2; base=cy+(asc+desc)/2*s
    if fk=='bang':
        from fontTools.pens.boundsPen import BoundsPen
        bp=BoundsPen(gs); [gs[n].draw(bp) for n in names]; y0,y1=bp.bounds[1],bp.bounds[3]
        base=cy+(y0+y1)/2*s
    pen=SVGPathPen(gs)
    for n in names:
        gs[n].draw(TransformPen(pen,(s,0,0,-s,x,base))); x+=f['hmtx'][n][0]*s
    return pen.getCommands()
def outlined(fk,text,size,cx,cy,out,fill,shadow=None,ident=''):
    d=text_path(fk,text,size,cx,cy); g=[f'<g id="{ident}">']
    if shadow:
        c,dx,dy=shadow
        sc_ = '#111111' if fk == 'bang' else c
        g.append(f'<g id="{ident}-shadow" transform="translate({dx} {dy})"><path d="{d}" stroke="{sc_}" stroke-width="{out*2}" stroke-linejoin="round" fill="{sc_}"/><path d="{d}" fill="{c}"/></g>')
    g.append(f'<path id="{ident}-outline" d="{d}" stroke="#111111" stroke-width="{out*2}" stroke-linejoin="round" fill="#111111"/>')
    g.append(f'<path id="{ident}-fill" d="{d}" fill="{fill}"/>'); g.append('</g>')
    return '\n'.join(g)
def circ(x,y,r): return f'M{x-r:.2f} {y:.2f}a{r:.2f} {r:.2f} 0 1 0 {2*r:.2f} 0a{r:.2f} {r:.2f} 0 1 0 {-2*r:.2f} 0Z'
def inpoly(x,y,P):
    c=False
    for i in range(len(P)):
        (x1,y1),(x2,y2)=P[i],P[i-1]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
POP=dict(Y='#FFE600',M='#FF2E93',C='#00C2FF',R='#FF2A2A',K='#111111')
def sticker(word,seed=3):
    rnd=random.Random(seed); r0=50 if len(word)>6 else 44
    sp=[r0*(0.64+rnd.random()*0.06) if i%2 else r0*(0.95+rnd.random()*0.2) for i in range(24)]
    P=[(math.cos(i/24*2*math.pi-math.pi/2)*sp[i]*1.25, math.sin(i/24*2*math.pi-math.pi/2)*sp[i]) for i in range(24)]
    poly='M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in P)+'Z'
    R=r0*1.4; k=R/100; dots=[]
    yy=-100
    while yy<=100:
        xx=-100+((yy/9)%2 and 4.5 or 0)
        while xx<=100:
            if math.hypot(xx,yy)<=100 and inpoly(xx*k,yy*k,P): dots.append(circ(xx*k,yy*k,2.6*k))
            xx+=9
        yy+=9
    fs=r0*(0.5 if len(word)>6 else 0.62 if len(word)>4 else 0.74)
    return '\n'.join([f'<path id="sticker-shadow" d="{poly}" transform="translate(7 7)" fill="{POP["M"]}"/>',
        f'<path id="sticker-base" d="{poly}" fill="{POP["Y"]}"/>',
        f'<path id="sticker-dots" d="{"".join(dots)}" fill="#FF9F1C" fill-opacity="0.55"/>',
        f'<path id="sticker-outline" d="{poly}" stroke="{POP["K"]}" stroke-width="4" stroke-linejoin="miter"/>',
        outlined('bang',word,fs,0,1,3,POP['R'],(POP['C'],3,3),'sticker-text')])
def svgdoc(w,h,body): return f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" fill="none" xmlns="http://www.w3.org/2000/svg">\n{body}\n</svg>\n'

# ---------- 记分气泡 ----------
RX,RY=118,79
ell=f'M{RX} 0A{RX} {RY} 0 1 1 {-RX} 0A{RX} {RY} 0 1 1 {RX} 0Z'
tail=f'M{-RX*0.57:.2f} {RY*0.6:.2f}L{-RX*0.66:.2f} {RY*1.17:.2f}L{-RX*0.2:.2f} {RY*0.93:.2f}Z'
def bubble(ident,fill,dx=0,dy=0):
    t=f' transform="translate({dx} {dy})"' if dx or dy else ''
    return (f'<g id="{ident}"{t}><path d="{ell}{tail}" stroke="#111111" stroke-width="9" stroke-linejoin="round"/>'
            f'<path d="{ell}" fill="{fill}"/><path d="{tail}" fill="{fill}"/></g>')
dots=[]; y=-RY; row=0
while y<=RY:
    x=-RX+(3.2 if row%2 else 0)
    while x<=RX:
        v=x/RX*0.75+y/RY*0.85; dd=max(v,-v); k=min(1,max(0,(dd-0.45)/0.85))
        r=2.4*k
        if k>0.04 and (x/(RX-r))**2+(y/(RY-r))**2<=1: dots.append(circ(x,y,r))
        x+=6.4
    y+=5.5; row+=1
s1=open(os.path.join(ROOT,'assets','game','star1.svg')).read(); s2=open(os.path.join(ROOT,'assets','game','star2.svg')).read()
p1=re.search(r' d="([^"]+)"',s1).group(1); p2=re.search(r' d="([^"]+)"',s2).group(1)
face=open(os.path.join(ROOT,'assets','game','face1.svg')).read()
face_inner=face[face.index('>')+1:face.rindex('</svg>')]
fsc=62/145; fw,fh=145*fsc,142*fsc
under=('<g id="underline" transform="translate({:.2f} {:.2f}) scale(0.46)"><path d="M30 125C70 95 125 62 148 75C165 88 150 132 125 130C102 128 105 95 135 75C160 58 200 50 262 50" '
       'stroke="#FE2C55" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></g>').format(-145*0.46,55-90*0.46)
def card(num,word):
    body=[f'<g id="score-card" transform="translate(190 178) rotate({-0.03*180/math.pi:.3f})">',
          bubble('bubble-shadow','#2F6BFF',9,9), bubble('bubble','#FFFBEA'),
          f'<path id="bubble-dots" d="{"".join(dots)}" fill="#FF2E93" fill-opacity="0.5"/>',
          outlined('pop','Score',20,0,-RY+32,2,'#FFFFFF',None,'score-label'),
          outlined('bang',str(num),72,0,0,4.5,POP['Y'],(POP['R'],5,5),'score-number'),
          under,
          f'<g id="star-big" transform="translate({RX*0.98:.2f} {RY*0.62:.2f}) scale({20/82:.4f}) translate(-41 -46)"><path d="{p1}" fill="#FECC25"/></g>',
          f'<g id="star-small" transform="translate({RX*1.12:.2f} {RY*0.1:.2f}) scale({12/82:.4f}) translate(-41 -41)"><path d="{p2}" fill="#E6FD4F"/></g>',
          f'<g id="emoji" transform="translate({-fw/2:.2f} {-RY-fh*0.88:.2f}) scale({fsc:.4f})">{face_inner}</g>',
          f'<g id="rating-sticker" transform="translate({RX-22} {-RY+18}) rotate({0.16*180/math.pi:.3f})">{sticker(word)}</g>',
          '</g>']
    return svgdoc(380,330,'\n'.join(body))
open(OUT+'score-card.svg','w').write(card(12,'GREAT!'))
for w in ['OOPS!','NICE!','GREAT!','AMAZING!','PERFECT!']:
    open(OUT+f'sticker-{w.strip("!").lower()}.svg','w').write(svgdoc(170,140,f'<g transform="translate(82 68) rotate({0.16*180/math.pi:.3f})">{sticker(w)}</g>'))
print('ok')
