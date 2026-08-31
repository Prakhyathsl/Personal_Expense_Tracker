import os, re, secrets, hashlib, smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from werkzeug.security import generate_password_hash, check_password_hash
from db import connection, ph, using_postgres, row_to_dict, AUTH_SQLITE

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
USERNAME_RE = re.compile(r'^[A-Za-z0-9_]{3,30}$')


def init_auth_db():
    with connection() as conn:
        cur = conn.cursor()
        if using_postgres():
            cur.execute('''CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reset_token_hash TEXT,
                reset_expires_at TIMESTAMP
            )''')
        else:
            cur.execute('''CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT NOT NULL,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reset_token_hash TEXT,
                reset_expires_at TIMESTAMP
            )''')
        cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_ci ON users (LOWER(username))')
        cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users (LOWER(email))')


def _public(row):
    if not row:
        return None
    return {
        'id': int(row['id']),
        'name': row['name'],
        'username': row['username'],
        'email': row['email'],
        'is_admin': bool(row['is_admin']),
        'created_at': str(row['created_at']) if row.get('created_at') is not None else None,
    }


def register_user(name, username, email, password):
    name = str(name or '').strip()
    username = str(username or '').strip()
    email = str(email or '').strip().lower()
    password = str(password or '')
    if len(name) < 2:
        return False, 'Full name must be at least 2 characters.'
    if not USERNAME_RE.fullmatch(username):
        return False, 'Username must be 3–30 characters and use only letters, numbers, and underscore.'
    if not EMAIL_RE.fullmatch(email):
        return False, 'Please enter a valid email address.'
    if len(password) < 8:
        return False, 'Password must be at least 8 characters.'
    with connection() as conn:
        cur = conn.cursor(); p = ph()
        cur.execute(f'SELECT id FROM users WHERE LOWER(username)={p} OR LOWER(email)={p}', (username.lower(), email.lower()))
        if cur.fetchone():
            return False, 'Username or email is already registered.'
        cur.execute('SELECT COUNT(*) FROM users')
        count = int(cur.fetchone()[0])
        is_admin = count == 0
        password_hash = generate_password_hash(password)
        if using_postgres():
            cur.execute('''INSERT INTO users (name,username,email,password_hash,is_admin)
                           VALUES (%s,%s,%s,%s,%s) RETURNING *''',
                        (name, username, email, password_hash, is_admin))
        else:
            cur.execute('SELECT COALESCE(MAX(id),0)+1 FROM users')
            user_id = int(cur.fetchone()[0])
            cur.execute(f'''INSERT INTO users (id,name,username,email,password_hash,is_admin)
                            VALUES ({p},{p},{p},{p},{p},{p})''',
                        (user_id, name, username, email, password_hash, is_admin))
            cur.execute(f'SELECT * FROM users WHERE id={p}', (user_id,))
        return True, _public(row_to_dict(cur, cur.fetchone()))


def authenticate_user(identifier, password):
    identifier = str(identifier or '').strip().lower()
    password = str(password or '')
    with connection() as conn:
        cur = conn.cursor(); p = ph()
        cur.execute(f'SELECT * FROM users WHERE LOWER(username)={p} OR LOWER(email)={p}', (identifier, identifier))
        row = row_to_dict(cur, cur.fetchone())
        if not row or not check_password_hash(row['password_hash'], password):
            return None
        return _public(row)


def get_user_by_id(user_id):
    if not user_id:
        return None
    with connection() as conn:
        cur = conn.cursor(); p = ph()
        cur.execute(f'SELECT * FROM users WHERE id={p}', (int(user_id),))
        return _public(row_to_dict(cur, cur.fetchone()))


def request_password_reset(email):
    email = str(email or '').strip().lower()
    with connection() as conn:
        cur = conn.cursor(); p = ph()
        cur.execute(f'SELECT id FROM users WHERE LOWER(email)={p}', (email,))
        row = cur.fetchone()
        if not row:
            return True, 'If an account exists, reset instructions have been sent.'
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        expires = datetime.now(timezone.utc) + timedelta(minutes=30)
        cur.execute(f'UPDATE users SET reset_token_hash={p}, reset_expires_at={p} WHERE id={p}',
                    (digest, expires.isoformat(), row[0]))
        host = os.environ.get('SMTP_HOST'); port = int(os.environ.get('SMTP_PORT', '587'))
        sender = os.environ.get('SMTP_FROM'); user = os.environ.get('SMTP_USER'); pw = os.environ.get('SMTP_PASSWORD')
        if not all([host, sender, user, pw]):
            return True, 'SMTP is not configured. Password reset token was created, but no email was sent.'
        msg = EmailMessage()
        msg['Subject'] = 'Personal Expense Tracker password reset'
        msg['From'] = sender; msg['To'] = email
        msg.set_content(f'Use this password reset token: {token}\nIt expires in 30 minutes.')
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.starttls(); server.login(user, pw); server.send_message(msg)
        return True, 'If an account exists, reset instructions have been sent.'


def reset_password(token, password):
    token = str(token or ''); password = str(password or '')
    if len(password) < 8:
        return False, 'Password must be at least 8 characters.'
    digest = hashlib.sha256(token.encode()).hexdigest()
    with connection() as conn:
        cur = conn.cursor(); p = ph()
        cur.execute(f'SELECT id, reset_expires_at FROM users WHERE reset_token_hash={p}', (digest,))
        row = cur.fetchone()
        if not row:
            return False, 'Invalid or expired reset token.'
        try:
            expires = datetime.fromisoformat(str(row[1]).replace('Z', '+00:00'))
        except Exception:
            return False, 'Invalid or expired reset token.'
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return False, 'Invalid or expired reset token.'
        cur.execute(f'UPDATE users SET password_hash={p}, reset_token_hash=NULL, reset_expires_at=NULL WHERE id={p}',
                    (generate_password_hash(password), row[0]))
        return True, 'Password reset successfully.'
