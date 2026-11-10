import math, os
src=open(os.path.join(os.path.dirname(__file__),'export_card.py')).read()
exec(src[:src.index("# ---------- 记分气泡")])
D=OUT+'hud/'; os.makedirs(D,exist_ok=True)
def adv(fk,text,size):
    f=fonts[fk]; cmap=f.getBestCmap(); return sum(f['hmtx'][cmap[ord(c)]][0] for c in text)*size/f['head'].unitsPerEm
def pill(x,y,w,h,r): return f'M{x+r} {y}H{x+w-r}A{r} {r} 0 0 1 {x+w-r} {y+h}H{x+r}A{r} {r} 0 0 1 {x+r} {y}Z'
for n in range(0,21):
    num=str(n); lw=adv('pop','Score',14); nw=adv('bang',num,30)
    w=18+lw+10+nw+18; h=40; x0=-w/2; y0=-h/2
    W_,H_=math.ceil(w+16),56
    body=[f'<g id="scoreboard" transform="translate({W_/2-2:.2f} {H_/2-2:.2f}) rotate({-0.03*180/math.pi:.3f})">',
      f'<path id="pill-shadow" d="{pill(x0+4,y0+4,w,h,h/2)}" fill="#2F6BFF" stroke="#111111" stroke-width="3"/>',
      f'<path id="pill" d="{pill(x0,y0,w,h,h/2)}" fill="#FFFBEA" stroke="#111111" stroke-width="3"/>',
      outlined('pop','Score',14,x0+18+lw/2,1,2,'#FFFFFF',None,'label'),
      outlined('bang',num,30,x0+18+lw+10+nw/2,1,3,POP['Y'],(POP['R'],2.5,2.5),'number'),
      '</g>']
    open(D+f'scoreboard-{n}.svg','w').write(svgdoc(W_,H_,'\n'.join(body)))
# 上角网点（和游戏里同一套算法）
CW,CH=210,240
def corner(seed):
    islands=[[148,22,28],[24,170,26]] if seed else [[140,26,26],[22,162,28]]
    out=[]; y=3; row=0
    while y<=CH:
        x=3+(4.25 if row%2 else 0)
        while x<=CW:
            th=math.atan2(y,x)
            edge=1+0.09*math.sin(4*th+seed*2.1+1)+0.04*math.sin(9*th+seed*3.7+2)
            k=1-math.hypot(x/150,y/165)/edge
            for ix,iy,ir in islands: k=max(k,0.42*(1-math.hypot(x-ix,y-iy)/ir))
            r=3.3*max(0,k)**0.75
            if r>=0.45 and not (x<20 and y<20 and math.hypot(20-x,20-y)>20-r): out.append((x,y,r))   # 屏幕圆角外的不要
            x+=8.5
        y+=7.4; row+=1
    return out
for seed,col,name,mirror in [(0,'#FF2E93','corner-left',False),(1,'#25F4EE','corner-right',True)]:
    d=''.join(circ(CW-x if mirror else x,y,r) for x,y,r in corner(seed))
    open(D+name+'.svg','w').write(svgdoc(CW,CH,f'<path id="{name}-dots" d="{d}" fill="{col}" fill-opacity="0.75"/>'))
print(sorted(os.listdir(D)))
