import sqlite3
import bcrypt
import logging
import json
import re
import torch
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util

DB_FILE = "guard_secure.db"
MAX_ATTEMPTS = 3
COOLDOWN_MINUTES = 10

device = "cpu" # "cuda" if torch.cuda.is_available() else "cpu"
model = SentenceTransformer('all-MiniLM-L6-v2', device=device)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="GUARD Backend", version="3.0.0")

# TODO: 
# 1. update instructions inside guard (force backend call for password reset of any kind)
# 2. documentation inside README.md
# 3. privacy policy URL
# 4. presentation

# creation of database if file not already created (handles users and phrases tables, as well as the table of contexts)
def init_db():
    """Initialize SQL database with proper schema."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                locked_until REAL DEFAULT 0,
                attempts INTEGER DEFAULT 0
            )
        """)
        # phrases are storred in a separate table
        # not stored in raw format, but after embedding mechanism is applied
        conn.execute("""
            CREATE TABLE IF NOT EXISTS phrases (
                user_id TEXT,
                phrase TEXT,
                FOREIGN KEY(user_id) REFERENCES users(user_id)
            )
        """)

        # short-term memory for ambiguous verification flow
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_context (
                user_id TEXT PRIMARY KEY,
                partial_phrase TEXT,
                timestamp REAL
            )
        """)
init_db()

# get user function, used as first measure of safety when trying to modify a password;
# first, guard verifies that a specified username exists in the database
def get_user(user_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()

# set the attempts, good measure of how many attempts remaining before cooldown of 15 minutes,
# user cannot access in that time any account information
def update_attempts(user_id, attempts, locked_until=0):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("UPDATE users SET attempts = ?, locked_until = ? WHERE user_id = ?", 
                     (attempts, locked_until, user_id))

# remove noisy punctuation, but keep '.,!?', replace '&' with 'and', normalize spaces.
def clean_text(text: str) -> str:
  text = str(text)
  text = text.replace("&", " and ")
  text = re.sub(r"[\[\]\{\}\(\)\<\>\"\'\:\;\#\@\-\_]", " ", text)
  text = re.sub(r"\s+", " ", text)
  return text.strip()

# core function of guard's semantic authentication, uses embeddings to encode meaning
# SBERT model 'all-Mini-L6-v2' for embeddings, then use of cosine similarity
def calculate_similarity(input_phrase, stored_embeddings):
    if not stored_embeddings or len(stored_embeddings) == 0:
        return 0.0

    cleaned_input = clean_text(input_phrase)
    input_emb = model.encode(cleaned_input, convert_to_tensor=True)

    stored_tensor = torch.tensor(stored_embeddings).to(device)
    cosine_scores = util.cos_sim(input_emb, stored_tensor)[0]
    
    return float(torch.max(cosine_scores))

# MODELS

# model for the enrollment stage
class EnrollRequest(BaseModel):
    user_id: str
    password: str
    phrases: list[str]

# model for the verification process
class VerifyRequest(BaseModel):
    user_id: str
    input_text: str
    auth_type: str

# model for updating the password
class UpdateRequest(BaseModel):
    user_id: str
    new_password: str

# ENDPOINTS

# user verification phase
@app.get("/user/{user_id}")
def check_user_status(user_id: str):
    user = get_user(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    
    # check if currently locked
    is_locked = user['locked_until'] > datetime.utcnow().timestamp()
    return {
        "exists": True, 
        "is_locked": is_locked, 
        "locked_until": user['locked_until']
    }

# enrollment phase
@app.post("/enroll")
def enroll(req: EnrollRequest):
    if get_user(req.user_id):
        raise HTTPException(400, "User already enrolled.")

    pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
    
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("INSERT INTO users (user_id, password_hash) VALUES (?, ?)", (req.user_id, pw_hash))
            for p in req.phrases:
                cleaned_p = clean_text(p)
                vector = model.encode(cleaned_p)
                vector_json = json.dumps(vector.tolist())

                conn.execute("INSERT INTO phrases (user_id, phrase) VALUES (?, ?)", (req.user_id, vector_json))
        logger.info(f"New user enrolled with embeddings: {req.user_id}")
        return {"status": "enrolled"}
    except Exception as e:
        logger.error(f"Enrollment error: {e}")
        raise HTTPException(500, "Internal Server Error")

# verification logic
@app.post("/verify")
def verify(req: VerifyRequest):
    user = get_user(req.user_id)
    if not user:
        raise HTTPException(404, "User not found.")

    current_time = datetime.utcnow().timestamp()
    if user['locked_until'] > current_time:
        remaining = int(user['locked_until'] - current_time)
        # fail; do not procced to authentication
        raise HTTPException(429, f"Account is locked. Wait {remaining} seconds.")

    auth_status = "denied"  # default to denied
    similarity_score = 0.0
    final_input_text = req.input_text # default to current input
    
    # Scenario G_Phase1:
    if req.auth_type == "password":
        # check bcrypt hash
        if bcrypt.checkpw(req.input_text.encode(), user['password_hash'].encode()):
            auth_status = "authorized"    
    # SCENARIO G_Phase2: semantic match
    elif req.auth_type == "phrase":
        context_used = False

        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.execute("SELECT partial_phrase, timestamp FROM auth_context WHERE user_id = ?", (req.user_id,))
            row = cursor.fetchone()
            if row:
                saved_phrase, saved_ts = row
                # context valid for 5 mins
                if current_time - saved_ts < 300: 
                    final_input_text = f"{saved_phrase} {req.input_text}"
                    context_used = True
                    logger.info(f"Context combined successfully.")
                else:
                    # expired context, clean it up
                    conn.execute("DELETE FROM auth_context WHERE user_id = ?", (req.user_id,))

        stored_embeddings = []
        # retrieve stored phrases
        with sqlite3.connect(DB_FILE) as conn:
            stored_phrases = conn.execute("SELECT phrase FROM phrases WHERE user_id = ?", (req.user_id,)).fetchall()
            for phrase in stored_phrases:
                try:
                    embedding = json.loads(phrase[0])
                    stored_embeddings.append(embedding)
                except json.JSONDecodeError:
                    logger.error("Failed to decode embedding from DB")

        # semantic check
        similarity_score = calculate_similarity(final_input_text, stored_embeddings)
        logger.info(f"User: {req.user_id} | Input: {final_input_text} | Score: {similarity_score:.2f}")

        if similarity_score >= 0.80:
            auth_status = "authorized"
        elif 0.60 <= similarity_score < 0.80:
            if context_used:
                auth_status = "denied"
                logger.info("Clarification failed. Denying access.")
            else:
                auth_status = "ambiguous" # allow only one follow-up question

    # handle cases
    with sqlite3.connect(DB_FILE) as conn:

        # strong match => access granted
        if auth_status == "authorized":
            update_attempts(req.user_id, 0) # reset attempts
            conn.execute("DELETE FROM auth_context WHERE user_id = ?", (req.user_id,))
            return {"status": "authorized", "score": similarity_score}

        # ambiguous (gray zone) => request clarification
        elif auth_status == "ambiguous":
            conn.execute(
                "INSERT OR REPLACE INTO auth_context (user_id, partial_phrase, timestamp) VALUES (?, ?, ?)", 
                (req.user_id, final_input_text, current_time)
            )
            return {
                "status": "ambiguous", 
                "message": "Verification unclear. Request clarification.",
                "score": similarity_score
            }

        # weak match => deny access
        else:
            new_attempts = user['attempts'] + 1
            lock_until = 0
            
            if new_attempts >= MAX_ATTEMPTS:
                lock_until = (datetime.utcnow() + timedelta(minutes=COOLDOWN_MINUTES)).timestamp()
                new_attempts = 0
                    
            update_attempts(req.user_id, new_attempts, lock_until)
            conn.execute("DELETE FROM auth_context WHERE user_id = ?", (req.user_id,))
            
            if lock_until > 0:
                raise HTTPException(429, "Too many failed attempts. Account locked.")
                    
            return {"status": "denied", "attempts_remaining": MAX_ATTEMPTS - new_attempts}

# update entry inside database if a previous authentication granted access
@app.post("/update_account")
def update_account(req: UpdateRequest):
    user = get_user(req.user_id)
    if not user:
        raise HTTPException(404, "User not found.")

    try:
        with sqlite3.connect(DB_FILE) as conn:
            pw_hash = bcrypt.hashpw(req.new_password.encode(), bcrypt.gensalt()).decode()
            
            conn.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", 
                         (pw_hash, req.user_id))
            logger.info(f"Password updated for {req.user_id}")

        return {"status": "success", "message": "Password updated successfully."}

    except Exception as e:
        logger.error(f"Update error: {e}")
        raise HTTPException(500, "Failed to update account.")
