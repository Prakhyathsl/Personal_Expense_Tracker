import os
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
AUTH_SQLITE = DATA_DIR / 'auth.db'
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()


def using_postgres():
    return bool(os.environ.get('DATABASE_URL', '').strip())


def ph():
    return '%s' if using_postgres() else '?'


def database_url():
    raw = os.environ.get('DATABASE_URL', '').strip()
    if not raw:
        return ''
    if raw.startswith('postgres://'):
        raw = 'postgresql://' + raw[len('postgres://'):]
    # Supabase/managed PostgreSQL connections should use TLS. Respect an
    # explicit sslmode if the provider already included one.
    parsed = urlparse(raw)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params.setdefault('sslmode', 'require')
    return urlunparse(parsed._replace(query=urlencode(params)))


@contextmanager
def connection(sqlite_path=None):
    if using_postgres():
        import psycopg2
        conn = psycopg2.connect(database_url(), connect_timeout=15)
    else:
        path = Path(sqlite_path or AUTH_SQLITE)
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), timeout=30)
        conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(cur, row):
    if row is None:
        return None
    if using_postgres():
        return dict(zip([d[0] for d in cur.description], row))
    return dict(row)
