import math, os
src=open(os.path.join(os.path.dirname(__file__),'export_card.py')).read()
head=src[:src.index("open(OUT+'score-card.svg'")]       # 复用函数和气泡/网点数据，不写原来的文件
exec(head)
D=OUT+'score-card-parts/'; os.makedirs(D,exist_ok=True)
# 1) 底部气泡（蓝色阴影 + 气泡 + 网点），画布以气泡中心为基准
W,H=260,190; cx,cy=124,84
open(D+'bubble.svg','w').write(svgdoc(W,H,f'<g id="bubble-base" transform="translate({cx} {cy})">'+bubble('bubble-shadow','#2F6BFF',9,9)+bubble('bubble','#FFFBEA')+
    f'<path id="bubble-dots" d="{"".join(dots)}" fill="#FF2E93" fill-opacity="0.5"/></g>'))
# 2) Score 文字
open(D+'score-text.svg','w').write(svgdoc(80,34,outlined('pop','Score',20,40,17,2,'#FFFFFF',None,'score-label')))
# 3) 数字下面的手绘线
open(D+'underline.svg','w').write(svgdoc(112,44,'<g id="underline" transform="translate(-10.5 -20) scale(0.46)"><path d="M30 125C70 95 125 62 148 75C165 88 150 132 125 130C102 128 105 95 135 75C160 58 200 50 262 50" stroke="#FE2C55" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></g>'))
# 4) 数字 1-20：统一画布大小，数字居中，方便替换对齐
for n in range(1,21):
    open(D+f'number-{n}.svg','w').write(svgdoc(120,86,outlined('bang',str(n),72,58,41,4.5,POP['Y'],(POP['R'],5,5),f'number-{n}')))
print(sorted(os.listdir(D)))
