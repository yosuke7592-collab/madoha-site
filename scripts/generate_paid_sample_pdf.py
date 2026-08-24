import json
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
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

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiMin-W3'))

INK = colors.HexColor('#17201e')
ACID = colors.HexColor('#d9ff57')
MUTED = colors.HexColor('#59645f')
LINE = colors.HexColor('#d6ddd7')
PALE = colors.HexColor('#eef1ed')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='JP', fontName='HeiseiKakuGo-W5', fontSize=10.5, leading=17, textColor=INK, spaceAfter=6))
styles.add(ParagraphStyle(name='MetaJP', parent=styles['JP'], fontSize=8, leading=12, textColor=MUTED))
styles.add(ParagraphStyle(name='CoverMetaJP', parent=styles['MetaJP'], textColor=colors.HexColor('#c2ccc8')))
styles.add(ParagraphStyle(name='TitleJP', fontName='HeiseiKakuGo-W5', fontSize=26, leading=34, textColor=colors.white, spaceAfter=8))
styles.add(ParagraphStyle(name='SectionJP', fontName='HeiseiKakuGo-W5', fontSize=18, leading=24, textColor=INK, spaceBefore=8, spaceAfter=12))
styles.add(ParagraphStyle(name='H3JP', fontName='HeiseiKakuGo-W5', fontSize=13, leading=19, textColor=INK, spaceBefore=7, spaceAfter=5))
styles.add(ParagraphStyle(name='CellJP', fontName='HeiseiKakuGo-W5', fontSize=7.3, leading=10.5, textColor=INK))
styles.add(ParagraphStyle(name='CellHeadJP', parent=styles['CellJP'], textColor=colors.white, alignment=TA_CENTER))
styles.add(ParagraphStyle(name='NoticeJP', parent=styles['JP'], fontSize=9, leading=14, backColor=colors.HexColor('#fff4dc'), borderColor=colors.HexColor('#e7ca91'), borderWidth=.5, borderPadding=8))

def p(text, style='JP'):
    return Paragraph(str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'), styles[style])

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('HeiseiKakuGo-W5', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(16*mm, 10*mm, 'MADOHA Paid Diagnosis v1')
    canvas.drawRightString(194*mm, 10*mm, f'{doc.page}')
    canvas.restoreState()

def section(number, title):
    return [p(f'SECTION {number}', 'MetaJP'), p(title, 'SectionJP')]

def table(rows, widths, header=True):
    result = Table(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    commands = [('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.35,LINE),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]
    if header: commands += [('BACKGROUND',(0,0),(-1,0),INK),('TEXTCOLOR',(0,0),(-1,0),colors.white)]
    result.setStyle(TableStyle(commands))
    return result

def build():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=16*mm, rightMargin=16*mm, topMargin=16*mm, bottomMargin=17*mm, title='MADOHA Paid Diagnosis v1 - 株式会社協同住宅')
    doc.addPageTemplates(PageTemplate(id='report', frames=[Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='main')], onPage=header_footer))
    story=[]
    cover=Table([[p('MADOHA PAID DIAGNOSIS v1','CoverMetaJP')],[p(data['subject']['name'],'TitleJP')],[p(f"{data['subject']['area']} / {data['subject']['category']}",'CoverMetaJP')],[p(f"基準日 {data['measurement']['snapshotDate']} / 対象確認済み",'CoverMetaJP')]], colWidths=[178*mm])
    cover.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),INK),('BOX',(0,0),(-1,-1),0,INK),('LEFTPADDING',(0,0),(-1,-1),16*mm),('RIGHTPADDING',(0,0),(-1,-1),16*mm),('TOPPADDING',(0,0),(-1,-1),8*mm),('BOTTOMPADDING',(0,0),(-1,-1),8*mm)]))
    story += [cover,Spacer(1,10*mm)]

    story += section(1,'診断サマリー')
    story += [p(data['executiveSummary']['headline'],'H3JP')]
    summary_rows=[[p('総合評価','CellJP'),p(data['executiveSummary']['overallRating'],'CellJP'),p('改善余地','CellJP'),p(data['executiveSummary']['improvementPotential'],'CellJP')],
                  [p('最大の機会損失','CellJP'),p(data['executiveSummary']['opportunityLoss'],'CellJP'),p('競合との差','CellJP'),p(data['executiveSummary']['competitorGap'],'CellJP')]]
    story += [table(summary_rows,[28*mm,61*mm,28*mm,61*mm],header=False),Spacer(1,5*mm),p('改善する場合、最初に検討する3件','H3JP')]
    for action in data['actions'][:3]: story.append(p(f"{action['priority']}. {action['target']}（{action['horizon']}以内）"))
    story += [p('商品確認用サンプルです。30測定の結果は仮データであり、株式会社協同住宅の実測値ではありません。','NoticeJP'),PageBreak()]

    story += section(2,'AI検索での見え方 - 非指名6問')
    story.append(p('会社名を含めない質問で、初めて知る利用者の候補になるかを3つのAIで横比較しました。'))
    rows=[[p('質問','CellHeadJP')]+[p(name,'CellHeadJP') for name in CHANNELS.values()]]
    for query in [q for q in data['queries'] if q['kind']=='nonbrand']:
        cells=[p(f"{query['intent']} / {query['query']}",'CellJP')]
        for result in query['channels']:
            state='推薦あり' if result['recommended'] else '出現あり' if result['appeared'] else '出現なし'
            rank=f" / 回答内{result['rank']}番目" if isinstance(result.get('rank'),int) else ''
            cells.append(p(f"{state}{rank} / {result['reason']}",'CellJP'))
        rows.append(cells)
    story += [table(rows,[50*mm,42.5*mm,42.5*mm,42.5*mm]),PageBreak()]

    story += section(3,'会社名で調べたときの見え方 - 指名4問')
    story.append(p('指名質問では出現率ではなく、説明の正確さ、強み、情報不足、注意点を確認しました。'))
    rows=[[p('質問','CellHeadJP')]+[p(name,'CellHeadJP') for name in CHANNELS.values()]]
    for query in [q for q in data['queries'] if q['kind']=='branded']:
        cells=[p(f"{query['intent']} / {query['query']}",'CellJP')]
        for result in query['channels']:
            cells.append(p(f"{result['accuracy']} / {result['answer']} / 不足: {'、'.join(result['informationGaps'])}",'CellJP'))
        rows.append(cells)
    story += [table(rows,[50*mm,42.5*mm,42.5*mm,42.5*mm]),PageBreak()]

    story += section(4,'情報源・競合')
    rows=[[p('情報源','CellHeadJP'),p('役割','CellHeadJP'),p('対応','CellHeadJP')]]
    for source in data['sources']: rows.append([p(source['name'],'CellJP'),p(source['role'],'CellJP'),p(source['priority'],'CellJP')])
    story += [table(rows,[55*mm,83*mm,40*mm]),Spacer(1,5*mm),p('競合との差','H3JP')]
    for competitor in data['competitors']:
        story += [p(competitor['name'],'H3JP'),p(f"FACT: {competitor['observedStrength']}"),p(f"仮説: {competitor['whyStronger']}")]
    story.append(PageBreak())

    story += section(5,'気になった点・改善の選択肢')
    for issue in data['issues']:
        story.append(KeepTogether([p(issue['observed'],'H3JP'),p(f"FACT: {issue['fact']}"),p(f"意味の仮説: {issue['impact']}"),p(f"改善する場合の選択肢: {issue['action']}"),Spacer(1,3*mm)]))
    story.append(p('選択肢の全体像','H3JP'))
    for action in data['actions']: story.append(KeepTogether([p(f"{action['priority']}. {action['target']} / {action['horizon']}",'H3JP'),p(action['change']),p(f"次回確認: {action['verification']}")]))
    story.append(PageBreak())

    story += section(6,'測定詳細・根拠')
    story += [p('Query Discovery','H3JP'),p(data['queryDiscovery']['method']),p('質問品質の確認: '+ ' / '.join(data['queryDiscovery']['qaPolicy'])),p('10質問・30回答','H3JP')]
    for query in data['queries']:
        block=[p(query['query'],'H3JP'),p(('非指名' if query['kind']=='nonbrand' else '指名')+f" / {query['intent']}",'MetaJP')]
        for result in query['channels']: block += [p(f"{CHANNELS[result['channel']]}: {result['answer']}",'JP'),p('根拠URL: '+' / '.join(result.get('sources',[])),'MetaJP')]
        story.append(KeepTogether(block))
    story += [p('測定条件','H3JP'),p(data['baseline']['remeasurement']),p('本診断は測定時点におけるAI検索の回答を観測したものです。AIの回答は変動するため、同じ質問でも結果が異なる場合があります。また、改善施策による特定の表示・推薦結果を保証するものではありません。','NoticeJP')]
    doc.build(story)
    return OUTPUT

if __name__ == '__main__': print(build())
