import math, os, random, re
src=open(os.path.join(os.path.dirname(__file__),'export_card.py')).read()
exec(src[:src.index("# ---------- 记分气泡")])
A=os.path.join(ROOT,'assets','game')+'/'
D=OUT+'impact/'; os.makedirs(D,exist_ok=True)
POP.update(W='#FFFFFF')
def svgface(i): 
    s=open(A+f'face{i+1}.svg').read(); vb=re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"',s)
    inner=s[s.index('>')+1:s.rindex('</svg>')]
    inner=re.sub(r'id="([^"]+)"',lambda m:f'id="f{i}_{m.group(1)}"',inner); inner=re.sub(r'url\(#([^)]+)\)',lambda m:f'url(#f{i}_{m.group(1)})',inner)
    return inner,float(vb.group(1)),float(vb.group(2))
def tint(i,col):
    inner,w,h=svgface(i)
    inner=re.sub(r'<defs>.*?</defs>','',inner,flags=re.S)
    inner=re.sub(r'fill="(?!none)[^"]*"',f'fill="{col}"',inner); inner=re.sub(r'stroke="[^"]*"',f'stroke="{col}"',inner)
    return inner,w,h
def place(inner,w,h,cx,cy,size,extra=''):
    sc=size/max(w,h); return f'<g transform="translate({cx-w*sc/2:.2f} {cy-h*sc/2:.2f}) scale({sc:.4f})"{extra}>{inner}</g>'
easeOut=lambda t:1-(1-t)**3
def easeOutBack(x): c=1.70158; return 1+(c+1)*(x-1)**3+c*(x-1)**2
s1=open(A+'star1.svg').read(); s2=open(A+'star2.svg').read()
SP_=[(re.search(r' d="([^"]+)"',s1).group(1),82,93,'#FECC25'),(re.search(r' d="([^"]+)"',s2).group(1),82,82,'#E6FD4F')]
def halftone_dots(cx,cy,sc,color,op):
    out=[]; yy=-100
    while yy<=100:
        xx=-100+(4.5 if (yy/9)%2 else 0)
        while xx<=100:
            d=math.hypot(xx,yy)/100
            if d<=1:
                r=4.2*(1-d)**0.7
                if r>=0.4: out.append(circ(cx+xx*sc,cy+yy*sc,r*sc))
            xx+=9
        yy+=9
    return f'<path d="{"".join(out)}" fill="{color}" fill-opacity="{op:.2f}"/>'
def burst(word,r0,rot,bx,by,sc,seed):
    rnd=random.Random(seed); n=24
    sp=[r0*(0.62+rnd.random()*0.08) if i%2 else r0*(0.95+rnd.random()*0.25) for i in range(n)]
    P=[(math.cos(i/n*2*math.pi-math.pi/2)*sp[i]*1.25, math.sin(i/n*2*math.pi-math.pi/2)*sp[i]) for i in range(n)]
    poly='M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in P)+'Z'
    R=r0*1.4; k=R/100; dots=[]; yy=-100
    while yy<=100:
        xx=-100+((yy/9)%2 and 4.5 or 0)
        while xx<=100:
            if math.hypot(xx,yy)<=100 and inpoly(xx*k,yy*k,P): dots.append(circ(xx*k,yy*k,2.6*k))
            xx+=9
        yy+=9
    fs=r0*(0.5 if len(word)>6 else 0.62 if len(word)>4 else 0.74)
    return (f'<g id="pow-burst" transform="translate({bx:.2f} {by:.2f}) rotate({rot*180/math.pi:.2f}) scale({sc:.3f})">'
        f'<path d="{poly}" transform="translate(7 7)" fill="{POP["M"]}"/><path d="{poly}" fill="{POP["Y"]}"/>'
        f'<path d="{"".join(dots)}" fill="#FF9F1C" fill-opacity="0.55"/><path d="{poly}" stroke="{POP["K"]}" stroke-width="4"/>'
        +outlined('bang',word,fs,0,1,3,POP['R'],(POP['C'],3,3),'pow-text')+'</g>')

T=0.16                                       # 截取撞击后 0.16 秒的瞬间
X,Y=195,300                                  # 撞击点（板子上沿）
LEVELS=[(0,2,'level0-small'),(1,5,'level1'),(2,9,'level2'),(3,16,'level3-max')]
for L,score,name in LEVELS:
    rnd=random.Random(7+L); p=min(1,score/25)
    layers=[]
    # 网点爆炸
    dots=[(POP['Y'],-0.03,[0.45,0.7,0.8,1.0][L]+0.2*p)]
    if L>=1: dots.append((POP['M'],0,[0,0.9,1.15,1.4][L]+0.3*p))
    g=[]
    for c,t0,mx in dots:
        tt=(T+t0)/0.45; sc=0.35+mx*easeOut(tt); g.append(halftone_dots(X,Y-8,sc,c,1 if tt<0.6 else (1-tt)/0.4))
    layers.append('<g id="halftone-burst">'+''.join(g)+'</g>')
    # 速度线
    if L>=1:
        n=[0,10,14,20][L]; ln=[0,40,55,75][L]+30*p; t=T/0.28; rot=rnd.random()*math.pi; tri=[]
        for i in range(n):
            a=i/n*2*math.pi+rot; r0=46+70*easeOut(t); r1=r0+ln*(0.6 if i%2 else 1); w=0.045
            pts=[(math.cos(a-w)*r0,math.sin(a-w)*r0),(math.cos(a)*r1,math.sin(a)*r1),(math.cos(a+w)*r0,math.sin(a+w)*r0)]
            tri.append('M'+' L'.join(f'{X+x:.2f} {Y-8+y:.2f}' for x,y in pts)+'Z')
        layers.append(f'<path id="speed-lines" d="{"".join(tri)}" fill="{POP["K"]}" fill-opacity="{1-t*t:.2f}"/>')
    # 冲击环
    t=T/0.5; rad=16+([70,90,105,125][L]+30*p)*easeOut(t)
    layers.append(f'<g id="impact-ring"><ellipse cx="{X}" cy="{Y}" rx="{rad:.2f}" ry="{rad*0.4:.2f}" stroke="{POP["K"]}" stroke-width="{8*(1-t)+1:.2f}"/>'
                  f'<ellipse cx="{X}" cy="{Y}" rx="{rad:.2f}" ry="{rad*0.4:.2f}" stroke="{POP["Y"]}" stroke-width="{4*(1-t)+0.5:.2f}"/></g>')
    # 板子（被砸压扁 + 波普描边）
    pad=1-T*4; glow=1-T*3; pw=100*(1+0.08*pad); ph=36*(1-0.22*pad); px=X-pw/2; py=Y+(36-ph)/2+3*pad
    pp=lambda dx,dy:f'M{px+dx+ph/2:.2f} {py+dy:.2f}H{px+dx+pw-ph/2:.2f}A{ph/2:.2f} {ph/2:.2f} 0 0 1 {px+dx+pw-ph/2:.2f} {py+dy+ph:.2f}H{px+dx+ph/2:.2f}A{ph/2:.2f} {ph/2:.2f} 0 0 1 {px+dx+ph/2:.2f} {py+dy:.2f}Z'
    layers.append(f'<g id="paddle"><path d="{pp(0,0)}" fill="#000" stroke="#fff" stroke-width="2"/>'
                  f'<g opacity="{min(1,glow*1.6):.2f}"><path d="{pp(3,3)}" stroke="{POP["M"]}" stroke-width="4"/><path d="{pp(0,0)}" stroke="{POP["Y"]}" stroke-width="4"/></g></g>')
    # 表情（新表情往上弹）+ 套色残影（旧表情）
    old=L%3; new=(old+1)%3; fy=Y-28-60*T*4
    if L>=1:
        tg=T/0.38; size=66*(1+0.45*easeOut(tg)); gh=[]
        for col,d,dy in [(POP['M'],-1,0),(POP['C'],1,-1)]:
            inner,w,h=tint(old,col); gh.append(place(inner,w,h,X+d*(4+14*tg),Y-28+dy*6*tg-4*tg,size))
        layers.append(f'<g id="ghosts" opacity="{(1-tg)*0.85:.2f}">'+''.join(gh)+'</g>')
    inner,w,h=svgface(new); layers.append('<g id="emoji">'+place(inner,w,h,X,fy,66)+'</g>')
    # 纸屑
    cols=[POP['Y'],POP['W']] if L==0 else [POP['Y'],POP['M'],POP['C'],POP['W'],POP['R']]; cf=[]
    for i in range([6,11,16,24][L]+round(p*8)):
        a=-math.pi/2+(rnd.random()-0.5)*math.pi*1.2; spd=220+rnd.random()*(260+70*L+150*p)
        vx,vy=math.cos(a)*spd,math.sin(a)*spd; z=4.5+rnd.random()*(3+L); shape=(i%2)*2 if L==0 else i%4
        rot=rnd.random()*6+(rnd.random()-0.5)*16*T
        cx=X+vx*T*0.9; cy=Y-4+vy*T+500*T*T
        if shape==0: d=f'M0 {-z:.2f}L{z*0.9:.2f} {z*0.7:.2f}L{-z*0.9:.2f} {z*0.7:.2f}Z'
        elif shape==1: d=f'M{-z*0.7:.2f} {-z*0.7:.2f}h{z*1.4:.2f}v{z*1.4:.2f}h{-z*1.4:.2f}Z'
        elif shape==2: d=circ(0,0,z*0.75)
        else: d='M'+' L'.join(f'{u*z:.2f} {v*z:.2f}' for u,v in [(-1,-.3),(.1,-.3),(-.2,.2),(1,.2),(.2,1),(.4,.45),(-.6,.45)])+'Z'
        cf.append(f'<path transform="translate({cx:.2f} {cy:.2f}) rotate({rot*180/math.pi:.1f})" d="{d}" fill="{cols[i%len(cols)]}" stroke="{POP["K"]}" stroke-width="1.6"/>')
    layers.append('<g id="confetti">'+''.join(cf)+'</g>')
    # 星星
    st=[]; k=math.log(1/0.08)
    for i in range([3,5,8,12][L]+round(p*4)):
        a=-math.pi/2+(rnd.random()-0.5)*math.pi*1.35; spd=120+rnd.random()*230; delay=rnd.random()*0.08
        life=0.55+rnd.random()*0.35; size=6+rnd.random()*8; rot=rnd.random()*math.pi; tw=rnd.random()*math.pi*2
        tt=T-delay
        if tt<=0: continue
        u=tt/life; pop=easeOut(u/0.2)*1.3 if u<0.2 else 1.3-0.3*min(1,(u-0.2)/0.2)
        sz=size*pop*(0.75+0.25*math.sin(tw+T*28))
        dist=(1-math.exp(-k*tt))/k; sx=X+math.cos(a)*spd*dist; sy=Y-6+math.sin(a)*spd*dist
        dpath,w,h,col=SP_[i%2]
        st.append(f'<g transform="translate({sx:.2f} {sy:.2f}) rotate({rot*180/math.pi:.1f}) scale({sz*2/w:.4f}) translate({-w/2} {-h/2})"><path d="{dpath}" fill="{col}"/></g>')
    layers.append('<g id="stars">'+''.join(st)+'</g>')
    # POW! 爆炸字
    if L>=2:
        r0=(36 if L==2 else 46)+12*p; word=['POW!','BAM!','WOW!','ZAP!','BOOM!','YES!','WHAM!'][L+1]
        side=1 if L==2 else -1; bx=max(70,min(320,X+side*80)); by=Y-122
        layers.append(burst(word,r0,(rnd.random()-0.5)*0.45,bx,by,1.12-0.12*min(1,(T-0.13)/0.08),L))
    open(D+f'impact-{name}.svg','w').write(svgdoc(390,420,'\n'.join(layers)))
    # 拆开的版本：每一层单独放一格，方便看清每个元素
    import re as _re
    CW,CH=330,330; cols=3; rows=(len(layers)+cols-1)//cols; cells=[]
    CN={'halftone-burst':'1 Halftone burst','speed-lines':'2 Speed lines','impact-ring':'3 Impact ring','paddle':'4 Paddle squash + outline',
        'ghosts':'5 Color ghosts (old emoji)','emoji':'6 Emoji','confetti':'7 Confetti','stars':'8 Stars','pow-burst':'9 POW burst'}
    for i,lay in enumerate(layers):
        lid=_re.search(r'id="([^"]+)"',lay).group(1)
        cx=(i%cols)*CW+CW/2; cy=(i//cols)*CH+CH/2+14
        ox,oy=X,Y-30
        if lid=='pow-burst': m=_re.search(r'translate\(([-\d.]+) ([-\d.]+)\) rotate',lay); ox,oy=float(m.group(1)),float(m.group(2))
        sc=0.62 if lid in ('halftone-burst','speed-lines') else 0.9
        cells.append(f'<g id="cell-{lid}"><rect x="{(i%cols)*CW+6}" y="{(i//cols)*CH+6}" width="{CW-12}" height="{CH-12}" rx="14" fill="#EFEAE0"/>'
                     f'<text x="{(i%cols)*CW+20}" y="{(i//cols)*CH+30}" fill="#666666" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="600">{CN.get(lid,lid)}</text>'
                     f'<g transform="translate({cx} {cy}) scale({sc}) translate({-ox} {-oy})">{lay}</g></g>')
    open(D+f'impact-{name}-exploded.svg','w').write(svgdoc(cols*CW,rows*CH,'\n'.join(cells)))
print(sorted(os.listdir(D)))
