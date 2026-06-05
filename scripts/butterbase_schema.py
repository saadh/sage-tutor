#!/usr/bin/env python3
"""Canonical Butterbase schema for Sage. Apply with: python3 scripts/butterbase_schema.py
Declarative — the platform diffs and applies. ALL tables must be listed (omission = drop).
Findings: uuid PKs required for row ops; jsonb sent as JSON strings; `config` route reserved."""
import json, os, sys, urllib.request

APP = "app_7m70nwelqpk6"
BASE = f"https://api.butterbase.ai/v1/{APP}"
KEY = os.environ.get("BUTTERBASE_API_KEY") or sys.exit("BUTTERBASE_API_KEY not set")

uuid_pk = {"type": "uuid", "primaryKey": True, "default": "gen_random_uuid()"}

TABLES = {
    "users": {"columns": {
        "id": uuid_pk,
        "phone": {"type": "text", "nullable": False, "unique": True},
        "name": {"type": "text"}, "email": {"type": "text"}, "exam_date": {"type": "date"},
        "role": {"type": "text", "nullable": False, "default": "'student'"},
        "verified_at": {"type": "timestamptz"}, "created_at": {"type": "timestamptz", "default": "now()"}}},
    "questions": {"columns": {
        "id": uuid_pk, "qid": {"type": "text", "nullable": False, "unique": True},
        "exam": {"type": "text"}, "question": {"type": "text", "nullable": False},
        "choices": {"type": "jsonb", "nullable": False}, "correct": {"type": "text", "nullable": False},
        "rationale": {"type": "text"}, "topic": {"type": "text"}, "difficulty": {"type": "integer"},
        "hints": {"type": "jsonb"}, "distractor_diagnoses": {"type": "jsonb"}, "solution_steps": {"type": "jsonb"},
        "verified": {"type": "boolean", "default": "false"}, "needs_review": {"type": "boolean", "default": "false"},
        "source": {"type": "text"}, "times_served": {"type": "integer", "default": "0"},
        "times_correct": {"type": "integer", "default": "0"}},
        "indexes": {"idx_questions_topic_difficulty": {"columns": ["topic", "difficulty"]}}},
    "sessions": {"columns": {
        "id": uuid_pk,
        "user_id": {"type": "uuid", "references": {"table": "users", "column": "id", "onDelete": "CASCADE"}},
        "mode": {"type": "text", "nullable": False, "default": "'sprint'"},
        "state": {"type": "text", "nullable": False, "default": "'idle'"},
        "current_question_id": {"type": "text"}, "question_index": {"type": "integer", "default": "0"},
        "sprint_state": {"type": "jsonb"},  # engine state: difficulty/streaks/askedQids/history — the iMessage→web bridge
        "started_at": {"type": "timestamptz", "default": "now()"}, "ended_at": {"type": "timestamptz"},
        "score": {"type": "integer"}, "web_token": {"type": "text"}},
        "indexes": {"idx_sessions_user": {"columns": ["user_id"]}}},
    "attempts": {"columns": {
        "id": uuid_pk,
        "session_id": {"type": "uuid", "references": {"table": "sessions", "column": "id", "onDelete": "CASCADE"}},
        "question_id": {"type": "uuid", "references": {"table": "questions", "column": "id"}},
        "qid": {"type": "text"}, "answer": {"type": "text"}, "correct": {"type": "boolean"},
        "hint_count": {"type": "integer", "default": "0"}, "used_walkthrough": {"type": "boolean", "default": "false"},
        "latency_s": {"type": "integer"}, "surface": {"type": "text", "default": "'imessage'"},
        "ts": {"type": "timestamptz", "default": "now()"}},
        "indexes": {"idx_attempts_session": {"columns": ["session_id"]}}},
    "mastery": {"columns": {
        "id": uuid_pk,
        "user_id": {"type": "uuid", "references": {"table": "users", "column": "id", "onDelete": "CASCADE"}},
        "topic": {"type": "text", "nullable": False},
        "level": {"type": "real", "nullable": False, "default": "2.0"},
        "attempts": {"type": "integer", "default": "0"}, "correct": {"type": "integer", "default": "0"},
        "updated_at": {"type": "timestamptz", "default": "now()"}},
        "indexes": {"idx_mastery_user_topic": {"columns": ["user_id", "topic"], "unique": True}}},
    "nudges": {"columns": {
        "id": uuid_pk,
        "user_id": {"type": "uuid", "references": {"table": "users", "column": "id", "onDelete": "CASCADE"}},
        "trigger_type": {"type": "text", "nullable": False}, "body": {"type": "text"},
        "sent_at": {"type": "timestamptz"}, "replied": {"type": "boolean", "default": "false"}}},
    "otp_codes": {"columns": {
        "id": uuid_pk, "phone": {"type": "text", "nullable": False}, "code": {"type": "text", "nullable": False},
        "expires_at": {"type": "timestamptz", "nullable": False}, "used": {"type": "boolean", "default": "false"}}},
    "settings": {"columns": {
        "id": uuid_pk, "name": {"type": "text", "nullable": False, "unique": True},
        "value": {"type": "text", "nullable": False}, "description": {"type": "text"},
        "updated_at": {"type": "timestamptz", "default": "now()"}}},
}

if __name__ == "__main__":
    req = urllib.request.Request(f"{BASE}/schema/apply",
        data=json.dumps({"schema": {"tables": TABLES}, "name": "canonical_update"}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    print("applied:", res.get("applied"), "statements")
    for s in res.get("statements", []):
        print(" -", s["description"])
