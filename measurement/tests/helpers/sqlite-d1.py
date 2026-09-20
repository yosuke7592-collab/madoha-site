"""Local in-memory SQLite adapter for SQL-level Worker tests; no network."""
import base64
import json
import sqlite3
import sys

db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
for line in sys.stdin:
    request = json.loads(base64.b64decode(line).decode('utf-8'))
    try:
        if 'schema' in request:
            db.executescript(request['schema'])
            output = None
        else:
            output = []
            with db:
                for statement in request['statements']:
                    cursor = db.execute(statement['sql'], statement.get('args', []))
                    rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
                    output.append({'results': rows, 'meta': {'changes': max(cursor.rowcount, 0)}})
        response = json.dumps({'id': request['id'], 'value': output}, ensure_ascii=False)
        print(base64.b64encode(response.encode('utf-8')).decode('ascii'), flush=True)
    except Exception as error:
        db.rollback()
        response = json.dumps({'id': request['id'], 'error': str(error)}, ensure_ascii=False)
        print(base64.b64encode(response.encode('utf-8')).decode('ascii'), flush=True)
