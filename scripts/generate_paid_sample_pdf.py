import json
from pathlib import Path
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'samples' / 'kyoudo-housing-paid-diagnosis.json'
OUTPUT = ROOT / 'output' / 'pdf' / 'madoha-kyoudo-paid-diagnosis-v1.pdf'
CHANNELS = {'chatgpt': 'ChatGPT', 'gemini': 'Gemini', 'google_ai_mode': 'Google AI Mode'}
CHANNEL_CODES = {'chatgpt': '01', 'gemini': '02', 'google_ai_mode': '03'}
SITE_NAMES = {'kyoudo.jp':'協同住宅 公式サイト','shinurayasu.chiba.jp':'新浦安ナビ','hot2.jp':'HOT2 浦安駅おすすめ8選','e-fudou.com':'不動産ドットコム','property-bank.co.jp':'プロパティバンク','urayasu-senmon.com':'浦安専門ドットコム'}

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
INK=colors.HexColor('#121d24'); MUTED=colors.HexColor('#647078'); LINE=colors.HexColor('#d8dfe1')
ACCENT=colors.HexColor('#2b9b84'); ACCENT_DARK=colors.HexColor('#14705f'); PALE=colors.HexColor('#f3f6f6'); WHITE=colors.white
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyJP',fontName='HeiseiKakuGo-W5',fontSize=10.5,leading=16.5,textColor=INK,spaceAfter=5))
styles.add(ParagraphStyle(name='AnswerJP',parent=styles['BodyJP'],fontSize=11.5,leading=18.5,spaceAfter=6))
styles.add(ParagraphStyle(name='MetaJP',parent=styles['BodyJP'],fontSize=8.2,leading=11.5,textColor=MUTED))
styles.add(ParagraphStyle(name='MicroJP',parent=styles['MetaJP'],fontSize=7.2,leading=9.5,spaceAfter=2))
styles.add(ParagraphStyle(name='CoverMetaJP',parent=styles['MetaJP'],textColor=colors.HexColor('#b9c9cc'),fontSize=8.5,leading=13))
styles.add(ParagraphStyle(name='CoverTitleJP',fontName='HeiseiKakuGo-W5',fontSize=28,leading=37,textColor=WHITE,spaceAfter=6))
styles.add(ParagraphStyle(name='CoverSubJP',fontName='HeiseiKakuGo-W5',fontSize=13,leading=20,textColor=WHITE,spaceAfter=3))
styles.add(ParagraphStyle(name='QuestionJP',fontName='HeiseiKakuGo-W5',fontSize=19.5,leading=28,textColor=INK,spaceAfter=8))
styles.add(ParagraphStyle(name='AIJP',fontName='HeiseiKakuGo-W5',fontSize=13,leading=18,textColor=INK,spaceAfter=3))
styles.add(ParagraphStyle(name='LabelJP',fontName='HeiseiKakuGo-W5',fontSize=7.8,leading=10,textColor=MUTED,spaceAfter=3))
styles.add(ParagraphStyle(name='TargetNameJP',parent=styles['BodyJP'],textColor=ACCENT_DARK,fontSize=10.8,leading=15.5))
styles.add(ParagraphStyle(name='SectionJP',fontName='HeiseiKakuGo-W5',fontSize=22,leading=30,textColor=INK,spaceAfter=12))
styles.add(ParagraphStyle(name='SectionWhiteJP',fontName='HeiseiKakuGo-W5',fontSize=25,leading=34,textColor=WHITE,spaceAfter=10))
styles.add(ParagraphStyle(name='IntroBodyJP',fontName='HeiseiKakuGo-W5',fontSize=9.4,leading=14.5,textColor=colors.HexColor('#e4ecee'),spaceAfter=4))
styles.add(ParagraphStyle(name='IntroLabelJP',fontName='HeiseiKakuGo-W5',fontSize=7.8,leading=10.5,textColor=colors.HexColor('#8fd5c5'),spaceAfter=5))
styles.add(ParagraphStyle(name='IntroItemJP',fontName='HeiseiKakuGo-W5',fontSize=9.1,leading=13.5,textColor=WHITE,spaceAfter=1))
styles.add(ParagraphStyle(name='IntroReasonJP',fontName='HeiseiKakuGo-W5',fontSize=7.5,leading=11,textColor=colors.HexColor('#b9c9cc')))
styles.add(ParagraphStyle(name='NoticeJP',parent=styles['BodyJP'],fontSize=9,leading=14,backColor=colors.HexColor('#f8f3e8'),borderColor=colors.HexColor('#d7c59d'),borderWidth=.5,borderPadding=8))

def esc(text): return str(text).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def p(text,style='BodyJP'): return Paragraph(esc(text),styles[style])
def host(url): return urlparse(url).hostname.replace('www.','') if urlparse(url).hostname else url
def source_name(url): return SITE_NAMES.get(host(url),host(url))
def source_role(data,url): return next((item['role'] for item in data['sources'] if host(item['url'])==host(url)),'AI回答が参照したWeb情報')
def rich_answer(text,subject):
    markup=esc(text).replace(esc(subject),f'<font color="#14705f"><b>{esc(subject)}</b></font>')
    return Paragraph(markup,styles['AnswerJP'])
def company_list(subject,row):
    companies=list(row.get('competitors') or [])
    if not row.get('appeared'): return companies
    pos=row.get('listedPosition') or 1
    companies.insert(max(0,min(pos-1,len(companies))),subject)
    return companies
def position(subject,row):
    companies=company_list(subject,row)
    return companies.index(subject)+1 if subject in companies else None
def ai_rank(row): return f"{row['aiRank']}位" if isinstance(row.get('aiRank'),int) else 'なし'

def footer(canvas,doc):
    canvas.saveState(); canvas.setStrokeColor(LINE); canvas.setLineWidth(.35)
    canvas.line(16*mm,13.5*mm,194*mm,13.5*mm); canvas.setFont('HeiseiKakuGo-W5',7.2); canvas.setFillColor(MUTED)
    canvas.drawString(16*mm,8.5*mm,'MADOHA / AI SEARCH REPORT')
    canvas.drawCentredString(105*mm,8.5*mm,'株式会社協同住宅')
    canvas.drawRightString(194*mm,8.5*mm,f'PAGE {doc.page:02d}')
    canvas.restoreState()

def status_bar(subject,row):
    companies=company_list(subject,row); pos=position(subject,row)
    items=[('掲載','あり' if row.get('appeared') else 'なし'),('掲載位置',f'{len(companies)}社中{pos}番目' if pos else '対象企業なし'),('推薦','あり' if row.get('recommended') else 'なし'),('AIの順位付け',ai_rank(row))]
    cells=[]
    for label,value in items:
        color=ACCENT_DARK if label=='掲載' and value=='あり' else INK
        value_style=ParagraphStyle('status',parent=styles['MetaJP'],fontSize=9.2,leading=12,textColor=color)
        cells.append([p(label,'MicroJP'),Paragraph(esc(value),value_style)])
    table=Table([cells],colWidths=[41*mm]*4)
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.4,LINE),('INNERGRID',(0,0),(-1,-1),.35,LINE),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    return table

def result_block(data,query,row):
    subject=data['subject']['name']; branded=query['kind']=='branded'; parts=[]
    channel=Table([[p(CHANNEL_CODES[row['channel']],'MicroJP'),p(CHANNELS[row['channel']],'AIJP')]],colWidths=[10*mm,154*mm])
    channel.setStyle(TableStyle([('TEXTCOLOR',(0,0),(0,0),ACCENT_DARK),('LINEBELOW',(0,0),(-1,-1),.8,INK),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    parts.append(channel)
    if not branded: parts += [Spacer(1,2*mm),status_bar(subject,row)]
    parts += [Spacer(1,3*mm),p('AI RESPONSE / 実際の回答','LabelJP'),rich_answer(row['answer'],subject),Spacer(1,2*mm)]
    if branded:
        parts += [p('強みとして書かれたこと','LabelJP'),p(' / '.join(row.get('strengths') or []) or '明確な記載なし'),p('確認できなかった情報','LabelJP'),p(' / '.join(row.get('informationGaps') or []) or '特になし')]
    else:
        parts += [p('掲載された企業（表示された順番）','LabelJP')]
        companies=company_list(subject,row)
        if companies:
            for number,name in enumerate(companies,1): parts.append(p(f'{number:02d}   {name}','TargetNameJP' if name==subject else 'BodyJP'))
        else: parts.append(p('企業名の一覧は取得できませんでした。','MetaJP'))
    parts += [Spacer(1,1.5*mm),p('参照された情報','LabelJP')]
    if row.get('sources'):
        for url in row['sources']:
            parts += [p(source_name(url)),p(source_role(data,url),'MicroJP'),p(host(url),'MicroJP')]
    else: parts.append(p('この回答で取得できた参照情報はありません。','MetaJP'))
    if row.get('comment'): parts += [Spacer(1,1.5*mm),p('MADOHA NOTE','LabelJP'),p(row['comment'])]
    parts += [Spacer(1,2*mm)]
    box=Table([[parts]],colWidths=[178*mm])
    box.setStyle(TableStyle([('BOX',(0,0),(-1,-1),.45,LINE),('LEFTPADDING',(0,0),(-1,-1),7*mm),('RIGHTPADDING',(0,0),(-1,-1),7*mm),('TOPPADDING',(0,0),(-1,-1),5*mm),('BOTTOMPADDING',(0,0),(-1,-1),4*mm)]))
    return box

def section_intro(number,english,title,description,queries,metrics):
    learn = [
        '会社名を知らない人がAIに相談したとき、自社が候補に入るか',
        '競合として、どの会社が一緒に表示されるか',
        '自社が何社中何番目に表示されるか',
        'AIがどのWeb情報を参照しているか',
    ] if number == '01' else [
        'AIが自社をどのような会社として説明しているか',
        '強みとして何を認識しているか',
        '評判や信頼性をどのように扱っているか',
        '情報不足や誤解がないか',
        'どの情報源をもとに説明しているか',
    ]
    content=[p(f'{number} / {english}','CoverMetaJP'),Spacer(1,5*mm),p(title,'SectionWhiteJP'),p(description,'IntroBodyJP'),Spacer(1,5*mm)]
    rule=Table([['']],colWidths=[148*mm],rowHeights=[1])
    rule.setStyle(TableStyle([('LINEABOVE',(0,0),(-1,-1),1,ACCENT)]))
    content += [rule,Spacer(1,5*mm),p('この検索で分かること','IntroLabelJP')]
    content += [p(f'・{item}','IntroBodyJP') for item in learn]
    content += [Spacer(1,4*mm),p(f"今回確認する{len(queries)}つの{'場面' if number == '01' else '視点'}",'IntroLabelJP')]
    theme_rows=[]
    for index,query in enumerate(queries,1):
        detail=[p(query['intent'],'IntroItemJP')]
        if number == '02': detail.append(p(f"「{query['query']}」",'IntroReasonJP'))
        detail.append(p(query['selection_reason'],'IntroReasonJP'))
        theme_rows.append([p(f'{index:02d}','IntroLabelJP'),detail])
    themes=Table(theme_rows,colWidths=[12*mm,136*mm])
    themes.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-2),.3,colors.HexColor('#405159')),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    content += [themes,Spacer(1,4*mm),p('質問の選定について','IntroLabelJP'),p('今回の質問は、対象企業のサービス、対応地域、公式サイトの情報、検索需要、関連検索、FAQ、地域・比較ページなどをもとに作成しています。会社名とサービス名を機械的に組み合わせず、実際の利用者がAIへ相談するときの聞き方を基準に選んでいます。','IntroReasonJP'),Spacer(1,4*mm),p(metrics,'CoverMetaJP')]
    panel=Table([[content]],colWidths=[178*mm],rowHeights=[247*mm])
    panel.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),INK),('LEFTPADDING',(0,0),(-1,-1),15*mm),('RIGHTPADDING',(0,0),(-1,-1),15*mm),('TOPPADDING',(0,0),(-1,-1),13*mm),('BOTTOMPADDING',(0,0),(-1,-1),10*mm),('VALIGN',(0,0),(-1,-1),'TOP')]))
    return [panel,PageBreak()]

def build():
    data=json.loads(DATA.read_text(encoding='utf-8')); OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    doc=BaseDocTemplate(str(OUTPUT),pagesize=A4,leftMargin=16*mm,rightMargin=16*mm,topMargin=16*mm,bottomMargin=18*mm,title='MADOHA Paid Diagnosis v1 - 株式会社協同住宅')
    doc.addPageTemplates(PageTemplate(id='report',frames=[Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='main')],onPage=footer))
    story=[]
    metrics=Table([[p('10','CoverTitleJP'),p('3','CoverTitleJP'),p('30','CoverTitleJP')],[p('QUESTIONS','CoverMetaJP'),p('AI CHANNELS','CoverMetaJP'),p('RESULTS','CoverMetaJP')]],colWidths=[48*mm]*3)
    metrics.setStyle(TableStyle([('LINEABOVE',(0,0),(-1,0),1,ACCENT),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    cover=Table([[p('MADOHA PAID DIAGNOSIS','CoverMetaJP')],[p('AI検索調査レポート','CoverTitleJP')],[p(data['subject']['name'],'CoverTitleJP')],[p('AIで自社を検索すると、実際にどのように表示されるかを確認するレポート','CoverSubJP')],[metrics],[p(f"MEASURED {data['measurement']['snapshotDate']} / SAMPLE FIXTURE",'CoverMetaJP')]],colWidths=[178*mm],rowHeights=[18*mm,28*mm,36*mm,31*mm,37*mm,18*mm])
    cover.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),INK),('LEFTPADDING',(0,0),(-1,-1),16*mm),('RIGHTPADDING',(0,0),(-1,-1),16*mm),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
    story += [Spacer(1,12*mm),cover,Spacer(1,9*mm),p('このレポートで確認できること','AIJP'),p('実際に検索した質問、自社の掲載有無、掲載順、推薦の有無、AIの説明、同時に掲載された企業、参照されたWeb情報を検索結果ごとに整理しています。'),p('商品確認用サンプルです。30件の結果は画面・PDF確認用の仮データで、株式会社協同住宅の実測値ではありません。','NoticeJP'),PageBreak()]
    nonbrand_queries=[query for query in data['queries'] if query['kind']=='nonbrand']
    branded_queries=[query for query in data['queries'] if query['kind']=='branded']
    story += section_intro('01','DISCOVERY','AIに候補として選ばれるか','あなたの会社をまだ知らない人がAIに相談したとき、候補として表示されるかを確認します。',nonbrand_queries,'6 QUESTIONS / 18 RESULTS')

    for index,query in enumerate(data['queries'],1):
        if index==7:
            story += [PageBreak()] + section_intro('02','BRAND UNDERSTANDING','AIに自社がどう理解されているか','会社名を直接AIに聞いたとき、自社がどのように説明され、判断材料として何が示されるかを確認します。',branded_queries,'4 QUESTIONS / 12 RESULTS')
        customer_kind='会社名を入れない検索' if query['kind']=='nonbrand' else '会社名を入れた検索'
        heading=[p(f'QUESTION {index:02d} / 10   {customer_kind.upper()}','MetaJP'),p(query['query'],'QuestionJP'),p('同じ質問をChatGPT、Gemini、Google AI Modeで各1回検索しました。','MetaJP'),Spacer(1,3*mm)]
        blocks=[result_block(data,query,row) for row in query['channels']]
        story.append(KeepTogether(heading+[blocks[0]])); story.extend(blocks[1:]); story.append(Spacer(1,9*mm))

    story += [Spacer(1,8*mm),p('REFERENCE / 参照情報','SectionJP'),p('検索結果で使用した主なWeb情報です。サイト名、役割、短いドメインの順に記載します。')]
    for source in data['sources']:
        story.append(KeepTogether([p(source['name'],'AIJP'),p(source['role'],'MetaJP'),p(host(source['url']),'MicroJP'),Spacer(1,2*mm)]))
    story += [Spacer(1,8*mm),p('OPTIONS / 改善する場合の選択肢','SectionJP'),p('以下は今回の検索結果と参照情報から考えられる候補です。断定的な優先順位ではありません。')]
    for number,action in enumerate(data['actions'][:3],1): story.append(KeepTogether([p(f'{number:02d}  {action["target"]}','AIJP'),p(action['change']),Spacer(1,3*mm)]))
    story += [Spacer(1,8*mm),p('CONDITIONS / 測定条件・注意書き','SectionJP'),p('会社名を入れない6問と会社名を入れた4問の計10問を、ChatGPT、Gemini、Google AI Modeで各1回検索しました。合計30件の検索結果です。'),p(data['queryDiscovery']['method']),Spacer(1,4*mm),p('本診断は測定時点におけるAI検索の回答を観測したものです。AIの回答は変動するため、同じ質問でも結果が異なる場合があります。また、改善施策による特定の表示・推薦結果を保証するものではありません。','NoticeJP')]
    doc.build(story); return OUTPUT

if __name__=='__main__': print(build())
