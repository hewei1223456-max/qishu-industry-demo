"""Bounded, source-preserving local preprocessing. Recognition is not semantic AI."""
from __future__ import annotations
import sys, json, zipfile, shutil, hashlib, re, posixpath, itertools, os
from pathlib import Path
from xml.etree import ElementTree as ET

SOURCE=Path(sys.argv[1]); OUTPUT=Path(sys.argv[2]); OUTPUT.mkdir(parents=True,exist_ok=True)
# Separate process plus a POSIX address-space cap; Windows still relies on document
# bounds and the supervisor timeout, not an unimplemented Job Object guarantee.
if os.name=='posix':
    try:
        import resource
        memory_limit=int(os.environ.get('QISHU_PARSE_MAX_MEMORY_MB','1536'))*1024**2
        resource.setrlimit(resource.RLIMIT_AS,(memory_limit,memory_limit))
    except (ValueError,ImportError,OSError): pass
MAX_ENTRIES=4000; MAX_XML=16*1024*1024; MAX_EXPANDED=4*1024**3
MAX_MEDIA=80*1024**2; MAX_PAGES=300; MAX_CARDS=500; MAX_TEXT=300_000
cards=[]; warnings=[]; seen_assets={}; expanded=0
NS={'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
IMAGE={'.jpg','.jpeg','.png','.webp','.gif','.bmp','.tif','.tiff'}
MEDIA={'.mp4','.mov','.m4v','.webm','.mp3','.wav','.m4a','.aac','.ogg'}
ALLOWED=IMAGE|MEDIA|{'.pptx','.pdf','.docx','.txt','.md','.csv','.json','.zip','.ppt'}

def progress(message):
    print(json.dumps({'progress':message},ensure_ascii=False),flush=True)

def add_card(title,body,origin,page=None,images=None,**extra):
    if len(cards)>=MAX_CARDS: return
    title=(title or '待补充标题').strip()[:180]
    body=(body or '').strip()[:12000]
    images=images or []
    cards.append({'title':title,'body':body,'source':origin,'page':page,
                  'images':images,'image':images[0]['path'] if images else None,
                  'semanticStatus':'needs_review','tags':[],**extra})

def asset(stream,name,size):
    if size>MAX_MEDIA:
        warnings.append(f'媒体较大，保留源文件待专用处理：{name}')
        return None
    ext=Path(name).suffix.lower()
    key=hashlib.sha256(name.encode('utf-8')).hexdigest()[:20]+ext
    out=OUTPUT/'images'/key; out.parent.mkdir(exist_ok=True)
    if key not in seen_assets:
        with out.open('wb') as target: shutil.copyfileobj(stream,target,1024*1024)
        meta={'path':'images/'+key,'name':Path(name).name}
        if ext in IMAGE:
            try:
                from PIL import Image, ImageOps
                with Image.open(out) as im:
                    meta.update(width=im.width,height=im.height)
                    if im.width*im.height<=60_000_000:
                        thumb=ImageOps.exif_transpose(im)
                        thumb.thumbnail((1000,1600))
                        if thumb.mode not in ('RGB','L'): thumb=thumb.convert('RGB')
                        preview=out.with_name(out.stem+'-preview.jpg')
                        thumb.save(preview,quality=84)
                        meta['preview']='images/'+preview.name
            except Exception:
                meta['previewWarning']='未生成预览，原件保留'
        seen_assets[key]=meta
    return seen_assets[key]

def zip_guard(z):
    global expanded
    entries=z.infolist()
    if len(entries)>MAX_ENTRIES: raise ValueError('压缩包条目过多')
    total=sum(i.file_size for i in entries)
    if total>MAX_EXPANDED: raise ValueError('压缩展开大小超过安全限制')
    for i in entries:
        norm=i.filename.replace('\\','/')
        if norm.startswith('/') or '..' in norm.split('/') or re.match(r'^[A-Za-z]:',norm):
            raise ValueError('压缩包包含不安全路径')
        mode=(i.external_attr>>16)&0o170000
        if mode==0o120000: raise ValueError('不接受压缩包符号链接')
        if i.flag_bits&1: raise ValueError('请先解密压缩包再上传')
        if i.file_size>20*1024*1024 and i.compress_size and i.file_size/i.compress_size>1500:
            raise ValueError('异常压缩率，需人工确认后处理')
    return entries

def xml(z,name):
    info=z.getinfo(name)
    if info.file_size>MAX_XML: raise ValueError('文档XML超过解析上限')
    raw=z.read(name)
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('不接受XML外部实体')
    return ET.fromstring(raw)

def parse_pptx(path,origin):
    with zipfile.ZipFile(path) as z:
        zip_guard(z)
        slides=sorted([n for n in z.namelist() if re.match(r'^ppt/slides/slide\d+\.xml$',n)],
                      key=lambda n:int(re.search(r'(\d+)\.xml$',n).group(1)))
        for index,name in enumerate(slides[:MAX_PAGES],1):
            slide=xml(z,name)
            # Collect textual runs without concatenating non-text XML attributes.
            paragraphs=[''.join(p.itertext()).strip() for p in slide.findall('.//a:t',NS)]
            lines=[x for x in paragraphs if x]
            relname=posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')
            rels={}
            if relname in z.namelist():
                for relation in xml(z,relname):
                    if relation.attrib.get('TargetMode')=='External': continue
                    target=posixpath.normpath(posixpath.join(posixpath.dirname(name),relation.attrib.get('Target','')))
                    rels[relation.attrib.get('Id')]=target
            imgs=[]
            for blip in slide.findall('.//a:blip',NS):
                target=rels.get(blip.attrib.get('{'+NS['r']+'}embed'))
                if target and target.startswith('ppt/media/') and target in z.namelist():
                    info=z.getinfo(target)
                    if Path(target).suffix.lower() in IMAGE:
                        with z.open(target) as src:
                            meta=asset(src,origin+'/'+target,info.file_size)
                        if meta: imgs.append(meta)
            add_card(lines[0] if lines else f'{Path(origin).stem} 第{index}页','\n'.join(lines),origin,index,imgs)
            if index%10==0: progress(f'已拆解{index}页幻灯片')
        if len(slides)>MAX_PAGES: warnings.append(f'共{len(slides)}页，首批提取{MAX_PAGES}页，剩余待分批处理')

def parse_docx(path,origin):
    with zipfile.ZipFile(path) as z:
        zip_guard(z)
        doc=xml(z,'word/document.xml')
        paragraphs=[''.join(p.itertext()).strip() for p in doc.findall('.//w:t',NS)]
        full_text='\n'.join(x for x in paragraphs if x)
        body=full_text[:MAX_TEXT]
        if len(full_text)>MAX_TEXT: warnings.append(f'DOCX文本超过{MAX_TEXT}字符，首批提取上限内内容，原件保留待分批处理')
        imgs=[]
        for name in z.namelist():
            if name.startswith('word/media/') and Path(name).suffix.lower() in IMAGE and len(imgs)<12:
                with z.open(name) as src:
                    meta=asset(src,origin+'/'+name,z.getinfo(name).file_size)
                if meta: imgs.append(meta)
        for i in range(0,max(len(body),1),6000):
            add_card(Path(origin).stem+(f' 片段{i//6000+1}' if i else ''),body[i:i+6000],origin,i//6000+1,imgs if i==0 else [])

def parse_pdf(path,origin):
    try: from pypdf import PdfReader
    except ImportError:
        warnings.append('PDF文本提取需安装pypdf；原件保留')
        add_card(Path(origin).stem,'PDF解析器未配置，待处理',origin,requires='pdf_parser')
        return
    reader=PdfReader(path,strict=False)
    if reader.is_encrypted: raise ValueError('PDF已加密，请先提供已解密版本')
    for i,page in enumerate(reader.pages[:MAX_PAGES],1):
        try: body=(page.extract_text() or '')[:12000]
        except Exception: body=''; warnings.append(f'{origin}第{i}页文本提取失败')
        imgs=[]
        # Prefer bounded embedded-image extraction; scanned text remains an OCR task.
        try:
            for item in itertools.islice(page.images,1):
                raw=item.data
                if len(raw)<=MAX_MEDIA:
                    import io
                    meta=asset(io.BytesIO(raw),origin+f'/page-{i}-'+item.name,len(raw))
                    if meta: imgs.append(meta)
        except Exception: pass
        add_card(body.splitlines()[0] if body.strip() else f'{Path(origin).stem} 第{i}页',body,origin,i,imgs,
                 requires='ocr' if not body.strip() else None)
        if i%10==0: progress(f'已拆解{i}页PDF')
    if len(reader.pages)>MAX_PAGES: warnings.append(f'PDF共{len(reader.pages)}页，首批处理{MAX_PAGES}页')

def parse(path,origin=None,depth=0):
    global expanded
    origin=origin or path.name; ext=path.suffix.lower()
    if len(cards)>=MAX_CARDS: return
    if ext=='.pptx': return parse_pptx(path,origin)
    if ext=='.docx': return parse_docx(path,origin)
    if ext=='.pdf': return parse_pdf(path,origin)
    if ext=='.ppt':
        add_card(Path(origin).stem,'旧版PPT二进制格式需要Office转换器，请转为PPTX后继续',origin,requires='office_converter')
        warnings.append('旧版.ppt未冒充已解析：需要转换为.pptx')
        return
    if ext=='.zip':
        if depth>=2: raise ValueError('嵌套压缩包过深，请分批上传')
        with zipfile.ZipFile(path) as z:
            for entry in zip_guard(z):
                if entry.is_dir(): continue
                suffix=Path(entry.filename).suffix.lower()
                if suffix not in ALLOWED: continue
                expanded+=entry.file_size
                if expanded>MAX_EXPANDED: raise ValueError('累计展开量超过安全上限')
                dest=OUTPUT/'unpacked'/(hashlib.sha256((origin+'/'+entry.filename).encode()).hexdigest()[:22]+suffix)
                dest.parent.mkdir(exist_ok=True)
                with z.open(entry) as src,dest.open('wb') as out: shutil.copyfileobj(src,out,1024*1024)
                try: parse(dest,origin+'/'+entry.filename,depth+1)
                except Exception as error: warnings.append(f'{entry.filename}：{type(error).__name__} {str(error)[:160]}')
                if len(cards)>=MAX_CARDS: break
        return
    if ext in IMAGE:
        with path.open('rb') as src: meta=asset(src,origin,path.stat().st_size)
        add_card(Path(origin).stem,'待OCR或多模态理解',origin,images=[meta] if meta else [],requires='vision_or_ocr')
        return
    if ext in MEDIA:
        add_card(Path(origin).stem,'音视频已保留，需配置ASR或视频理解渠道',origin,requires='asr' if ext in {'.mp3','.wav','.m4a','.aac','.ogg'} else 'video_understanding',mediaType=ext[1:])
        return
    if ext in {'.txt','.md','.csv','.json'}:
        with path.open('rb') as src: raw=src.read(MAX_TEXT*4)
        try: body=raw.decode('utf-8-sig')
        except UnicodeDecodeError: body=raw.decode('gb18030',errors='replace')
        for i in range(0,max(len(body),1),6000): add_card(Path(origin).stem,body[i:i+6000],origin,i//6000+1)
        return
    raise ValueError('该格式尚未支持')

try:
    progress('正在拆解原始资料')
    parse(SOURCE,sys.argv[3] if len(sys.argv)>3 else SOURCE.name)
    result={'cards':cards,'warnings':warnings,'stats':{'cards':len(cards),'images':len(seen_assets),'expandedBytes':expanded},
            'recognition':'local_structure_extraction','semanticAI':'not_run',
            'limits':{'maxPagesPerDocument':MAX_PAGES,'maxCards':MAX_CARDS}}
    (OUTPUT/'result.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'complete':True,'cards':len(cards),'warnings':len(warnings)},ensure_ascii=False),flush=True)
except Exception as error:
    (OUTPUT/'error.json').write_text(json.dumps({'error':type(error).__name__,'message':str(error)[:500]},ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'failed':True,'message':str(error)[:500]},ensure_ascii=False),flush=True)
    sys.exit(1)
