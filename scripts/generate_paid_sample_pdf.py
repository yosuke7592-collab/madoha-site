import json
from pathlib import Path
from urllib.parse import urlparse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'samples' / 'kyoudo-housing-paid-diagnosis.json'
OUTPUT = ROOT / 'output' / 'pdf' / 'madoha-kyoudo-paid-diagnosis-v1.pdf'
CHANNELS = {'chatgpt': 'ChatGPT', 'gemini': 'Gemini', 'google_ai_mode': 'Google AI Mode'}
SITE_NAMES = {'kyoudo.jp':'協同住宅 公式サイト','shinurayasu.chiba.jp':'新浦安ナビ','hot2.jp':'HOT2 浦安駅おすすめ8選','e-fudou.com':'不動産ドットコム','property-bank.co.jp':'プロパティバンク','urayasu-senmon.com':'浦安専門ドットコム'}

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
INK=colors.HexColor('#17201e'); MUTED=colors.HexColor('#5d6863'); LINE=colors.HexColor('#d5dcd7'); ACCENT=colors.HexColor('#d9ff57'); TARGET=colors.HexColor('#f4ffd3'); PALE=colors.HexColor('#edf1ed')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyJP',fontName='HeiseiKakuGo-W5',fontSize=10.5,leading=16,textColor=INK,spaceAfter=5))
styles.add(ParagraphStyle(name='MetaJP',parent=styles['BodyJP'],fontSize=8.2,leading=11,textColor=MUTED))
styles.add(ParagraphStyle(name='CoverMetaJP',parent=styles['MetaJP'],textColor=colors.HexColor('#c5ceca')))
styles.add(ParagraphStyle(name='CoverTitleJP',fontName='HeiseiKakuGo-W5',fontSize=27,leading=35,textColor=colors.white,spaceAfter=8))
styles.add(ParagraphStyle(name='QuestionJP',fontName='HeiseiKakuGo-W5',fontSize=18,leading=26,textColor=INK,spaceAfter=8))
styles.add(ParagraphStyle(name='AIJP',fontName='HeiseiKakuGo-W5',fontSize=13,leading=18,textColor=INK,spaceAfter=4))
styles.add(ParagraphStyle(name='LabelJP',fontName='HeiseiKakuGo-W5',fontSize=8.5,leading=11,textColor=MUTED,spaceAfter=3))
styles.add(ParagraphStyle(name='TargetJP',parent=styles['BodyJP'],backColor=TARGET,borderColor=ACCENT,borderWidth=0,borderPadding=7,leftIndent=2))
styles.add(ParagraphStyle(name='SectionJP',fontName='HeiseiKakuGo-W5',fontSize=20,leading=27,textColor=INK,spaceAfter=12))
styles.add(ParagraphStyle(name='NoticeJP',parent=styles['BodyJP'],fontSize=9,leading=14,backColor=colors.HexColor('#fff4dc'),borderColor=colors.HexColor('#e7ca91'),borderWidth=.5,borderPadding=8))

def esc(text): return str(text).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def p(text,style='BodyJP'): return Paragraph(esc(text),styles[style])
def host(url): return urlparse(url).hostname.replace('www.','') if urlparse(url).hostname else url
def source_name(url): return SITE_NAMES.get(host(url),host(url))
def company_list(subject,row):
    companies=list(row.get('competitors') or [])
    if not row.get('appeared'): return companies
    pos=row.get('listedPosition') or row.get('rank') or 1
    companies.insert(max(0,min(pos-1,len(companies))),subject)
    return companies
def position(subject,row):
    companies=company_list(subject,row)
    return companies.index(subject)+1 if subject in companies else None
def listing(subject,row):
    companies=company_list(subject,row); pos=position(subject,row)
    return f'{len(companies)}社中{pos}番目に掲載' if pos else '掲載なし'
def ai_rank(row): return f"{row['aiRank']}位" if isinstance(row.get('aiRank'),int) else 'なし'

def footer(canvas,doc):
    canvas.saveState(); canvas.setFont('HeiseiKakuGo-W5',7.5); canvas.setFillColor(MUTED)
    canvas.drawString(16*mm,10*mm,'MADOHA Paid Diagnosis v1 / AI検索調査レポート'); canvas.drawRightString(194*mm,10*mm,str(doc.page)); canvas.restoreState()

def result_block(data,query,row):
    subject=data['subject']['name']; branded=query['kind']=='branded'; parts=[]
    if branded:
        status=f"{row['accuracy']} / 情報不足: {'、'.join(row.get('informationGaps') or []) or '確認なし'}"
    else:
        status=f"{'掲載あり' if row.get('appeared') else '掲載なし'} / {listing(subject,row)} / {'推薦あり' if row.get('recommended') else '推薦なし'} / AIによる推薦順位: {ai_rank(row)}"
    answer_style = 'TargetJP' if branded or row.get('appeared') else 'BodyJP'
    parts += [p(CHANNELS[row['channel']],'AIJP'),p(status,'MetaJP'),Spacer(1,1.5*mm),p('実際のAI回答','LabelJP'),p(row['answer'],answer_style)]
    if branded:
        parts += [p('強みとして書かれたこと','LabelJP'),p(' / '.join(row.get('strengths') or []) or '明確な記載なし')]
    else:
        companies=company_list(subject,row)
        ordered=' / '.join(f"{i+1}. {name}{'（診断対象）' if name==subject else ''}" for i,name in enumerate(companies)) or '企業名の一覧は取得できませんでした。'
        parts += [p('掲載された企業','LabelJP'),p(ordered)]
    refs=' / '.join(f"{source_name(url)} ({url})" for url in row.get('sources') or []) or '取得できた参照情報はありません。'
    view=(f"今回の回答では、協同住宅は{listing(subject,row)}でした。" if not branded else f"今回の回答では「{row['accuracy']}」と確認できる説明でした。")
    parts += [p('参照された情報','LabelJP'),p(refs,'MetaJP'),p('MADOHAの見解','LabelJP'),p(view),Spacer(1,3*mm)]
    box=Table([[parts]],colWidths=[178*mm])
    box.setStyle(TableStyle([('BOX',(0,0),(-1,-1),.6,LINE),('LEFTPADDING',(0,0),(-1,-1),7*mm),('RIGHTPADDING',(0,0),(-1,-1),7*mm),('TOPPADDING',(0,0),(-1,-1),5*mm),('BOTTOMPADDING',(0,0),(-1,-1),4*mm)]))
    return box

def build():
    data=json.loads(DATA.read_text(encoding='utf-8')); OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    doc=BaseDocTemplate(str(OUTPUT),pagesize=A4,leftMargin=16*mm,rightMargin=16*mm,topMargin=16*mm,bottomMargin=17*mm,title='MADOHA Paid Diagnosis v1 - 株式会社協同住宅')
    doc.addPageTemplates(PageTemplate(id='report',frames=[Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='main')],onPage=footer))
    story=[]
    cover=Table([[p('MADOHA PAID DIAGNOSIS v1','CoverMetaJP')],[p('AI検索調査レポート','CoverTitleJP')],[p(data['subject']['name'],'CoverTitleJP')],[p(f"10質問 / 3 AI検索チャネル / 30検索結果",'CoverMetaJP')],[p(f"測定日 {data['measurement']['snapshotDate']} / 対象確認済み",'CoverMetaJP')]],colWidths=[178*mm],rowHeights=[18*mm,28*mm,35*mm,22*mm,22*mm])
    cover.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),INK),('LEFTPADDING',(0,0),(-1,-1),16*mm),('RIGHTPADDING',(0,0),(-1,-1),16*mm),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
    story += [Spacer(1,18*mm),cover,Spacer(1,12*mm),p('このレポートで確認できること','AIJP'),p('実際に検索した質問、自社の掲載有無、掲載順、推薦の有無、AIの説明、同時に掲載された企業、参照されたWeb情報を検索結果ごとに整理しています。'),p('商品確認用サンプルです。30件の結果は画面・PDF確認用の仮データで、株式会社協同住宅の実測値ではありません。','NoticeJP'),PageBreak()]

    for index,query in enumerate(data['queries'],1):
        kind='非指名検索' if query['kind']=='nonbrand' else '指名検索'
        story += [p(f'{kind} {index if index<=6 else index-6} / {6 if query["kind"]=="nonbrand" else 4}','MetaJP'),p(query['query'],'QuestionJP'),p('同じ質問をChatGPT、Gemini、Google AI Modeで各1回検索しました。','MetaJP'),Spacer(1,3*mm)]
        for row in query['channels']: story.append(result_block(data,query,row))
        story.append(PageBreak())

    story += [p('参照情報','SectionJP'),p('検索結果で使用した主なWeb情報です。URLだけでなく、サイト名と役割を併記しています。')]
    rows=[[p('サイト名','LabelJP'),p('検索結果での役割','LabelJP'),p('URL','LabelJP')]]
    for source in data['sources']: rows.append([p(source['name']),p(source['role']),p(source['url'],'MetaJP')])
    table=Table(rows,colWidths=[48*mm,70*mm,60*mm],repeatRows=1)
    table.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.4,LINE),('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story += [table,PageBreak(),p('改善する場合の選択肢','SectionJP'),p('以下は今回の検索結果と参照情報から考えられる候補です。断定的な優先順位ではありません。')]
    for action in data['actions'][:5]: story.append(KeepTogether([p(action['target'],'AIJP'),p(action['change']),Spacer(1,3*mm)]))
    story += [PageBreak(),p('測定条件・注意書き','SectionJP'),p('非指名6問と指名4問の計10問を、ChatGPT、Gemini、Google AI Modeで各1回検索しました。合計30件の検索結果です。'),p(data['queryDiscovery']['method']),Spacer(1,5*mm),p('本診断は測定時点におけるAI検索の回答を観測したものです。AIの回答は変動するため、同じ質問でも結果が異なる場合があります。また、改善施策による特定の表示・推薦結果を保証するものではありません。','NoticeJP')]
    doc.build(story); return OUTPUT

if __name__=='__main__': print(build())
