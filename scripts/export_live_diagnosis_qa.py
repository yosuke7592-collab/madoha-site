import json
import sqlite3
import sys
from pathlib import Path


DIAGNOSIS_ID = "76666666-7777-4777-8777-777777777777"


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    sql_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "tmp" / "kyoudo-live-staging-export.sql"
    output_dir = root / "output" / "live-diagnosis"
    output_dir.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(":memory:")
    db.executescript(sql_path.read_text(encoding="utf-8"))
    order = db.execute(
        "SELECT diagnosis_status,pipeline_state,completed_measurements,total_measurements,report_json FROM diagnosis_orders WHERE id=?",
        (DIAGNOSIS_ID,),
    ).fetchone()
    if not order or order[0] != "complete" or order[1] != "completed" or order[2] != 30:
        raise RuntimeError(f"Diagnosis is not complete: {order[:4] if order else None}")

    report_path = output_dir / "madoha-kyoudo-full-live-report.json"
    report = json.loads(order[4])
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    rows = db.execute(
        """
        SELECT q.question_order,q.question_text,p.channel,p.status,p.estimated_cost_usd,p.measurement_json
        FROM paid_measurements p
        JOIN diagnosis_questions q ON q.diagnosis_id=p.diagnosis_id AND q.question_id=p.question_id
        WHERE p.diagnosis_id=? ORDER BY q.question_order,p.channel_order
        """,
        (DIAGNOSIS_ID,),
    ).fetchall()
    if len(rows) != 30:
        raise RuntimeError(f"Expected 30 measurements, got {len(rows)}")

    qa = []
    markdown = ["# MADOHA 協同住宅 フル実診断 QA", "", f"診断ID: `{DIAGNOSIS_ID}`", ""]
    for order_no, question, channel, status, cost, payload_json in rows:
        item = json.loads(payload_json)
        entities = item.get("mentioned_entities") or []
        names = [entity.get("name", "") for entity in entities]
        issues = []
        if status != "complete" or item.get("error"):
            issues.append("測定が正常完了していない")
        if bool(item.get("target_present")) != any(entity.get("target") for entity in entities):
            issues.append("target presenceと企業抽出が不一致")
        if item.get("target_present") and item.get("target_position") is None:
            issues.append("掲載ありだが掲載位置がない")
        if not item.get("target_present") and item.get("target_position") is not None:
            issues.append("掲載なしだが掲載位置がある")
        for name in names:
            if name.lstrip().startswith("#"):
                issues.append(f"見出しを企業名として誤抽出: {name}")
            if len(name) > 50:
                issues.append(f"企業名候補が長すぎる: {name[:50]}")
        normalized = [name.replace("株式会社", "").replace("（株）", "").strip() for name in names]
        if len(normalized) != len(set(normalized)):
            issues.append("同一回答内に企業名の表記揺れ重複")
        if not (item.get("raw_answer") or "").strip():
            issues.append("回答本文が空")
        qa_status = "修正必要" if any("誤抽出" in issue or "不一致" in issue or "空" in issue for issue in issues) else ("要確認" if issues else "OK")
        entry = {
            "question_order": order_no,
            "question": question,
            "channel": channel,
            "target_presence": bool(item.get("target_present")),
            "appearance_position": item.get("target_position"),
            "recommendation": bool(item.get("recommendation")),
            "explicit_rank": item.get("explicit_rank"),
            "mentioned_companies": names,
            "citation_count": len(item.get("citations") or []),
            "source_count": len(item.get("sources") or []),
            "cost_usd": cost,
            "qa": qa_status,
            "issues": issues,
            "raw_answer": item.get("raw_answer", ""),
        }
        qa.append(entry)
        markdown.extend([
            f"## Q{order_no:02d} / {channel}", "",
            question, "",
            f"- 掲載: {'あり' if entry['target_presence'] else 'なし'}",
            f"- 掲載位置: {entry['appearance_position'] if entry['appearance_position'] is not None else 'なし'}",
            f"- 推薦: {'あり' if entry['recommendation'] else 'なし'}",
            f"- 明示順位: {entry['explicit_rank'] if entry['explicit_rank'] is not None else 'なし'}",
            f"- 企業: {', '.join(names) if names else '抽出なし'}",
            f"- citations: {entry['citation_count']}",
            f"- QA: {qa_status}",
        ])
        if issues:
            markdown.extend([f"- 理由: {' / '.join(issues)}"])
        markdown.extend(["", "### Raw answer", "", item.get("raw_answer", ""), ""])

    qa_path = output_dir / "madoha-kyoudo-full-live-qa.json"
    qa_path.write_text(json.dumps(qa, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path = output_dir / "madoha-kyoudo-full-live-qa.md"
    markdown_path.write_text("\n".join(markdown), encoding="utf-8")
    print(json.dumps({"report": str(report_path), "qa_json": str(qa_path), "qa_markdown": str(markdown_path), "measurements": len(qa)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
