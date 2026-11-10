import os
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'export_card.py')).read()
exec(src[:src.index("# ---------- 记分气泡")])
D=OUT; 
def pill(x,y,w,h,r): return f'M{x+r} {y}H{x+w-r}A{r} {r} 0 0 1 {x+w-r} {y+h}H{x+r}A{r} {r} 0 0 1 {x+r} {y}Z'
def btn(press):
    o=3 if press else 0; sh=2 if press else 5
    body=[f'<path id="button-shadow" d="{pill(o+sh,o+sh,132,44,22)}" fill="#111111"/>',
          f'<path id="button" d="{pill(o+1.5,o+1.5,129,41,20.5)}" fill="#FFE600" stroke="#111111" stroke-width="3"/>',
          outlined('pop','Retry',21,o+66,o+21,2,'#FFFFFF',None,'retry-text')]
    return svgdoc(137,49,'\n'.join(body))
open(D+'retry-button.svg','w').write(btn(False))
open(D+'retry-button-pressed.svg','w').write(btn(True))
print('ok', D)
