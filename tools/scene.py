"""Reproducible original picnic meshes and the Box3D course, using no art SDK."""
from pathlib import Path
import base64
import json
import math
import random
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
TAU = math.tau
COUNT = 240
WIDTH = 12.5
COLORS = {
    'grass': '#99bb7d', 'leaf': '#568e70', 'dark': '#294c53', 'road': '#edd5aa',
    'cream': '#fff0ce', 'pink': '#ec7e8a', 'red': '#d95662', 'blue': '#83bdda',
    'yellow': '#efc65b', 'purple': '#a79cd7', 'white': '#fff4e8', 'tire': '#343e50',
}


def color(value):
    value = COLORS.get(value, value).lstrip('#')
    return [int(value[i:i+2], 16)/255 for i in (0, 2, 4)] + [1]


class Mesh:
    def __init__(self):
        self.groups = {}

    def merge(self, other, offset):
        for material,(positions,normals) in other.groups.items():
            group=self.groups.setdefault(material,[[],[]])
            group[0].extend([[p[k]+offset[k] for k in range(3)] for p in positions])
            group[1].extend(normals)

    def tri(self, a, b, c, material, normals=None):
        if normals is None:
            ab = [b[i]-a[i] for i in range(3)]
            ac = [c[i]-a[i] for i in range(3)]
            n = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]]
            length = math.sqrt(sum(v*v for v in n)) or 1
            normals = [[v/length for v in n]]*3
        # Bake a small toon palette into the geometry. This keeps the picnic
        # bright and avoids changing the platform's shared lighting defaults.
        normal = [sum(n[k] for n in normals)/3 for k in range(3)]
        light = max(0, normal[0]*.35 + normal[1]*.85 + normal[2]*.25)
        shade = .78 + round(light*4)*.055
        material = '#' + ''.join(f'{min(255,round(c*255*shade)):02x}' for c in color(material)[:3])
        group = self.groups.setdefault(material, [[], []])
        group[0].extend([a, b, c])
        group[1].extend(normals)

    def quad(self, a, b, c, d, material):
        self.tri(a, b, c, material)
        self.tri(a, c, d, material)

    def box(self, p, size, material, yaw=0):
        corners = []
        for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
            x, y, z = x*size[0]/2, y*size[1]/2, z*size[2]/2
            corners.append([p[0]+x*math.cos(yaw)+z*math.sin(yaw),p[1]+y,p[2]+z*math.cos(yaw)-x*math.sin(yaw)])
        for face in [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(3,7,6,2),(0,1,5,4)]:
            self.quad(*(corners[i] for i in face),material)

    def ellipsoid(self, p, size, material, rings=8, segments=14):
        def point(i,j):
            v, u = math.pi*i/rings, TAU*j/segments
            n = [math.sin(v)*math.cos(u), math.cos(v), math.sin(v)*math.sin(u)]
            pos = [p[k]+n[k]*size[k] for k in range(3)]
            normal = [n[k]/size[k] for k in range(3)]
            length = math.sqrt(sum(x*x for x in normal))
            return pos,[x/length for x in normal]
        for i in range(rings):
            for j in range(segments):
                a,b,c,d = point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)
                self.tri(a[0],b[0],c[0],material,[a[1],b[1],c[1]])
                self.tri(a[0],c[0],d[0],material,[a[1],c[1],d[1]])

    def torus(self, p, major, minor, material, vertical=False, segments=24):
        def point(u,v):
            x=(major+minor*math.cos(v))*math.cos(u)
            z=(major+minor*math.cos(v))*math.sin(u)
            y=minor*math.sin(v)
            if vertical: y,z=z,y
            return [p[0]+x,p[1]+y,p[2]+z]
        for i in range(segments):
            for j in range(8):
                self.quad(point(TAU*i/segments,TAU*j/8),point(TAU*(i+1)/segments,TAU*j/8),
                          point(TAU*(i+1)/segments,TAU*(j+1)/8),point(TAU*i/segments,TAU*(j+1)/8),material)

    def save(self, name):
        data=bytearray(); views=[]; accessors=[]
        def accessor(values, kind):
            flat=[v for row in values for v in row]
            offset=len(data)
            data.extend(struct.pack('<'+'f'*len(flat),*flat))
            views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)-offset,'target':34962})
            accessors.append({'bufferView':len(views)-1,'componentType':5126,'count':len(values),'type':kind,
                              'min':[min(row[k] for row in values) for k in range(len(values[0]))],
                              'max':[max(row[k] for row in values) for k in range(len(values[0]))]})
            return len(accessors)-1
        # A tiny nearest-filtered palette gives every triangle its baked color
        # with one material and one draw call per model (rather than per shade).
        positions=[]; normals=[]; uvs=[]; pixels=bytearray()
        width=len(self.groups)
        for index,(material,(points,directions)) in enumerate(self.groups.items()):
            positions.extend(points);normals.extend(directions)
            uvs.extend([[(index+.5)/width,.5]]*len(points))
            pixels.extend(round(c*255) for c in color(material))
        # Reuse exactly equal GPU vertices. Sequential triangle indices discard
        # the post-transform cache and made the original art needlessly costly.
        unique={}; shared_positions=[]; shared_normals=[]; shared_uvs=[]; indices=[]
        for p,n,uv in zip(positions,normals,uvs):
            key=struct.pack('<8f',*p,*n,*uv)
            index=unique.get(key)
            if index is None:
                index=len(shared_positions);unique[key]=index
                shared_positions.append(p);shared_normals.append(n);shared_uvs.append(uv)
            indices.append(index)
        positions,normals,uvs=shared_positions,shared_normals,shared_uvs
        def chunk(kind, content):
            return struct.pack('>I',len(content))+kind+content+struct.pack('>I',zlib.crc32(kind+content))
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+pixels))+chunk(b'IEND',b'')
        attrs={'POSITION':accessor(positions,'VEC3'),'NORMAL':accessor(normals,'VEC3'),'TEXCOORD_0':accessor(uvs,'VEC2')}
        offset=len(data)
        data.extend(struct.pack('<'+'I'*len(indices),*indices))
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)-offset,'target':34963})
        accessors.append({'bufferView':len(views)-1,'componentType':5125,'count':len(indices),'type':'SCALAR'})
        primitives=[{'attributes':attrs,'indices':len(accessors)-1,'material':0,'mode':4}]
        materials=[{'name':'Picnic palette','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':1},'doubleSided':True,'extensions':{'KHR_materials_unlit':{}}}]
        model={'asset':{'version':'2.0','generator':'Wobble Rally original procedural art'},'extensionsUsed':['KHR_materials_unlit'],'scene':0,'scenes':[{'nodes':[0]}],
               'nodes':[{'mesh':0}],'meshes':[{'primitives':primitives}],'materials':materials,'accessors':accessors,'bufferViews':views,
               'images':[{'uri':'data:image/png;base64,'+base64.b64encode(png).decode()}],'textures':[{'source':0,'sampler':0}],
               'samplers':[{'magFilter':9728,'minFilter':9728,'wrapS':33071,'wrapT':33071}],
               'buffers':[{'byteLength':len(data),'uri':'data:application/octet-stream;base64,'+base64.b64encode(data).decode()}]}
        (ROOT/'assets'/f'{name}.gltf').write_text(json.dumps(model,separators=(',',':'))+'\n')


def track_point(t):
    a=TAU*t
    return [56*math.sin(a)+8*math.sin(2*a), 1.6+1.8*(1-math.cos(a)), -53*math.cos(a)+8*math.sin(3*a)]


def make_course():
    points=[track_point(i/COUNT) for i in range(COUNT)]
    samples=[]; distance=0
    for i,p in enumerate(points):
        prev=points[(i-1)%COUNT]; nxt=points[(i+1)%COUNT]
        yaw=math.atan2(nxt[0]-prev[0],nxt[2]-prev[2])
        samples.append({'p':p,'yaw':yaw,'s':distance})
        distance+=math.dist(p,nxt)
    stage=Mesh()
    # A flat lawn roots the props; rounded edges keep the toy island silhouette.
    stage.ellipsoid([0,-7,0],[106,7,98],'leaf',rings=10,segments=64)
    for i in range(64):
        a,b=TAU*i/64,TAU*(i+1)/64
        stage.tri([0,0,0],[104*math.cos(b),0,96*math.sin(b)],[104*math.cos(a),0,96*math.sin(a)],'grass')
    stage.ellipsoid([0,-15,0],[140,5,132],'blue',rings=6,segments=48)
    entities=[]
    for i,a in enumerate(samples):
        b=samples[(i+1)%COUNT]
        pa,pb=a['p'],b['p']
        tangent=[math.sin(a['yaw']),0,math.cos(a['yaw'])]
        normal=[tangent[2],0,-tangent[0]]
        nb=[math.cos(b['yaw']),0,-math.sin(b['yaw'])]
        edge=lambda p,n,k:[p[0]+n[0]*k,p[1],p[2]+n[2]*k]
        stage.quad(edge(pa,normal,-WIDTH/2),edge(pb,nb,-WIDTH/2),edge(pb,nb,WIDTH/2),edge(pa,normal,WIDTH/2),'road')
        for side in [-1,1]:
            stage.quad(edge(pa,normal,side*(WIDTH/2)),edge(pb,nb,side*(WIDTH/2)),
                       edge(pb,nb,side*(WIDTH/2+0.65)),edge(pa,normal,side*(WIDTH/2+0.65)),'pink' if i//2%2 else 'white')
            outer_a=edge(pa,normal,side*(WIDTH/2+4));outer_a[1]=0
            outer_b=edge(pb,nb,side*(WIDTH/2+4));outer_b[1]=0
            stage.quad(edge(pa,normal,side*(WIDTH/2+.65)),edge(pb,nb,side*(WIDTH/2+.65)),outer_b,outer_a,'grass')
        mid=[(pa[k]+pb[k])/2 for k in range(3)]
        yaw=math.degrees(math.atan2(pb[0]-pa[0],pb[2]-pa[2]))
        length=math.dist(pa,pb)
        pitch=-math.degrees(math.asin((pb[1]-pa[1])/length))
        for side in [-1,1]:
            p=edge(mid,normal,side*(WIDTH/2+0.75));p[1]+=0.45
            if i%2==0:
                stage.box([p[0],p[1]-0.15,p[2]],[0.48,0.7,length*1.7],'cream',math.radians(yaw))
        if i%5==0:
            stage.box([pa[0],pa[1]+0.025,pa[2]],[0.12,0.025,0.8],'cream',a['yaw'])
        # Physics needs fewer sections than the decorative mesh. With overlapping
        # 4.4 m slabs the maximum chord error stays well below a kart's radius.
        if i%3==0:
            end=samples[(i+3)%COUNT];q=end['p']
            center=[(pa[k]+q[k])/2 for k in range(3)]
            span=math.dist(pa,q)
            ry=math.degrees(math.atan2(q[0]-pa[0],q[2]-pa[2]))
            rx=-math.degrees(math.asin((q[1]-pa[1])/span))
            entities.append({'id':1000+i,'transform':{'position':[center[0],center[1]-.21,center[2]],'rotation':[rx,ry,0]},
                             'rigidBody':{'type':'static'},'collider':{'shape':'box','size':[WIDTH+2,.42,span+.3],'friction':.05,'restitution':0}})
            for side in [-1,1]:
                left=edge(pa,normal,side*(WIDTH/2+.75))
                right=edge(q,[math.cos(end['yaw']),0,-math.sin(end['yaw'])],side*(WIDTH/2+.75))
                center=[(left[k]+right[k])/2 for k in range(3)];center[1]+=.45
                span=math.dist(left,right)
                ry=math.degrees(math.atan2(right[0]-left[0],right[2]-left[2]))
                rx=-math.degrees(math.asin((right[1]-left[1])/span))
                entities.append({'id':2000+i*2+(side+1)//2,'transform':{'position':center,'rotation':[rx,ry,0]},
                                 'rigidBody':{'type':'static'},'collider':{'shape':'box','size':[.42,1.25,span+.3],'friction':.1,'restitution':.12}})
    # Finish carpet and bunting gateway.
    origin=samples[0]['p']; yaw=samples[0]['yaw'];n=[math.cos(yaw),0,-math.sin(yaw)];f=[math.sin(yaw),0,math.cos(yaw)]
    def at(x,y,z): return [origin[0]+n[0]*x+f[0]*z,origin[1]+y,origin[2]+n[2]*x+f[2]*z]
    for x in range(12):
        for z in range(2): stage.box(at(x-5.5,0.03,z-0.5),[1,0.025,1],'cream' if (x+z)%2 else 'dark',yaw)
    for side in [-1,1]:
        stage.box(at(side*7,5.1,0),[0.6,10.2,0.6],'pink')
        stage.ellipsoid(at(side*7,10.3,0),[0.7,0.7,0.7],'yellow')
    stage.box(at(0,9.7,0),[14,1.25,0.4],'cream',yaw)
    # Simple checkers read as a finish banner even on a small phone.
    for x in range(12):
        for y in range(2):
            if (x+y)%2:stage.box(at((x-5.5)*.6,9.43+y*.55,-.24),[.54,.5,.05],'pink',yaw)
    for i in range(9):
        stage.tri(at(i*1.4-6.3,9,0),at(i*1.4-5.1,9,0),at(i*1.4-5.7,7.9,0),'pink' if i%2 else 'blue')
    # Put the picnic in view of the first approach, clear of the racing corridor.
    tea=Mesh()
    for x in range(10):
        for z in range(8): tea.box([-17+x*3,0.08,-14+z*3],[3,0.12,3],'white' if (x+z)%2 else '#d86a7c')
    tea.ellipsoid([-10,6,-2],[7,6,6],'blue',rings=12,segments=24)
    tea.ellipsoid([-10,11.7,-2],[4.6,0.7,4.1],'cream')
    tea.ellipsoid([-10,12.8,-2],[1,0.9,1],'pink')
    tea.torus([-17,7,-2],3.7,0.8,'blue',vertical=True)
    tea.ellipsoid([-3.5,7,-2],[3.7,1.3,1.3],'blue')
    tea.ellipsoid([0,9,-2],[1.1,3,1.1],'blue')
    tea.ellipsoid([0,11.8,-2],[1.25,0.2,1.25],'dark')
    for x in [-12,-8]:
        tea.ellipsoid([x,7,-7.6],[0.55,0.75,0.18],'dark')
        tea.ellipsoid([x-.1,7.3,-7.75],[0.16,0.22,0.07],'white')
    stage.merge(tea,[37,0,-22])
    # Sandwich arch at the east bend, comfortably above the racing line.
    q=samples[62];p=q['p'];yaw=q['yaw'];n=[math.cos(yaw),0,-math.sin(yaw)]
    for side in [-1,1]:
        atp=[p[0]+n[0]*side*8,p[1]+3.5,p[2]+n[2]*side*8]
        stage.box(atp,[2.1,7,3.5],'yellow',yaw)
    for y,h,col in [(7.2,.5,'leaf'),(7.8,.8,'red'),(8.4,.35,'yellow'),(9.1,1,'cream')]:
        stage.box([p[0],p[1]+y,p[2]],[18,h,5],col,yaw)
    # Puffy bread crust and sesame seeds make the arch unmistakably edible.
    for j in range(9):
        x=(j-4)*1.85
        stage.ellipsoid([p[0]+n[0]*x,p[1]+9.58,p[2]+n[2]*x],[1,.65,2.6],'cream',rings=6,segments=10)
        stage.ellipsoid([p[0]+n[0]*x,p[1]+10.1,p[2]+n[2]*x],[.23,.08,.45],'yellow',rings=4,segments=8)
    # Jelly hills, daisies and little spectators beside the course.
    rng=random.Random(42)
    for i in range(0,COUNT,7):
        q=samples[i]; side=1 if i%3 else -1
        offset=side*rng.uniform(11,19)
        p=[q['p'][0]+math.cos(q['yaw'])*offset,0,q['p'][2]-math.sin(q['yaw'])*offset]
        if i%3==0:
            col=['pink','purple','yellow'][i%3 if i%2 else 1]
            stage.ellipsoid([p[0],1.3,p[2]],[2,2.4,2],col)
            for dx in [-.6,.6]: stage.ellipsoid([p[0]+dx,2.3,p[2]+1.75],[.19,.32,.18],'dark',rings=5,segments=8)
        else:
            height=rng.uniform(3,6)
            stage.box([p[0],height/2,p[2]],[.23,height,.23],'leaf')
            stage.ellipsoid([p[0],height,p[2]],[.6,.5,.6],'yellow')
            for j in range(6):
                a=TAU*j/6
                stage.ellipsoid([p[0]+math.cos(a),height,p[2]+math.sin(a)],[.75,.22,.75],'white',rings=5,segments=8)
    for x,z,y in [(-85,-65,28),(83,65,31),(-70,85,29),(70,-95,32)]:
        for j in range(3):stage.ellipsoid([x+(j-1)*5,y+(2 if j==1 else 0),z],[6,3.5,4],'white',rings=6,segments=12)
    stage.save('picnic')
    (ROOT/'src/track.json').write_text(json.dumps({'samples':samples,'length':distance,'width':WIDTH},separators=(',',':'))+'\n')
    return entities,samples


def make_kart(index):
    m=Mesh(); col=['pink','blue','yellow','purple'][index]
    m.ellipsoid([0,.3,0],[.92,.42,1.35],col)
    m.box([0,.36,-1.18],[1.75,.2,.22],'cream')
    m.box([0,.43,.91],[1.55,.17,.66],'cream')
    m.ellipsoid([0,1.05,-.12],[.53,.66,.51],col)
    m.ellipsoid([0,1.72,-.1],[.61,.57,.54],'cream')
    for x in [-.24,.24]:
        m.ellipsoid([x,1.82,.40],[.095,.14,.055],'dark',rings=5,segments=8)
    m.ellipsoid([0,1.57,.45],[.17,.12,.16],'pink',rings=5,segments=8)
    if index==0:
        for x in [-.35,.35]: m.ellipsoid([x,2.34,-.1],[.18,.54,.21],'pink')
    elif index==1:
        m.ellipsoid([0,2.15,-.1],[.8,.16,.7],'blue')
        m.ellipsoid([0,2.37,-.1],[.35,.3,.35],'blue')
    elif index==2:
        for x in [-.44,0,.44]:m.box([x,2.3,-.1],[.28,.47,.5],'yellow')
    else:
        for x in [-.45,.45]:m.ellipsoid([x,2.22,-.1],[.27,.3,.24],'purple')
    m.save(f'kart-{index}')
    return m


def main():
    (ROOT/'assets').mkdir(exist_ok=True)
    entities,samples=make_course()
    for i in range(4):make_kart(i)
    wheel=Mesh();wheel.ellipsoid([0,0,0],[.23,.38,.38],'tire',rings=8,segments=12)
    wheel.ellipsoid([0.24,0,0],[.015,.18,.18],'cream',rings=5,segments=10)
    wheel.box([.26,0,0],[.015,.3,.05],'tire');wheel.save('wheel')
    item=Mesh(); item.box([0,0,0],[1.05,1.05,1.05],'yellow'); item.box([0,0,.54],[.65,.16,.04],'cream');item.box([0,0,.54],[.16,.65,.04],'cream');item.save('pickup')
    goose=Mesh();goose.ellipsoid([0,0,0],[.36,.4,.65],'white');goose.ellipsoid([0,.65,.25],[.16,.55,.16],'white')
    goose.ellipsoid([0,1.12,.35],[.27,.25,.32],'white');goose.box([0,1.08,.71],[.28,.1,.4],'yellow')
    for x in [-.24,.24]:goose.ellipsoid([x,1.2,.48],[.045,.065,.05],'dark')
    goose.save('goose')
    jelly=Mesh();jelly.ellipsoid([0,0,0],[1.6,.23,1.6],'purple');jelly.save('jelly')
    bottle=Mesh();bottle.ellipsoid([0,0,0],[.22,.22,.6],'leaf');bottle.box([0,0,.1],[.45,.45,.35],'cream');bottle.box([0,0,-.63],[.18,.18,.15],'red');bottle.save('soda')
    camera={'id':0,'canvas':{'bitmask':2},'transform':{'position':[0,12,-75]},'camera':{'projection':'perspective','target':[0,3,-50],'up':[0,1,0],'fieldOfView':58,'near':.1,'far':1000}}
    sky={'id':11,'canvas':{'bitmask':2},'transform':{'scale':[1200,1200,1200]},'drawable':{'shape':'box','color':color('#bcdedc')}}
    entities=[camera,{'id':1,'script':{'source':'scripts/main.js'}},sky,{'id':10,'canvas':{'bitmask':2},'transform':{},'model':{'source':'assets/picnic.gltf'}}]+entities
    for i in range(4):
        p=samples[-5-i*2]['p']
        entities.append({'id':100+i,'name':f'Kart body {i}','transform':{'position':[p[0],p[1]+1,p[2]]},
                         'rigidBody':{'type':'dynamic','lockRotation':[True,True,True],'linearDamping':0,'gravityScale':1},
                         'collider':{'shape':'sphere','radius':.72,'friction':.03,'restitution':.08,'density':1}})
        entities.append({'id':200+i,'canvas':{'bitmask':2},'transform':{'position':[p[0],p[1],p[2]]},'model':{'source':f'assets/kart-{i}.gltf'}})
        for w in range(4):entities.append({'id':220+i*4+w,'canvas':{'bitmask':2},'transform':{'scale':[1 if w%2 else -1,1,1]},'model':{'source':'assets/wheel.gltf'}})
        entities.append({'id':240+i,'canvas':{'bitmask':2},'transform':{'rotation':[-90,0,0],'scale':[2.4,3.4,1]},'drawable':{'shape':'circle','color':[.16,.2,.18,.22]}})
        entities.append({'id':450+i,'canvas':{'bitmask':0},'transform':{},'model':{'source':'assets/soda.gltf'}})
        for bubble in range(4):entities.append({'id':460+i*4+bubble,'canvas':{'bitmask':0},'transform':{},'drawable':{'shape':'box','color':color('cream')}})
    for i in range(12):entities.append({'id':300+i,'canvas':{'bitmask':2},'transform':{},'model':{'source':'assets/pickup.gltf'}})
    for i in range(8):entities.append({'id':400+i,'canvas':{'bitmask':0},'transform':{},'model':{'source':'assets/goose.gltf'}})
    for i in range(8):entities.append({'id':420+i,'canvas':{'bitmask':0},'transform':{},'model':{'source':'assets/jelly.gltf'}})
    scene={'systems':[{'Atlas::Systems::PhysicsSystem':{'gravity':[0,-20,0],'subSteps':2}},
                       {'Atlas::Systems::PbrSystem':{'context':2,'pipeline':'atlas:pbr-lite'}},
                       {'Atlas::Systems::GraphicsSystem':{'context':2,'pipeline':'atlas:unlit'}}],'entities':entities}
    (ROOT/'scene/scene.json').write_text(json.dumps(scene,separators=(',',':'))+'\n')
    print(f'Generated original picnic art, {len(entities)} entities and {COUNT} course sections.')


if __name__=='__main__':main()
