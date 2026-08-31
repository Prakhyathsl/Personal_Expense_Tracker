# Personal Expense Tracker

## Production architecture
- Flask + Gunicorn on Render
- Supabase PostgreSQL when `DATABASE_URL` is set
- SQLite locally when `DATABASE_URL` is not set
- openpyxl generates per-user Excel exports and backups from the authenticated user's database records
- No legacy Excel file is imported automatically

## Local run
```bash
pip install -r requirements.txt
python app.py
```
Open `http://127.0.0.1:5000`.

## Tests
```bash
python test_app.py
```
The tests set `APP_DATA_DIR=data_test` before importing the application, so production `data/` is not modified.

## Render + Supabase
1. Create a Supabase PostgreSQL project.
2. Create a GitHub repository and upload this project (do not upload `data/`, `data_test/`, `.env`, or `__pycache__/`).
3. Create a Render Web Service from the repository.
4. Set `DATABASE_URL` in Render to your Supabase PostgreSQL connection string.
5. Set `SECRET_KEY` to a strong secret (or let Render generate it).
6. Deploy.

When `DATABASE_URL` exists, users, expenses, savings goals and savings history are stored in PostgreSQL. Excel files are generated only when the user downloads an export/backup, so the live database is persistent and shared between phone and laptop.
